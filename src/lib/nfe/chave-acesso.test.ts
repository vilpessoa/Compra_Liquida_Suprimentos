import { describe, expect, it } from "vitest";
import {
  ErroChaveAcesso,
  analisarChaveAcesso,
  calcularDvChaveAcesso,
  normalizarChaveAcesso,
  validarChaveAcesso,
} from "./chave-acesso";
import { bloco, chaveDoId, lerFixtureNfe, valorTag } from "./fixtures-oficiais";
import { siglaUfPorCodigo } from "./uf";

const XML_NFE = lerFixtureNfe("nfe/valido/nota/nfe_valido.xml");
const XML_NFCE = lerFixtureNfe("nfce/valido/nota/nfce_valido.xml");
const CHAVE_NFE = chaveDoId(XML_NFE);
const CHAVE_NFCE = chaveDoId(XML_NFCE);

describe("normalizarChaveAcesso", () => {
  it("remove prefixo NFe, espaços e pontuação", () => {
    expect(normalizarChaveAcesso(`NFe ${CHAVE_NFE.slice(0, 20)}.${CHAVE_NFE.slice(20)}`)).toBe(CHAVE_NFE);
  });
});

describe("decomposição com chaves extraídas dos XMLs oficiais", () => {
  const ide = bloco(XML_NFE, "ide") ?? "";
  const ideNfce = bloco(XML_NFCE, "ide") ?? "";

  it("NF-e: cada campo confere com a tag correspondente do <ide> do mesmo arquivo", () => {
    const a = analisarChaveAcesso(CHAVE_NFE);
    expect(a.tamanhoValido).toBe(true);
    if (!a.tamanhoValido) return;
    const d = a.decomposta;
    expect(d.cUF).toBe(valorTag(ide, "cUF"));
    expect(d.cNF).toBe(valorTag(ide, "cNF"));
    expect(d.mod).toBe(valorTag(ide, "mod"));
    expect(d.serie).toBe(valorTag(ide, "serie"));
    expect(Number(d.nNF)).toBe(Number(valorTag(ide, "nNF")));
    expect(d.tpEmis).toBe(valorTag(ide, "tpEmis"));
    expect(d.cDV).toBe(valorTag(ide, "cDV"));
    expect(d.cnpjCpfEmitente).toBe(
      valorTag(bloco(XML_NFE, "emit") ?? "", "CNPJ"),
    );
    expect(d.AAMM).toBe("2509");
  });

  it("NFC-e: decomposição confere com o <ide> do mesmo arquivo", () => {
    const d = analisarChaveAcesso(CHAVE_NFCE);
    expect(d.tamanhoValido).toBe(true);
    if (!d.tamanhoValido) return;
    expect(d.decomposta.cUF).toBe(valorTag(ideNfce, "cUF"));
    expect(d.decomposta.mod).toBe(valorTag(ideNfce, "mod"));
    expect(d.decomposta.cNF).toBe(valorTag(ideNfce, "cNF"));
  });
});

describe("sigla da UF pela tabela oficial (src/data/rtc)", () => {
  it("NF-e: siglaUF da chave confere com a UF do emitente no próprio XML", () => {
    const d = analisarChaveAcesso(CHAVE_NFE);
    expect(d.tamanhoValido).toBe(true);
    if (!d.tamanhoValido) return;
    expect(d.decomposta.siglaUF).toBe(valorTag(bloco(bloco(XML_NFE, "emit") ?? "", "enderEmit") ?? "", "UF"));
    expect(d.decomposta.siglaUF).toBe("MA");
  });

  it("NFC-e: siglaUF da chave confere com a UF do emitente no próprio XML", () => {
    const d = analisarChaveAcesso(CHAVE_NFCE);
    expect(d.tamanhoValido).toBe(true);
    if (!d.tamanhoValido) return;
    expect(d.decomposta.siglaUF).toBe(valorTag(bloco(bloco(XML_NFCE, "emit") ?? "", "enderEmit") ?? "", "UF"));
    expect(d.decomposta.siglaUF).toBe("PA");
  });

  it("código fora da tabela devolve undefined", () => {
    expect(siglaUfPorCodigo("00")).toBeUndefined();
    expect(siglaUfPorCodigo("99")).toBe("EX");
  });
});

describe("DV das chaves oficiais de teste", () => {
  // Achado: as chaves dos XMLs oficiais de teste não batem com o DV do Manual (módulo 11).
  // Não se altera o algoritmo para casar com elas. O teste registra o resultado real.
  it("NF-e oficial: DV informado diverge do calculado", () => {
    const a = analisarChaveAcesso(CHAVE_NFE);
    expect(a.tamanhoValido).toBe(true);
    if (!a.tamanhoValido) return;
    expect(a.chave[43]).toBe("0");
    expect(a.dvCalculado).toBe("5");
    expect(a.dvValido).toBe(false);
  });

  it("NFC-e oficial: DV informado diverge do calculado", () => {
    const a = analisarChaveAcesso(CHAVE_NFCE);
    expect(a.tamanhoValido).toBe(true);
    if (!a.tamanhoValido) return;
    expect(a.chave[43]).toBe("8");
    expect(a.dvCalculado).toBe("7");
    expect(a.dvValido).toBe(false);
  });

  it("validarChaveAcesso rejeita chave oficial com DV divergente", () => {
    expect(() => validarChaveAcesso(CHAVE_NFE)).toThrow(ErroChaveAcesso);
  });
});

describe("algoritmo do DV (módulo 11, pesos 2..9 a partir da direita)", () => {
  // Teste do algoritmo com base derivada, não é documento fiscal.
  it("aceita chave cujo DV foi recalculado sobre a base oficial", () => {
    const base = CHAVE_NFE.slice(0, 43);
    const chaveRecalculada = base + String(calcularDvChaveAcesso(base));
    const d = validarChaveAcesso(chaveRecalculada);
    expect(d.chave).toBe(chaveRecalculada);
    expect(d.cUF).toBe("21");
  });

  it("base de zeros gera DV 0 (resto 0)", () => {
    expect(calcularDvChaveAcesso("0".repeat(43))).toBe(0);
  });

  it("resto 1 gera DV 0 (base com 6 na última posição: 12 mod 11 = 1)", () => {
    expect(calcularDvChaveAcesso("0".repeat(42) + "6")).toBe(0);
  });

  it("pesos ciclam: o 9º dígito a partir da direita volta ao peso 2", () => {
    // dígito 1 na 9ª posição da direita -> peso 2 -> soma 2 -> DV 9
    expect(calcularDvChaveAcesso("0".repeat(34) + "1" + "0".repeat(8))).toBe(9);
  });

  it("rejeita base que não tem 43 dígitos", () => {
    expect(() => calcularDvChaveAcesso("123")).toThrow(ErroChaveAcesso);
  });
});

describe("tamanho inválido", () => {
  it("analisar informa tamanhoValido=false sem lançar", () => {
    const a = analisarChaveAcesso(CHAVE_NFE.slice(0, 43));
    expect(a.tamanhoValido).toBe(false);
  });

  it("validar lança ErroChaveAcesso", () => {
    expect(() => validarChaveAcesso("1".repeat(45))).toThrow(ErroChaveAcesso);
  });
});
