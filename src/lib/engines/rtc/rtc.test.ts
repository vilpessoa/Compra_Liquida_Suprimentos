import { describe, expect, it } from "vitest";
import {
  D,
  JBig,
  arredondarAliquotaPublicada,
  arredondarValorFiscal,
  decFromJBig,
  dividir,
  formatarAliquota,
  formatarMoeda,
  formatarMoedaPtBr,
  formatarPercentualPtBr,
  formatarQuantidade,
  jstr,
} from "./jdecimal";
import { evaluate } from "./expression";
import { substituirPlaceholders } from "./calculo";
import { parseOperacao, validarItem, validarOperacao, JsonParseError } from "./input";
import { getRtcRepos, processarObservabilidade, calcularRegimeGeral } from "./index";
import type { ObservabilidadeROCDomain, ProblemDetailBody, RtcHttpResponse } from "./official-types";

const obs = (r: RtcHttpResponse) => r.body as ObservabilidadeROCDomain;

const d = (s: string) => new D(s);

describe("semântica BigDecimal (jdecimal)", () => {
  it("arredonda HALF_EVEN a 2 e 4 casas (ArredondamentoUtils.MODO)", () => {
    expect(arredondarValorFiscal(d("0.125")).toFixed(2)).toBe("0.12");
    expect(arredondarValorFiscal(d("0.135")).toFixed(2)).toBe("0.14");
    expect(arredondarValorFiscal(d("2.675")).toFixed(2)).toBe("2.68");
    expect(arredondarValorFiscal(d("-0.125")).toFixed(2)).toBe("-0.12");
    expect(arredondarAliquotaPublicada(d("1.68393793783894")).toFixed(4)).toBe("1.6839");
    expect(arredondarAliquotaPublicada(d("0.00005")).toFixed(4)).toBe("0.0000");
    expect(arredondarAliquotaPublicada(d("0.00015")).toFixed(4)).toBe("0.0002");
  });

  it("divisão com MathContext(34, HALF_EVEN); demais operações exatas", () => {
    expect(dividir(d("1"), d("3")).toFixed()).toBe("0." + "3".repeat(34));
    expect(dividir(d("2"), d("3")).toFixed()).toBe("0." + "6".repeat(33) + "7");
    expect(dividir(d("5"), d("100")).toFixed()).toBe("0.05");
    // exata: 17 dígitos x 17 dígitos não perde precisão
    expect(d("12345678901.2345").mul(d("98765432101.5432")).toFixed()).toBe("1219326311267330467607.8350804");
  });

  it("formata como os serializers do Jackson", () => {
    expect(formatarMoeda(d("804.365"))).toBe("804.36");
    expect(formatarAliquota(d("0.2080"))).toBe("0.208");
    expect(formatarAliquota(d("0.2"))).toBe("0.20");
    expect(formatarAliquota(d("60"))).toBe("60.00");
    expect(formatarAliquota(d("1.68393793783894"))).toBe("1.6839");
    expect(formatarQuantidade(d("1000"))).toBe("1000");
    expect(formatarQuantidade(d("55.55"))).toBe("55.5500");
    expect(formatarQuantidade(d("1.0"))).toBe("1");
  });

  it("formata pt-BR da memória de cálculo (DecimalFormat HALF_EVEN)", () => {
    expect(formatarMoedaPtBr(d("1234.565"))).toBe("1.234,56");
    expect(formatarMoedaPtBr(d("99999.99"))).toBe("99.999,99");
    expect(formatarMoedaPtBr(null)).toBe("0,00");
    expect(formatarPercentualPtBr(d("8.4"))).toBe("8,40");
    expect(formatarPercentualPtBr(d("0.1922"))).toBe("0,1922");
    expect(formatarPercentualPtBr(d("0.19225"))).toBe("0,1922");
    expect(formatarPercentualPtBr(null)).toBe("0,00");
  });

  it("BigDecimal.toString preserva escala e usa notação científica quando devido", () => {
    expect(jstr(decFromJBig(JBig.parse("1.234")!))).toBe("1.234");
    expect(jstr(decFromJBig(JBig.parse("-1.00")!))).toBe("-1.00");
    expect(jstr(decFromJBig(JBig.parse("007.50")!))).toBe("7.50");
    expect(jstr(decFromJBig(JBig.parse("0.0000001")!))).toBe("1E-7");
    expect(jstr(decFromJBig(JBig.parse("0.000001")!))).toBe("0.000001");
    expect(jstr(decFromJBig(JBig.parse("1E+3")!))).toBe("1E+3");
    expect(JBig.parse("12.50")!.precision()).toBe(4);
    expect(JBig.parse("abc")).toBeNull();
  });
});

