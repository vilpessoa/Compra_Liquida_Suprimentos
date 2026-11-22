import { describe, expect, it } from "vitest";
import { ErroParseNfe, LIMITE_BYTES_XML, parseNfe } from "./parser";
import { bloco, chaveDoId, lerFixtureNfe, valorTag } from "./fixtures-oficiais";

const NFE_NOTA = lerFixtureNfe("nfe/valido/nota/nfe_valido.xml");
const NFE_GRUPO = lerFixtureNfe("nfe/valido/grupo/nfe_valido.xml");
const NFCE_NOTA = lerFixtureNfe("nfce/valido/nota/nfce_valido.xml");
const NFCE_GRUPO = lerFixtureNfe("nfce/valido/grupo/nfce_valido.xml");
const ENTRADA_NFE = lerFixtureNfe("entradas/nfe.xml");
const ENTRADA_NFCE = lerFixtureNfe("entradas/nfce.xml");

const ocorrencias = (xml: string, re: RegExp) => [...xml.matchAll(re)].map((m) => m[1]);

describe("NF-e completa (enviNFe > NFe > infNFe), fixture oficial 'nota'", () => {
  const doc = parseNfe(NFE_NOTA);
  const ide = bloco(NFE_NOTA, "ide") ?? "";
  const emit = bloco(NFE_NOTA, "emit") ?? "";
  const dest = bloco(NFE_NOTA, "dest") ?? "";

  it("raiz, chave (do @Id) e dhEmi", () => {
    expect(doc.origemRaiz).toBe("enviNFe");
    expect(doc.chave).toBe(chaveDoId(NFE_NOTA));
    expect(doc.dhEmi).toBe(valorTag(ide, "dhEmi"));
  });

  it("ide: natOp decodifica a entidade uma única vez", () => {
    // No XML está &amp;quot; (texto literal "&quot;"), então a leitura correta é "&quot;".
    expect(doc.ide.natOp).toBe("Compra P/Ind. sob o Regime de &quot;Drawback&quot;");
    expect(doc.ide.mod).toBe(valorTag(ide, "mod"));
    expect(doc.ide.serie).toBe(valorTag(ide, "serie"));
  });

  it("emitente e destinatário com UF, cMun e CRT", () => {
    expect(doc.emitente).toEqual({
      cnpj: valorTag(emit, "CNPJ"),
      nome: valorTag(emit, "xNome"),
      uf: valorTag(bloco(emit, "enderEmit") ?? "", "UF"),
      cMun: valorTag(bloco(emit, "enderEmit") ?? "", "cMun"),
      crt: valorTag(emit, "CRT"),
    });
    expect(doc.destinatario?.cnpj).toBe(valorTag(dest, "CNPJ"));
    expect(doc.destinatario?.uf).toBe(valorTag(bloco(dest, "enderDest") ?? "", "UF"));
    expect(doc.destinatario?.cMun).toBe(valorTag(bloco(dest, "enderDest") ?? "", "cMun"));
  });

  it("um item por det, com nItem do atributo", () => {
    expect(doc.itens.map((i) => i.nItem)).toEqual(ocorrencias(NFE_NOTA, /<det nItem="(\d+)"/g));
  });

  it("prod do item 1 (campos do XSD)", () => {
    const p = doc.itens[0].prod;
    expect(p.cProd).toBe("96485451");
    expect(p.xProd).toBe("PESSEGO BASE CONCENTRADA");
    expect(p.NCM).toBe("76071120");
    expect(p.CFOP).toBe("6101");
    expect(p.qCom).toBe("1.0000");
    expect(p.vUnCom).toBe("2.00");
    expect(p.vProd).toBe("2.00");
  });

  it("imposto/IBSCBS do item 1 confere com o XML (CST, cClassTrib, gIBSCBS.vBC)", () => {
    const ibs = doc.itens[0].imposto.IBSCBS;
    const xmlIbs = bloco(NFE_NOTA, "IBSCBS") ?? "";
    expect(ibs?.CST).toBe(valorTag(xmlIbs, "CST"));
    expect(ibs?.cClassTrib).toBe(valorTag(xmlIbs, "cClassTrib"));
    expect(ibs?.gIBSCBS?.vBC).toBe(valorTag(bloco(xmlIbs, "gIBSCBS") ?? "", "vBC"));
    expect(ibs?.gIBSCBSMono).toBeUndefined();
  });

  it("totais: IBSCBSTot.vBCIBSCBS confere com o XML", () => {
    expect(doc.total.IBSCBSTot?.vBCIBSCBS).toBe(valorTag(bloco(NFE_NOTA, "IBSCBSTot") ?? "", "vBCIBSCBS"));
  });
});

