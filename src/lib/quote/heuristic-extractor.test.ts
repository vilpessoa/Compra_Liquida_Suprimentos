import { describe, expect, it } from "vitest";
import { HeuristicQuoteExtractor } from "./heuristic-extractor";
import { cnpjValido, parseNumeroBr } from "./text-utils";

// Todos os textos abaixo são FIXTURES DE TESTE construídos aqui — não são dados reais.
const FIXTURE_TESTE_EMAIL = `Prezados, segue proposta.

Fornecedor: Metalúrgica Exemplo Ltda
CNPJ: 11.222.333/0001-81
Cidade: Campinas - SP
Somos optante pelo Simples Nacional.

Item: Parafuso sextavado M8
Qtd: 1.000 un | Valor unitário: R$ 1,25
NCM: 7318.15.00

Item: Porca M8
Qtd: 500 | Valor unitário: R$ 1.234,56
`;

const ex = new HeuristicQuoteExtractor();

describe("utilitários", () => {
  it("valida DV de CNPJ", () => {
    expect(cnpjValido("11.222.333/0001-81")).toBe(true);
    expect(cnpjValido("11.222.333/0001-82")).toBe(false);
    expect(cnpjValido("00.000.000/0000-00")).toBe(false);
  });
  it("interpreta números BR", () => {
    expect(parseNumeroBr("R$ 1.234,56")?.canonico).toBe("1234.56");
    expect(parseNumeroBr("12,5")?.canonico).toBe("12.5");
    expect(parseNumeroBr("1.000")?.canonico).toBe("1000");
    expect(parseNumeroBr("1.000")?.ambiguo).toBe(true);
    expect(parseNumeroBr("abc")).toBeNull();
  });
});