describe("avaliador de expressões (JEXL com aritmética BigDecimal)", () => {
  it("precedência, parênteses e unário", () => {
    expect(evaluate("1+2*3", {}).toFixed()).toBe("7");
    expect(evaluate("(1+2)*3", {}).toFixed()).toBe("9");
    expect(evaluate("-(2-5)", {}).toFixed()).toBe("3");
    expect(evaluate("baseCalculoInformada*0.5", { baseCalculoInformada: d("100.00") }).toFixed()).toBe("50");
  });
  it("expressão que é só o nome da variável devolve a variável", () => {
    const v = d("0.0090");
    expect(evaluate(" aliquota ", { aliquota: v })).toBe(v);
  });
  it("expressões oficiais (aliquota efetiva com redutor de compra governamental)", () => {
    const r = evaluate("aliquota*(1-percentualReducao)*(1-pRedutorCompraGov/100)", {
      aliquota: d("0.084"),
      percentualReducao: d("0.6"),
      pRedutorCompraGov: d("0"),
    });
    expect(r.toFixed()).toBe("0.0336");
  });
  it("divisão por zero e variável indefinida falham", () => {
    expect(() => evaluate("1/0", {})).toThrow("Division by zero");
    expect(() => evaluate("x+1", {})).toThrow();
  });
});

describe("memória de cálculo: substituição de placeholders", () => {
  it("substitui, remove chaves desconhecidas e preserva colchete não fechado", () => {
    expect(substituirPlaceholders("a [x] b [y] c", { x: "1" })).toBe("a 1 b  c");
    expect(substituirPlaceholders("sem placeholder", {})).toBe("sem placeholder");
    expect(substituirPlaceholders("abre [x", { x: "1" })).toBe("abre [x");
  });
});

describe("entrada: Jackson + Bean Validation oficiais", () => {
  const base = { id: "i", versao: "1", dhFatoGerador: "2026-06-30T12:00:00-03:00", municipio: 4314902, uf: "RS" };
  const item = { numero: 1, cst: "000", cClassTrib: "000001", baseCalculo: 100 };

  it("string numérica com caractere de controle é aparada (Jackson String.trim)", () => {
    const op = parseOperacao({ ...base, itens: [{ ...item, baseCalculo: "\u0000100.00" }] });
    expect(jstr(op.itens![0].baseCalculo!)).toBe("100.00");
  });
  it("enum inválido vira erro de leitura (HTTP 400)", () => {
    expect(() => parseOperacao({ ...base, gCompraGov: { tpEnteGov: 7 }, itens: [item] })).toThrow(JsonParseError);
  });
  it("violações e mensagens do Hibernate Validator", () => {
    const op = parseOperacao({ ...base, itens: [{ numero: 0, cst: "00", cClassTrib: "ABCDEF", baseCalculo: "-1.234" }] });
    const v = validarItem(op.itens![0]).map((x) => `${x.annotation}:${x.path}:${x.message}:${x.invalid}`);
    expect(v).toContain("Min:numero:must be greater than or equal to 1:0");
    expect(v).toContain("Size:cst:size must be between 3 and 3:00");
    expect(v).toContain("Pattern:cClassTrib:Informar somente dígitos:ABCDEF");
    expect(v).toContain("PositiveOrZero:baseCalculo:must be greater than or equal to 0:-1.234");
    expect(v).toContain("Digits:baseCalculo:numeric value out of bounds (<13 digits>.<2 digits> expected):-1.234");
  });
  it("validações globais da operação", () => {
    const op = parseOperacao({ versao: "1", municipio: 12345678, itens: [] });
    const v = validarOperacao(op).map((x) => `${x.annotation}:${x.path}`);
    expect(v.sort()).toEqual(["Max:municipio", "NotEmpty:itens", "NotNull:id"].sort());
  });
});

