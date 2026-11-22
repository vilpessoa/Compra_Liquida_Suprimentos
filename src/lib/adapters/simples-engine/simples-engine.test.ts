import { afterEach, describe, expect, it, vi } from "vitest";
import { createSimplesEngine } from "./index";
import { RfbHttpSimplesEngine } from "./rfb-http-simples-engine";

afterEach(() => vi.unstubAllEnvs());

describe("createSimplesEngine", () => {
  it("padrão: motor local", () => {
    vi.stubEnv("SIMPLES_ENGINE", "");
    expect(createSimplesEngine().id).toBe("local");
  });

  it("rfb-http exige RTC_SIMPLES_API_URL", () => {
    vi.stubEnv("SIMPLES_ENGINE", "rfb-http");
    vi.stubEnv("RTC_SIMPLES_API_URL", "");
    expect(() => createSimplesEngine()).toThrow(/RTC_SIMPLES_API_URL/);
    vi.stubEnv("RTC_SIMPLES_API_URL", "http://simples.interno:8082/api/");
    expect(createSimplesEngine().id).toBe("rfb-http");
  });

  it("valor inválido é recusado", () => {
    vi.stubEnv("SIMPLES_ENGINE", "outro");
    expect(() => createSimplesEngine()).toThrow(/SIMPLES_ENGINE/);
  });
});

describe("RfbHttpSimplesEngine (repasse 1:1)", () => {
  it("POST: corpo, caminho, status e JSON intactos (inclusive 422)", async () => {
    const chamadas: Array<{ url: string; init?: RequestInit }> = [];
    const problema = { type: "about:blank", status: 422, errors: [{ code: "VSN-039" }] };
    const fetchFalso = (async (url: string, init?: RequestInit) => {
      chamadas.push({ url, init });
      return new Response(JSON.stringify(problema), { status: 422, headers: { "X-CALC-APP-VERSION": "1.0.2" } });
    }) as unknown as typeof fetch;
    const motor = new RfbHttpSimplesEngine("http://localhost:8082/api/", fetchFalso);
    const entrada = { id: "x", itens: [] };
    const r = await motor.calcularNaoAssistido(entrada);
    expect(chamadas[0].url).toBe("http://localhost:8082/api/calculadora/observabilidade/simples-nacional/nao-assistido");
    expect(chamadas[0].init?.method).toBe("POST");
    expect(JSON.parse(String(chamadas[0].init?.body))).toEqual(entrada);
    expect(r.status).toBe(422);
    expect(r.body).toEqual(problema);
    expect(r.headers).toEqual({ "X-CALC-APP-VERSION": "1.0.2" });
  });

  it("GET: query repassada; 404 vazio => \"\"", async () => {
    const urls: string[] = [];
    const fetchFalso = (async (url: string) => {
      urls.push(url);
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;
    const motor = new RfbHttpSimplesEngine("http://h/api", fetchFalso);
    const r = await motor.buscarAtividade("99", { data: "2027-06-30", tpDoc: "55" });
    expect(urls[0]).toBe("http://h/api/calculadora/simples-nacional/atividades/99?data=2027-06-30&tpDoc=55");
    expect(r).toEqual({ status: 404, body: "" });
    await motor.listarAtividades({ data: "2027-06-30", anexos: ["I", "III,V"] });
    expect(urls[1]).toBe("http://h/api/calculadora/simples-nacional/atividades?data=2027-06-30&anexos=I&anexos=III%2CV");
  });
});