describe("HeuristicQuoteExtractor (fixtures de teste)", () => {
  it("extrai campos rotulados com trecho literal", async () => {
    const p = await ex.extrair(FIXTURE_TESTE_EMAIL);
    expect(p.fornecedor).toEqual({ valor: "Metalúrgica Exemplo Ltda", trecho: "Fornecedor: Metalúrgica Exemplo Ltda" });
    expect(p.cnpj).toEqual({ valor: "11.222.333/0001-81", trecho: "11.222.333/0001-81" });
    expect(p.uf.valor).toBe("SP");
    expect(p.regimeTributario.valor).toBe("SIMPLES_NACIONAL");
    expect(p.itens).toHaveLength(2);
    const [a, b] = p.itens;
    expect(a.descricao.valor).toBe("Parafuso sextavado M8");
    expect(a.quantidade.valor).toBe("1000");
    expect(a.unidade.valor).toBe("un");
    expect(a.valorUnitario.valor).toBe("1.25");
    expect(a.ncm.valor).toBe("73181500");
    expect(a.nbs.valor).toBeNull();
    expect(b.valorUnitario.valor).toBe("1234.56");
    expect(b.ncm.valor).toBeNull();
    expect(b.unidade.valor).toBeNull();
    // todo trecho é substring literal
    for (const c of [p.fornecedor, p.cnpj, p.uf, p.regimeTributario, ...p.itens.flatMap((i) => Object.values(i))]) {
      if (c.valor !== null) expect(FIXTURE_TESTE_EMAIL).toContain(c.trecho);
    }
  });

  it("documento sem dados: tudo null e avisos", async () => {
    const p = await ex.extrair("Olá, segue em anexo nossa proposta. Atenciosamente, Fulano.");
    expect(p.fornecedor.valor).toBeNull();
    expect(p.cnpj.valor).toBeNull();
    expect(p.uf.valor).toBeNull();
    expect(p.regimeTributario.valor).toBeNull();
    expect(p.itens).toEqual([]);
    expect(p.avisos.join(" ")).toMatch(/CNPJ não encontrado/);
    expect(p.avisos.join(" ")).toMatch(/Nenhum item/);
  });

  it("descarta CNPJ com DV inválido", async () => {
    const p = await ex.extrair("CNPJ: 11.222.333/0001-82");
    expect(p.cnpj.valor).toBeNull();
    expect(p.avisos.join(" ")).toMatch(/dígitos verificadores inválidos/);
  });

  it("não preenche CNPJ quando há mais de um válido (pode ser o do comprador)", async () => {
    const p = await ex.extrair("CNPJ fornecedor: 11.222.333/0001-81\nFaturar para CNPJ: 11.444.777/0001-61");
    expect(p.cnpj.valor).toBeNull();
    expect(p.avisos.join(" ")).toMatch(/Mais de um CNPJ/);
  });

  it("UF só com sigla válida e explícita", async () => {
    expect((await ex.extrair("UF: XX")).uf.valor).toBeNull();
    expect((await ex.extrair("UF: MG")).uf.valor).toBe("MG");
    expect((await ex.extrair("Estamos em São Paulo, temos prazo curto.")).uf.valor).toBeNull();
  });

  it("NCM só quando rotulado; nunca de número solto ou deduzido", async () => {
    const p = await ex.extrair("Item: Parafuso\nQtd: 10 | Valor unitário: R$ 2,00\nCódigo 73181500 interno\nNCM: 123");
    expect(p.itens[0].ncm.valor).toBeNull();
    expect(p.avisos.join(" ")).toMatch(/NCM "123" não tem 8 dígitos/);
  });

  it("NBS rotulado é aceito (9 dígitos)", async () => {
    const p = await ex.extrair("Descrição: Consultoria\nQtd: 1\nNBS: 1.1506.21.00");
    expect(p.itens[0].nbs.valor).toBe("115062100");
  });

  it("regime: 'não optante' e menção solta não preenchem", async () => {
    expect((await ex.extrair("Não optante pelo Simples Nacional.")).regimeTributario.valor).toBeNull();
    expect((await ex.extrair("Conforme Simples Nacional, nada a declarar.")).regimeTributario.valor).toBeNull();
    expect((await ex.extrair("Regime Tributário: Lucro Presumido")).regimeTributario.valor).toBe("REGULAR");
  });

  it("linha livre: preço sem cue unitário/total não vira valor unitário", async () => {
    const p = await ex.extrair("- 10 un Caneta azul R$ 15,00");
    expect(p.itens[0].descricao.valor).toBe("Caneta azul");
    expect(p.itens[0].quantidade.valor).toBe("10");
    expect(p.itens[0].valorUnitario.valor).toBeNull();
    expect(p.avisos.join(" ")).toMatch(/sem indicação de unitário ou total/);
    const q = await ex.extrair("- 10 un Caneta azul R$ 1,50 cada");
    expect(q.itens[0].valorUnitario.valor).toBe("1.5");
  });

  it("tabela TSV com cabeçalhos (como gerada de planilha)", async () => {
    const tsv = [
      "## Aba: Proposta",
      "Fornecedor\tAcme Teste Ltda",
      "",
      "Item\tDescrição\tQtd\tUn\tValor Unitário\tValor Total\tNCM",
      "1\tCabo de rede Cat6\t100\tm\t2,50\t250,00\t8544.42.00",
      "2\tConector RJ45\t1.000\tUN\tR$ 0,80\t800,00\t",
      "\t\t\t\t\tTotal\t1050,00",
    ].join("\n");
    const p = await ex.extrair(tsv);
    expect(p.fornecedor.valor).toBe("Acme Teste Ltda");
    expect(p.itens).toHaveLength(2);
    expect(p.itens[0]).toMatchObject({
      descricao: { valor: "Cabo de rede Cat6" },
      quantidade: { valor: "100" },
      unidade: { valor: "m" },
      valorUnitario: { valor: "2.5" },
      ncm: { valor: "85444200", trecho: "8544.42.00" },
    });
    expect(p.itens[1].quantidade.valor).toBe("1000");
    expect(p.itens[1].valorUnitario.valor).toBe("0.8");
    expect(p.itens[1].ncm.valor).toBeNull();
  });
});
