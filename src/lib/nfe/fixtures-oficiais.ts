import { readFileSync } from "node:fs";

/** Lê um XML oficial copiado em src/lib/nfe/__fixtures__ (ver README lá). */
export function lerFixtureNfe(rel: string): string {
  return readFileSync(new URL(`./__fixtures__/${rel}`, import.meta.url), "utf8");
}

/** Chave extraída do atributo infNFe/@Id do próprio arquivo (não digitada no teste). */
export function chaveDoId(xml: string): string {
  const m = /Id="NFe(\d{44})"/.exec(xml);
  if (!m) throw new Error("fixture sem infNFe/@Id");
  return m[1];
}

/** Valor do primeiro <tag>...</tag> dentro de um trecho. */
export function valorTag(trecho: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(trecho);
  return m ? m[1] : undefined;
}

/** Primeiro bloco <tag>...</tag> inteiro. */
export function bloco(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`).exec(xml);
  return m ? m[0] : undefined;
}
