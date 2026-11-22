import { afterEach, describe, expect, it, vi } from "vitest";
import { createTaxEngine, LocalRtcEngine, RfbRtcHttpEngine, MotorLocalNaoValidadoError } from "./index";
import type { OperacaoInput } from "@/lib/ports/rtc-dto";

const op: OperacaoInput = {
  id: "i",
  versao: "1",
  dhFatoGerador: "2026-06-30T12:00:00-03:00",
  municipio: 4314902,
  uf: "RS",
  itens: [{ numero: 1, cst: "000", cClassTrib: "000001", baseCalculo: 100 }],
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createTaxEngine", () => {
  it("padrão é o motor local", () => {
    vi.stubEnv("TAX_ENGINE", "");
    expect(createTaxEngine()).toBeInstanceOf(LocalRtcEngine);
  });
  it("rfb-http exige RTC_API_URL", () => {
    vi.stubEnv("TAX_ENGINE", "rfb-http");
    vi.stubEnv("RTC_API_URL", "");
    expect(() => createTaxEngine()).toThrow(/RTC_API_URL/);
    vi.stubEnv("RTC_API_URL", "http://rtc.interno:8080/api");
    expect(createTaxEngine()).toBeInstanceOf(RfbRtcHttpEngine);
  });
  it("valor inválido de TAX_ENGINE é recusado", () => {
    vi.stubEnv("TAX_ENGINE", "outro");
    expect(() => createTaxEngine()).toThrow(/TAX_ENGINE/);
  });
});

describe("LocalRtcEngine", () => {
  it("devolve a resposta oficial (status, corpo e headers)", async () => {
    const r = await new LocalRtcEngine().calcularObservabilidade(op);
    expect(r.status).toBe(200);
    expect((r.body as { objetos: Array<{ estadoItem: string }> }).objetos[0].estadoItem).toBe("CALCULADO");
    expect(r.headers["x-calc-db-version"]).toBe("V0073");
  });
  it("recusa combinações não validadas com MotorLocalNaoValidadoError", async () => {
    const e = new LocalRtcEngine();
    await expect(
      e.calcularObservabilidade({ ...op, itens: [{ ...op.itens[0], gComponentesBC: { vProd: 10 } }] }),
    ).rejects.toBeInstanceOf(MotorLocalNaoValidadoError);
  });
});

describe("RfbRtcHttpEngine (repasse 1:1)", () => {
  it("POST em ${RTC_API_URL}/calculadora/observabilidade/regime-geral e repassa status/corpo/headers", async () => {
    const corpo = { objetos: [{ nObj: 1, estadoItem: "CALCULADO" }] };
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(corpo), {
        status: 200,
        headers: { "x-calc-app-version": "1.7.2", "x-calc-db-version": "V0073", "x-warning-dados-simulados": "6", "content-type": "application/json" },
      }),
    );
    const e = new RfbRtcHttpEngine("http://rtc.interno:8080/api/", { fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await e.calcularObservabilidade(op);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://rtc.interno:8080/api/calculadora/observabilidade/regime-geral");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(op);
    expect(r).toEqual({
      status: 200,
      body: corpo,
      headers: { "x-calc-app-version": "1.7.2", "x-calc-db-version": "V0073", "x-warning-dados-simulados": "6" },
    });
  });
  it("erros HTTP (422) voltam como resposta, não como exceção", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: 422, title: "x" }), { status: 422 }));
    const e = new RfbRtcHttpEngine("http://h/api", { fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await e.calcularRegimeGeral(op);
    expect(r.status).toBe(422);
  });
  it("corpo não-JSON é falha de transporte", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>", { status: 502 }));
    const e = new RfbRtcHttpEngine("http://h/api", { fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(e.calcularObservabilidade(op)).rejects.toThrow(/não-JSON/);
  });
});