describe("motor local: casos pontuais", () => {
  const base = { id: "i", versao: "1", municipio: 4314902, uf: "RS" };

  it("CST 000 em 2026 usa alíquotas oficiais (CBS 0,9%, IBS UF 0,1%) e arredonda uma vez por número", async () => {
    const r = processarObservabilidade(await getRtcRepos(), {
      ...base,
      dhFatoGerador: "2026-06-30T12:00:00-03:00",
      itens: [{ numero: 1, cst: "000", cClassTrib: "000001", baseCalculo: "1234.56" }],
    });
    expect(r.status).toBe(200);
    const g = obs(r).objetos[0].tribCalc!.IBSCBS.gIBSCBS!;
    expect(g.gCBS).toEqual({ pCBS: "0.90", vCBS: "11.11" });
    expect(g.gIBSUF).toEqual({ pIBSUF: "0.10", vIBSUF: "1.23" });
    expect(r.headers["x-calc-app-version"]).toBe("1.7.2");
    expect(r.headers["x-warning-dados-simulados"]).toBeUndefined();
  });

  it("tratamento com ajuste/monofasia devolve NAO_IMPLEMENTADO/CAL-007 e não calcula", async () => {
    const r = processarObservabilidade(await getRtcRepos(), {
      ...base,
      dhFatoGerador: "2027-06-30T12:00:00-03:00",
      itens: [
        {
          numero: 1,
          cst: "620",
          cClassTrib: "620001",
          baseCalculo: 100,
          aliquotasNominais: { cbs: 8.8, ibsEstadual: 0.05, ibsMunicipal: 0.05 },
        },
      ],
    });
    const o = obs(r).objetos[0];
    expect(o.estadoItem).toBe("NAO_IMPLEMENTADO");
    expect(o.erros![0].code).toBe("CAL-007");
    expect(o.tribCalc).toBeUndefined();
    expect(obs(r).total).toBeUndefined();
    expect(r.headers["x-warning-dados-simulados"]).toBe("6");
  });

  it("aliquotasNominais: proibido até 2026 (REG-036) e obrigatório a partir de 2027 (REG-037)", async () => {
    const repos = await getRtcRepos();
    const a = processarObservabilidade(repos, {
      ...base,
      dhFatoGerador: "2026-06-30T12:00:00-03:00",
      itens: [{ numero: 1, cst: "000", cClassTrib: "000001", baseCalculo: 100, aliquotasNominais: { cbs: 1, ibsEstadual: 1, ibsMunicipal: 1 } }],
    });
    expect(obs(a).objetos[0].erros![0].code).toBe("REG-036");
    const b = processarObservabilidade(repos, {
      ...base,
      dhFatoGerador: "2027-06-30T12:00:00-03:00",
      itens: [{ numero: 1, cst: "000", cClassTrib: "000001", baseCalculo: 100 }],
    });
    expect(obs(b).objetos[0].erros![0].code).toBe("REG-037");
  });

  it("/regime-geral: primeiro erro de item falha a requisição com o status HTTP do Java", async () => {
    const r = calcularRegimeGeral(await getRtcRepos(), {
      ...base,
      dhFatoGerador: "2026-06-30T12:00:00-03:00",
      itens: [{ numero: 1, cst: "000", cClassTrib: "999999", baseCalculo: 100 }],
    });
    expect(r.status).toBe(404);
    expect((r.body as ProblemDetailBody).type).toBe("http://localhost/errors/classificacao-tributaria-nao-encontrada");
  });

  it("gComponentesBC não é calculado pelo motor local (MotorLocalNaoValidadoError)", async () => {
    const repos = await getRtcRepos();
    expect(() =>
      processarObservabilidade(repos, {
        ...base,
        dhFatoGerador: "2026-06-30T12:00:00-03:00",
        itens: [{ numero: 1, cst: "000", cClassTrib: "000001", gComponentesBC: { vProd: 100 } }],
      }),
    ).toThrow(/não validado/);
  });
});
