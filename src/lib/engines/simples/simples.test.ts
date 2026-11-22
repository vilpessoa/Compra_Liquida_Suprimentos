import { describe, expect, it } from "vitest";
import { D, aliquotaDeTexto, formatarAliquota, formatarMoeda, moedaPtBr, percentualPtBr } from "./decimal";
import { SimplesNacionalLocalEngine } from "./engine";
import { MotorLocalNaoValidadoError } from "./errors";
import { inteiroTolerante, isBlank, javaTrim, parseLocalDate } from "./java-compat";
import { CODIGOS_VSN, buscarCodigoVsn } from "./codigos";

describe("política numérica (ArredondamentoUtils)", () => {
  it("valor fiscal: 2 casas, HALF_EVEN (empate vai ao par)", () => {
    expect(formatarMoeda(new D("0.125"))).toBe("0.12");
    expect(formatarMoeda(new D("0.135"))).toBe("0.14");
    expect(formatarMoeda(new D("2.675"))).toBe("2.68");
    expect(formatarMoeda(new D("0"))).toBe("0.00");
    expect(formatarMoeda(new D("1234567890123.455"))).toBe("1234567890123.46");
  });

  it("alíquota publicada: 4 casas, sem zeros à direita, mínimo 2 casas", () => {
    expect(formatarAliquota(new D("0.2080"))).toBe("0.208");
    expect(formatarAliquota(new D("0.2000"))).toBe("0.20");
    expect(formatarAliquota(new D("60"))).toBe("60.00");
    expect(formatarAliquota(new D("1.6839379378389463610262954"))).toBe("1.6839");
    expect(formatarAliquota(new D("0.00005"))).toBe("0.00"); // empate => par (0)
    expect(formatarAliquota(new D("0.00015"))).toBe("0.0002");
  });

  it("memória de cálculo: pt-BR com milhar e vírgula", () => {
    expect(moedaPtBr(new D("1234567.891"))).toBe("1.234.567,89");
    expect(moedaPtBr(null)).toBe("0,00");
    expect(percentualPtBr(new D("2.75"))).toBe("2,75");
    expect(percentualPtBr(new D("1.68393793783894"))).toBe("1,6839");
  });

  it("alíquota de entrada preserva a grafia de BigDecimal.toPlainString", () => {
    expect(aliquotaDeTexto("0.0129").plain).toBe("0.0129");
    expect(aliquotaDeTexto("1.10").plain).toBe("1.10");
    expect(aliquotaDeTexto("007.50").plain).toBe("7.50");
    expect(aliquotaDeTexto("00").plain).toBe("0");
  });

  it("aritmética exata (sem arredondamento implícito)", () => {
    const a = new D("1.6839379378389463610262954").times("0.9");
    expect(a.toFixed()).toBe("1.51554414405505172492366586");
  });
});

describe("equivalentes do JDK", () => {
  it("isBlank / trim", () => {
    expect(isBlank("  \t")).toBe(true);
    expect(isBlank(" ")).toBe(false); // NBSP não é whitespace para Character.isWhitespace
    expect(javaTrim("  x ")).toBe("  x");
  });

  it("Integer.valueOf tolerante", () => {
    expect(inteiroTolerante(" 01 ")).toBe(1);
    expect(inteiroTolerante("+2")).toBe(2);
    expect(inteiroTolerante("2.0")).toBeNull();
    expect(inteiroTolerante("99999999999")).toBeNull();
    expect(inteiroTolerante("")).toBeNull();
  });

  it("LocalDate.parse estrito", () => {
    expect(parseLocalDate("2028-02-29")).toBe("2028-02-29");
    expect(parseLocalDate("2027-02-29")).toBeNull();
    expect(parseLocalDate("2027-13-45")).toBeNull();
    expect(parseLocalDate("2027-6-30")).toBeNull();
  });
});

describe("catálogo VSN", () => {
  it("códigos e textos do enum oficial", () => {
    expect(Object.keys(CODIGOS_VSN)).toHaveLength(51);
    expect(buscarCodigoVsn("VSN-039")?.titulo).toBe("Alíquotas efetivas do contribuinte (aliquotasEfetivas) ausentes");
    expect(buscarCodigoVsn("VSN-040")?.titulo).toBe('Fator "r" (fatorR) ausente');
    expect(buscarCodigoVsn("VSN-XXX")).toBeUndefined();
  });
});

describe("motor local (ADR-005: alíquotas efetivas informadas pelo comprador)", () => {
  const motor = new SimplesNacionalLocalEngine();
  const base = {
    id: "t",
    versao: "3.0.0",
    data: "2027-06-30",
    tpDoc: "55",
    CRT: "1",
    itens: [{ numero: 1, cAtivSN: "01", cClassTrib: "000001", baseCalculo: "1000.00", valorImpostoSeletivo: "0.00" }],
  };

  it("sem aliquotasEfetivas devolve VSN-039 (422), nada é presumido", async () => {
    const r = await motor.observabilidadeNaoAssistida(base);
    expect(r.status).toBe(422);
    expect((r.body as { errors: Array<{ code: string }> }).errors[0].code).toBe("VSN-039");
  });

  it("SOMENTE_RECEITA dispensa as alíquotas e só leva a receita bruta", async () => {
    const r = await motor.observabilidadeNaoAssistida({ ...base, tpRegimeIBSCBS: "1" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      oper: { regimeApuracao: "SOMENTE_RECEITA" },
      objetos: [{ estadoItem: "NAO_CALCULADO", tribCalc: { vRBSNitem: "1000.00" } }],
      total: { vRBSNtot: "1000.00" },
    });
  });

  it("com alíquotas efetivas informadas calcula CBS e IBS (HALF_EVEN, 2 casas)", async () => {
    const r = await motor.observabilidadeNaoAssistida({
      ...base,
      aliquotasEfetivas: { fatorR: true, anexoI: { pCBSSN: "1.1612", pIBSSN: "0.0129" } },
    });
    expect(r.status).toBe(200);
    const t = (r.body as { objetos: Array<{ tribCalc: Record<string, string> }> }).objetos[0].tribCalc;
    expect(t).toMatchObject({ vBC: "1000.00", pCBSSN: "1.1612", pIBSSN: "0.0129", vCBSSN: "11.61", vIBSSN: "0.13" });
    expect(t.totalItem).toBe("11.74");
  });

  it("corpo que o desserializador oficial recusaria => MotorLocalNaoValidadoError (nunca resultado aproximado)", async () => {
    await expect(motor.observabilidadeNaoAssistida("abc")).rejects.toBeInstanceOf(MotorLocalNaoValidadoError);
    await expect(
      motor.observabilidadeNaoAssistida({ ...base, itens: [{ numero: "x" }] }),
    ).rejects.toBeInstanceOf(MotorLocalNaoValidadoError);
  });

  it("GET atividades: 404 com corpo vazio; 400 de parâmetro ausente", async () => {
    const nao = await motor.buscarAtividade("99", { data: "2027-06-30" });
    expect(nao).toEqual({ status: 404, body: "" });
    const sem = await motor.listarAtividades({});
    expect(sem.status).toBe(400);
    expect(sem.body).toMatchObject({ title: "Parâmetro obrigatório ausente", instance: "/api/calculadora/simples-nacional/atividades" });
  });
});
