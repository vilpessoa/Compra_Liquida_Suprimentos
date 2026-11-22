import { describe, expect, it } from "vitest";
import { XsdXmlValidator } from "./xsd-validator";
import { lerFixtureNfe } from "@/lib/nfe/fixtures-oficiais";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const v = new XsdXmlValidator();
const NFSE = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/nfse/${rel}`, import.meta.url)), "utf8");

describe("XsdXmlValidator: XMLs oficiais NF-e / NFC-e", () => {
  it("NF-e 'nota' (enviNFe) valida contra nota.xsd", async () => {
    const r = await v.validar(lerFixtureNfe("nfe/valido/nota/nfe_valido.xml"), "nfe");
    expect(r).toEqual({ valido: true, erros: [], schema: "nfe/nota.xsd" });
  });

  it("NF-e 'grupo' (infNFe) valida contra grupo.xsd", async () => {
    const r = await v.validar(lerFixtureNfe("nfe/valido/grupo/nfe_valido.xml"), "nfe");
    expect(r).toEqual({ valido: true, erros: [], schema: "nfe/grupo.xsd" });
  });

  it("NFC-e 'nota' e 'grupo' validam (mesma família de XSD de NF-e)", async () => {
    const nota = await v.validar(lerFixtureNfe("nfce/valido/nota/nfce_valido.xml"), "nfe");
    const grupo = await v.validar(lerFixtureNfe("nfce/valido/grupo/nfce_valido.xml"), "nfe");
    expect(nota.valido).toBe(true);
    expect(grupo.valido).toBe(true);
  });

  it("fragmentos de entradas (infNFe) validam contra grupo.xsd", async () => {
    const nfe = await v.validar(lerFixtureNfe("entradas/nfe.xml"), "nfe");
    const nfce = await v.validar(lerFixtureNfe("entradas/nfce.xml"), "nfe");
    expect(nfe.valido).toBe(true);
    expect(nfce.valido).toBe(true);
  });
});

describe("XsdXmlValidator: XMLs oficiais NFS-e", () => {
  it.each([
    ["nota com IBSCBS", "valido/nota/nfse_valido_com_IBSCBS.xml", "nfse/nota.xsd"],
    ["nota sem IBSCBS", "valido/nota/nfse_valido_sem_IBSCBS.xml", "nfse/nota.xsd"],
    ["grupo (infNFSe)", "valido/grupo/nfse_valido.xml", "nfse/grupo.xsd"],
  ])("%s valida", async (_n, rel, schema) => {
    const r = await v.validar(NFSE(rel), "nfse");
    expect(r).toEqual({ valido: true, erros: [], schema });
  });
});

describe("XsdXmlValidator: rejeições", () => {
  it("DOCTYPE é rejeitado antes de qualquer leitura de XSD", async () => {
    const r = await v.validar('<!DOCTYPE NFe [<!ENTITY x "y">]><NFe/>', "nfe");
    expect(r.valido).toBe(false);
    expect(r.erros[0]).toMatch(/DOCTYPE/);
  });

  it("raiz que não é NF-e/NFS-e não tem XSD", async () => {
    const r = await v.validar("<foo/>", "nfe");
    expect(r.valido).toBe(false);
    expect(r.schema).toBe("");
  });

  // Não há XML inválido no repositório oficial (todos os casos são "valido").
  // Este caso é derivado em memória do XML oficial, removendo o CRT obrigatório do emit.
  // Nenhum arquivo novo é criado.
  it("NF-e oficial com CRT removido (derivado em memória) falha no XSD com o erro do libxml", async () => {
    const original = lerFixtureNfe("nfe/valido/nota/nfe_valido.xml");
    const mutado = original.replace("<CRT>3</CRT>", "");
    expect(mutado).not.toBe(original);
    const r = await v.validar(mutado, "nfe");
    expect(r.valido).toBe(false);
    expect(r.schema).toBe("nfe/nota.xsd");
    expect(r.erros.some((e) => /Missing child element/.test(e) && /CRT/.test(e))).toBe(true);
  });
});
