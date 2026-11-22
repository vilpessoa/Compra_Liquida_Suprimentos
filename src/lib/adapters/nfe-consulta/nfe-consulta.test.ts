import { describe, expect, it } from "vitest";
import { GenericRestNfeConsulta } from "./generic-rest";
import { NotConfiguredNfeConsulta } from "./not-configured";
import { createNfeConsulta } from "./index";
import { chaveDoId, lerFixtureNfe } from "@/lib/nfe/fixtures-oficiais";

const CHAVE = chaveDoId(lerFixtureNfe("nfe/valido/nota/nfe_valido.xml"));
const XML = lerFixtureNfe("nfe/valido/nota/nfe_valido.xml");

type Chamada = { url: string; init: RequestInit };
function fetchFalso(resposta: () => Response | Promise<Response>) {
  const chamadas: Chamada[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} });
    return resposta();
  }) as typeof fetch;
  return { fetchImpl, chamadas };
}

describe("NotConfiguredNfeConsulta", () => {
  it("não está configurado e devolve INDETERMINADO orientando as variáveis", async () => {
    const a = new NotConfiguredNfeConsulta();
    expect(a.configurado()).toBe(false);
    const r = await a.consultarXml(CHAVE);
    expect(r.status).toBe("INDETERMINADO");
    if (r.status !== "INDETERMINADO") return;
    expect(r.codigo).toBe("CONSULTA_NAO_CONFIGURADA");
    expect(r.mensagem).toContain("NFE_API_URL");
    expect(r.mensagem).toContain("NFE_API_KEY");
  });
});

describe("GenericRestNfeConsulta", () => {
  it("faz GET no caminho com a chave, com Authorization Bearer, e devolve o XML", async () => {
    const { fetchImpl, chamadas } = fetchFalso(
      () => new Response(XML, { status: 200, headers: { "content-type": "application/xml" } }),
    );
    const a = new GenericRestNfeConsulta({
      baseUrl: "https://provedor.exemplo/api/",
      apiKey: "segredo-123",
      fetchImpl,
    });
    expect(a.configurado()).toBe(true);
    const r = await a.consultarXml(CHAVE);
    expect(r).toEqual({ status: "OK", xml: XML });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(`https://provedor.exemplo/api/nfe/${CHAVE}`);
    expect(chamadas[0].init.method).toBe("GET");
    expect((chamadas[0].init.headers as Record<string, string>)["Authorization"]).toBe("Bearer segredo-123");
  });

  it("caminho e cabeçalho são configuráveis pelo construtor", async () => {
    const { fetchImpl, chamadas } = fetchFalso(() => new Response(XML, { status: 200 }));
    const a = new GenericRestNfeConsulta({
      baseUrl: "https://x.exemplo",
      apiKey: "k",
      caminho: "/v2/documentos/{chave}/xml",
      cabecalhoAuth: "X-Api-Key",
      prefixoAuth: "",
      fetchImpl,
    });
    await a.consultarXml(CHAVE);
    expect(chamadas[0].url).toBe(`https://x.exemplo/v2/documentos/${CHAVE}/xml`);
    expect((chamadas[0].init.headers as Record<string, string>)["X-Api-Key"]).toBe("k");
  });

  it("chave malformada não gera requisição", async () => {
    const { fetchImpl, chamadas } = fetchFalso(() => new Response(XML, { status: 200 }));
    const a = new GenericRestNfeConsulta({ baseUrl: "https://x.exemplo", apiKey: "k", fetchImpl });
    const r = await a.consultarXml("123");
    expect(r.status).toBe("INDETERMINADO");
    expect(chamadas).toHaveLength(0);
  });

  it.each([
    [404, "NFE_NAO_ENCONTRADA"],
    [401, "CONSULTA_NAO_AUTORIZADA"],
    [403, "CONSULTA_NAO_AUTORIZADA"],
    [500, "CONSULTA_FALHOU"],
  ])("HTTP %i vira %s, sem expor a chave da API na mensagem", async (status, codigo) => {
    const { fetchImpl } = fetchFalso(() => new Response("erro", { status }));
    const a = new GenericRestNfeConsulta({ baseUrl: "https://x.exemplo", apiKey: "SEGREDO-XYZ", fetchImpl });
    const r = await a.consultarXml(CHAVE);
    expect(r.status).toBe("INDETERMINADO");
    if (r.status !== "INDETERMINADO") return;
    expect(r.codigo).toBe(codigo);
    expect(JSON.stringify(r)).not.toContain("SEGREDO-XYZ");
  });

  it("resposta 200 que não é XML vira RESPOSTA_INVALIDA", async () => {
    const { fetchImpl } = fetchFalso(() => new Response("{\"xml\":\"...\"}", { status: 200 }));
    const a = new GenericRestNfeConsulta({ baseUrl: "https://x.exemplo", apiKey: "k", fetchImpl });
    const r = await a.consultarXml(CHAVE);
    expect(r.status === "INDETERMINADO" && r.codigo).toBe("RESPOSTA_INVALIDA");
  });

  it("falha de rede vira CONSULTA_INDISPONIVEL", async () => {
    const { fetchImpl } = fetchFalso(() => {
      throw new TypeError("fetch failed");
    });
    const a = new GenericRestNfeConsulta({ baseUrl: "https://x.exemplo", apiKey: "k", fetchImpl });
    const r = await a.consultarXml(CHAVE);
    expect(r.status === "INDETERMINADO" && r.codigo).toBe("CONSULTA_INDISPONIVEL");
  });
});

describe("createNfeConsulta (variáveis de ambiente)", () => {
  it("sem NFE_API_URL/NFE_API_KEY usa NotConfigured", () => {
    expect(createNfeConsulta({}).configurado()).toBe(false);
    expect(createNfeConsulta({ NFE_API_URL: "https://x.exemplo" }).configurado()).toBe(false);
  });

  it("com as duas variáveis usa GenericRest", () => {
    const a = createNfeConsulta({ NFE_API_URL: "https://x.exemplo", NFE_API_KEY: "k" });
    expect(a).toBeInstanceOf(GenericRestNfeConsulta);
    expect(a.configurado()).toBe(true);
  });

  it("URL inválida falha na criação", () => {
    expect(() => createNfeConsulta({ NFE_API_URL: "nao-e-url", NFE_API_KEY: "k" })).toThrow(/NFE_API_URL/);
  });
});
