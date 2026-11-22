import { describe, expect, it } from "vitest";
import { createQuoteExtractor } from "./index";
import { AVISO_IA_INDISPONIVEL, AnthropicQuoteExtractor, OpenAICompatibleQuoteExtractor, urlChatCompletions } from "./llm-extractors";
import { posValidarProposta } from "./validation";
import type { PropostaExtraida } from "@/lib/ports/quote-extractor";

// Documento FIXTURE DE TESTE e respostas de LLM SIMULADAS.
const DOC = `Proposta comercial
Fornecedor: Acme Teste Ltda
CNPJ: 11.222.333/0001-81
Cidade: Campinas - SP
Item: Parafuso M8
Qtd: 1.000 un
Valor unitário: R$ 1,25
`;
const c = <T,>(valor: T | null, trecho: string | null) => ({ valor, trecho });
const N = c<string>(null, null);
const itemVazio = { descricao: N, ncm: N, nbs: N, quantidade: N, unidade: N, valorUnitario: N };
const base = (): PropostaExtraida => ({
  fornecedor: c("Acme Teste Ltda", "Fornecedor: Acme Teste Ltda"),
  cnpj: c("11.222.333/0001-81", "CNPJ: 11.222.333/0001-81"),
  uf: c("SP", "Campinas - SP"),
  regimeTributario: c<"REGULAR" | "SIMPLES_NACIONAL">(null, null),
  itens: [{
    ...itemVazio,
    descricao: c("Parafuso M8", "Item: Parafuso M8"),
    quantidade: c("1.000", "Qtd: 1.000 un"),
    unidade: c("un", "Qtd: 1.000 un"),
    valorUnitario: c("1,25", "Valor unitário: R$ 1,25"),
  }],
  avisos: [],
});

describe("pós-validação anti-alucinação", () => {
  it("mantém campos corretos e normaliza números", () => {
    const p = posValidarProposta(base(), DOC);
    expect(p.fornecedor.valor).toBe("Acme Teste Ltda");
    expect(p.cnpj.valor).toBe("11.222.333/0001-81");
    expect(p.uf.valor).toBe("SP");
    expect(p.itens[0].quantidade.valor).toBe("1000");
    expect(p.itens[0].valorUnitario.valor).toBe("1.25");
    expect(p.regimeTributario.valor).toBeNull();
  });

  it("descarta valor cujo trecho NÃO está no documento (alucinação)", () => {
    const b = base();
    b.fornecedor = c("Fornecedor Inventado SA", "Fornecedor: Fornecedor Inventado SA");
    b.regimeTributario = c("SIMPLES_NACIONAL", "optante pelo Simples Nacional");
    b.itens[0].ncm = c("73181500", "NCM: 7318.15.00");
    const p = posValidarProposta(b, DOC);
    expect(p.fornecedor).toEqual({ valor: null, trecho: null });
    expect(p.regimeTributario).toEqual({ valor: null, trecho: null });
    expect(p.itens[0].ncm).toEqual({ valor: null, trecho: null });
    expect(p.avisos.join("\n")).toMatch(/trecho não encontrado literalmente/);
  });

  it("descarta valor inconsistente com o trecho real (preço adulterado)", () => {
    const b = base();
    b.itens[0].valorUnitario = c("9,99", "Valor unitário: R$ 1,25");
    b.itens[0].quantidade = c("100", "Qtd: 1.000 un");
    const p = posValidarProposta(b, DOC);
    expect(p.itens[0].valorUnitario.valor).toBeNull();
    expect(p.itens[0].quantidade.valor).toBeNull();
    expect(p.avisos.join("\n")).toMatch(/número não bate com o trecho/);
  });

  it("descarta campo sem trecho", () => {
    const b = base();
    b.cnpj = c("11.222.333/0001-81", null);
    expect(posValidarProposta(b, DOC).cnpj.valor).toBeNull();
  });

  it("descarta CNPJ com DV inválido e UF inválida, mesmo presentes no texto", () => {
    const doc = "CNPJ: 11.222.333/0001-82\nUF: XX";
    const b = base();
    b.cnpj = c("11.222.333/0001-82", "CNPJ: 11.222.333/0001-82");
    b.uf = c("XX", "UF: XX");
    const p = posValidarProposta({ ...b, itens: [] }, doc);
    expect(p.cnpj.valor).toBeNull();
    expect(p.uf.valor).toBeNull();
    expect(p.avisos.join("\n")).toMatch(/dígitos verificadores/);
    expect(p.avisos.join("\n")).toMatch(/UF inválida/);
  });

  it("NCM presente no texto mas SEM rótulo é descartado; com rótulo é aceito", () => {
    const doc = "Parafuso 73181500 qualquer\nNCM: 7318.15.00 outro";
    const sem = base();
    sem.itens = [{ ...itemVazio, descricao: c("Parafuso", "Parafuso 73181500"), ncm: c("73181500", "Parafuso 73181500") }];
    expect(posValidarProposta(sem, doc).itens[0].ncm.valor).toBeNull();
    const com = base();
    com.itens = [{ ...itemVazio, descricao: c("Parafuso", "Parafuso 73181500"), ncm: c("73181500", "NCM: 7318.15.00") }];
    expect(posValidarProposta(com, doc).itens[0].ncm.valor).toBe("73181500");
  });

  it("NCM de coluna de tabela TSV é aceito só quando o cabeçalho da coluna é NCM", () => {
    const doc = "Descrição\tNCM\tCódigo\nParafuso\t7318.15.00\t99887766";
    const mk = (cel: string): PropostaExtraida => ({
      ...base(), itens: [{ ...itemVazio, descricao: c("Parafuso", "Parafuso"), ncm: c(cel.replace(/\D/g, ""), cel) }],
    });
    expect(posValidarProposta(mk("7318.15.00"), doc).itens[0].ncm.valor).toBe("73181500");
    expect(posValidarProposta(mk("99887766"), doc).itens[0].ncm.valor).toBeNull();
  });

  it("trecho com espaços diferentes ainda casa (normalização de espaços)", () => {
    const b = base();
    b.fornecedor = c("Acme Teste Ltda", "Fornecedor:   Acme\tTeste Ltda");
    expect(posValidarProposta(b, DOC).fornecedor.valor).toBe("Acme Teste Ltda");
  });
});