describe("fragmento de grupos (infNFe sem envelope), fixtures 'grupo' e 'entradas'", () => {
  const doc = parseNfe(ENTRADA_NFE);

  it("sem Id: chave e blocos ausentes ficam undefined (nunca 0 presumido)", () => {
    expect(doc.origemRaiz).toBe("infNFe");
    expect(doc.chave).toBeUndefined();
    expect(doc.emitente).toBeUndefined();
    expect(doc.destinatario).toBeUndefined();
    expect(doc.dhEmi).toBeUndefined();
  });

  it("ide/gCompraGov (layout de compra governamental)", () => {
    expect(doc.ide.gCompraGov).toEqual({
      tpEnteGov: valorTag(bloco(ENTRADA_NFE, "gCompraGov") ?? "", "tpEnteGov"),
      pRedutor: valorTag(bloco(ENTRADA_NFE, "gCompraGov") ?? "", "pRedutor"),
      tpOperGov: valorTag(bloco(ENTRADA_NFE, "gCompraGov") ?? "", "tpOperGov"),
    });
  });

  it("imposto/IS do item 1 (CSTIS, cClassTribIS, vBCIS, pIS, vIS)", () => {
    const is = doc.itens[0].imposto.IS;
    const xmlIs = bloco(ENTRADA_NFE, "IS") ?? "";
    expect(is?.CSTIS).toBe(valorTag(xmlIs, "CSTIS"));
    expect(is?.cClassTribIS).toBe(valorTag(xmlIs, "cClassTribIS"));
    expect(is?.vBCIS).toBe(valorTag(xmlIs, "vBCIS"));
    expect(is?.pIS).toBe(valorTag(xmlIs, "pIS"));
    expect(is?.vIS).toBe(valorTag(xmlIs, "vIS"));
    expect(is?.pISEspec).toBe(valorTag(xmlIs, "pISEspec"));
  });

  it("imposto/IBSCBS: gIBSCBS com gIBSUF/gCBS, sem gIBSCBSMono", () => {
    const ibs = doc.itens[0].imposto.IBSCBS;
    const g = bloco(ENTRADA_NFE, "gIBSCBS") ?? "";
    expect(ibs?.CST).toBe(valorTag(bloco(ENTRADA_NFE, "IBSCBS") ?? "", "CST"));
    expect(ibs?.gIBSCBS?.vBC).toBe(valorTag(g, "vBC"));
    expect(ibs?.gIBSCBS?.gIBSUF?.pIBSUF).toBe(valorTag(bloco(g, "gIBSUF") ?? "", "pIBSUF"));
    expect(ibs?.gIBSCBS?.gCBS?.vCBS).toBe(valorTag(bloco(g, "gCBS") ?? "", "vCBS"));
    expect(ibs?.gIBSCBSMono).toBeUndefined();
  });
});

describe("demais fixtures oficiais NF-e e NFC-e parseiam e trazem a chave do Id", () => {
  it.each([
    ["NF-e grupo", NFE_GRUPO],
    ["NFC-e nota", NFCE_NOTA],
    ["NFC-e grupo", NFCE_GRUPO],
    ["entradas NFC-e", ENTRADA_NFCE],
  ])("%s", (_nome, xml) => {
    const doc = parseNfe(xml);
    const idMatch = /Id="NFe(\d{44})"/.exec(xml);
    expect(doc.chave).toBe(idMatch ? idMatch[1] : undefined);
    expect(doc.itens.length).toBe((xml.match(/<det /g) ?? []).length);
  });
});

describe("entrada insegura ou inválida", () => {
  it("rejeita DOCTYPE (sem DTD, sem entidades externas)", () => {
    const xml = '<!DOCTYPE infNFe [<!ENTITY x "y">]><infNFe/>';
    expect(() => parseNfe(xml)).toThrow(ErroParseNfe);
    try {
      parseNfe(xml);
    } catch (e) {
      expect((e as ErroParseNfe).codigo).toBe("DTD_NAO_PERMITIDO");
    }
  });

  it("rejeita XML acima de 5 MB", () => {
    const xml = "<infNFe>" + "a".repeat(LIMITE_BYTES_XML) + "</infNFe>";
    try {
      parseNfe(xml);
      expect.fail("deveria ter lançado");
    } catch (e) {
      expect((e as ErroParseNfe).codigo).toBe("XML_MUITO_GRANDE");
    }
  });

  it("XML malformado", () => {
    try {
      parseNfe("<infNFe><ide></infNFe>");
      expect.fail("deveria ter lançado");
    } catch (e) {
      expect((e as ErroParseNfe).codigo).toBe("XML_MALFORMADO");
    }
  });

  it("raiz que não é NF-e", () => {
    try {
      parseNfe("<foo/>");
      expect.fail("deveria ter lançado");
    } catch (e) {
      expect((e as ErroParseNfe).codigo).toBe("RAIZ_DESCONHECIDA");
    }
  });

  it("vazio", () => {
    try {
      parseNfe("   ");
      expect.fail("deveria ter lançado");
    } catch (e) {
      expect((e as ErroParseNfe).codigo).toBe("XML_VAZIO");
    }
  });
});