describe("extratores LLM com resposta simulada", () => {
  const respostaComAlucinacao = () => ({
    ...base(),
    // valor que NÃO está no texto, com trecho fabricado
    regimeTributario: c("SIMPLES_NACIONAL", "Empresa optante pelo Simples Nacional"),
    itens: [{ ...base().itens[0], ncm: c("73181500", "NCM 7318.15.00") }],
    avisos: [],
  });

  it("OpenAI-compatível: pós-valida a resposta e zera alucinações", async () => {
    const fetchImpl = (async (url: string, init: RequestInit) => {
      expect(url).toBe("https://gw.exemplo.test/v1/chat/completions");
      expect(JSON.parse(String(init.body)).response_format.type).toBe("json_schema");
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(respostaComAlucinacao()) } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const ex = new OpenAICompatibleQuoteExtractor({ apiKey: "k", baseUrl: "https://gw.exemplo.test/v1/", model: "m", fetchImpl });
    const p = await ex.extrair(DOC);
    expect(p.fornecedor.valor).toBe("Acme Teste Ltda");
    expect(p.regimeTributario.valor).toBeNull();
    expect(p.itens[0].ncm.valor).toBeNull();
    expect(p.itens[0].valorUnitario.valor).toBe("1.25");
    expect(p.avisos.join("\n")).toMatch(/descartado/);
  });

  it("Anthropic: usa tool_use e pós-valida", async () => {
    const client = {
      messages: {
        create: async (req: { tool_choice: unknown; tools: Array<{ strict?: boolean }> }) => {
          expect(req.tool_choice).toEqual({ type: "tool", name: "registrar_proposta" });
          expect(req.tools[0].strict).toBe(true);
          return { stop_reason: "tool_use", content: [{ type: "tool_use", name: "registrar_proposta", input: respostaComAlucinacao() }] };
        },
      },
    } as never;
    const p = await new AnthropicQuoteExtractor({ apiKey: "k", client }).extrair(DOC);
    expect(p.regimeTributario.valor).toBeNull();
    expect(p.cnpj.valor).toBe("11.222.333/0001-81");
  });

  it("erro da LLM => heurística + aviso", async () => {
    const fetchImpl = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    const ex = new OpenAICompatibleQuoteExtractor({ apiKey: "k", baseUrl: "https://gw.exemplo.test", model: "m", fetchImpl });
    const p = await ex.extrair(DOC);
    expect(p.avisos[0]).toBe(AVISO_IA_INDISPONIVEL);
    expect(p.cnpj.valor).toBe("11.222.333/0001-81"); // veio da heurística
  });

  it("resposta fora do schema => heurística + aviso", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"x":1}' } }] }), { status: 200 })) as unknown as typeof fetch;
    const ex = new OpenAICompatibleQuoteExtractor({ apiKey: "k", baseUrl: "https://gw.exemplo.test", model: "m", fetchImpl });
    expect((await ex.extrair(DOC)).avisos[0]).toBe(AVISO_IA_INDISPONIVEL);
  });

  it("preserva ?api-version= (Azure) ao montar a URL", () => {
    expect(urlChatCompletions("https://x.openai.azure.com/openai/deployments/d?api-version=2024-10-21")).toBe(
      "https://x.openai.azure.com/openai/deployments/d/chat/completions?api-version=2024-10-21",
    );
  });
});

describe("createQuoteExtractor", () => {
  it("sem chave => heurística", () => {
    expect(createQuoteExtractor({})).toMatchObject({ tipo: "heuristica", rotulo: "Heurística local", id: "heuristic" });
  });
  it("com chave => anthropic por padrão", () => {
    expect(createQuoteExtractor({ LLM_API_KEY: "k" })).toMatchObject({ tipo: "ia", rotulo: "IA", id: "anthropic" });
  });
  it("none explícito ganha da chave", () => {
    expect(createQuoteExtractor({ LLM_API_KEY: "k", LLM_PROVIDER: "none" }).tipo).toBe("heuristica");
  });
  it("openai-compatible exige base URL e modelo", () => {
    const s = createQuoteExtractor({ LLM_API_KEY: "k", LLM_PROVIDER: "openai-compatible" });
    expect(s.tipo).toBe("heuristica");
    expect(s.avisoConfig).toMatch(/LLM_BASE_URL/);
    expect(createQuoteExtractor({ LLM_API_KEY: "k", LLM_PROVIDER: "openai-compatible", LLM_BASE_URL: "https://g.test/v1", LLM_MODEL: "m" }).id).toBe("openai-compatible");
  });
  it("provider pedido sem chave => heurística com aviso", () => {
    expect(createQuoteExtractor({ LLM_PROVIDER: "anthropic" }).avisoConfig).toMatch(/LLM_API_KEY/);
  });
});
