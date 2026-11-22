import { MotorLocalNaoValidadoError } from "./errors";
import { NAO_SUPORTADOS } from "./unsupported";
import type {
  AliquotasEfetivasInput,
  AnexoComIssInput,
  AnexoParUnicoInput,
  ItemSimplesInput,
  ItemSimplesUnificadoInput,
  OperacaoSimplesInput,
  OperacaoSimplesNaoAssistidaInput,
  ParAliquotasInput,
} from "./official-types";

/**
 * Leitura do corpo JSON com a mesma tolerância do Jackson: campos desconhecidos ignorados; escalares
 * (número inteiro/booleano) aceitos onde o contrato pede texto. Um corpo que o Jackson recusaria (HTTP 400
 * com mensagem do parser) NÃO tem resposta reproduzível: vira `MotorLocalNaoValidadoError` (o chamador deve
 * usar o motor oficial, SIMPLES_ENGINE=rfb-http).
 */

function recusa(caminho: string, motivo: string): never {
  throw new MotorLocalNaoValidadoError(
    "CORPO_JSON_NAO_REPRODUZIVEL",
    `${NAO_SUPORTADOS.CORPO_JSON_NAO_REPRODUZIVEL} Local: '${caminho}' (${motivo}).`,
  );
}

function objeto(v: unknown, caminho: string): Record<string, unknown> | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object" || Array.isArray(v)) recusa(caminho, "esperado objeto");
  return v as Record<string, unknown>;
}

function texto(v: unknown, caminho: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  if (typeof v === "boolean") return String(v);
  return recusa(caminho, "esperado texto");
}

function inteiro(v: unknown, caminho: string): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isInteger(v) && v >= -2147483648 && v <= 2147483647) return v;
  if (typeof v === "string" && /^[+-]?\d+$/.test(v.trim())) {
    const n = Number(v.trim());
    if (n >= -2147483648 && n <= 2147483647) return n;
  }
  return recusa(caminho, "esperado inteiro");
}

function booleano(v: unknown, caminho: string): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.toLowerCase();
    if (t === "true") return true;
    if (t === "false") return false;
  }
  return recusa(caminho, "esperado booleano");
}

function lista(v: unknown, caminho: string): unknown[] | null {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v)) recusa(caminho, "esperado array");
  return v as unknown[];
}

function par(v: unknown, caminho: string): ParAliquotasInput | null {
  const o = objeto(v, caminho);
  return o && { pCBSSN: texto(o.pCBSSN, `${caminho}.pCBSSN`), pIBSSN: texto(o.pIBSSN, `${caminho}.pIBSSN`) };
}

function anexoUnico(v: unknown, caminho: string): AnexoParUnicoInput | null {
  return par(v, caminho);
}

function anexoComIss(v: unknown, caminho: string): AnexoComIssInput | null {
  const o = objeto(v, caminho);
  return (
    o && {
      pCBSSN: texto(o.pCBSSN, `${caminho}.pCBSSN`),
      pIBSSN: texto(o.pIBSSN, `${caminho}.pIBSSN`),
      semRedistribuicaoISS: par(o.semRedistribuicaoISS, `${caminho}.semRedistribuicaoISS`),
    }
  );
}

function aliquotasEfetivas(v: unknown, caminho: string): AliquotasEfetivasInput | null {
  const o = objeto(v, caminho);
  return (
    o && {
      fatorR: booleano(o.fatorR, `${caminho}.fatorR`),
      impedimentoSublimite: booleano(o.impedimentoSublimite, `${caminho}.impedimentoSublimite`),
      anexoI: anexoUnico(o.anexoI, `${caminho}.anexoI`),
      anexoII: anexoUnico(o.anexoII, `${caminho}.anexoII`),
      anexoIII: anexoComIss(o.anexoIII, `${caminho}.anexoIII`),
      anexoIV: anexoComIss(o.anexoIV, `${caminho}.anexoIV`),
      anexoV: anexoComIss(o.anexoV, `${caminho}.anexoV`),
    }
  );
}

/** Jackson: `@JsonProperty("ncm") @JsonAlias("NCM")` — vale o que aparece por último no JSON. */
function nomenclatura(o: Record<string, unknown>, c: string) {
  const chaves = Object.keys(o);
  const ultimo = (a: string, b: string) => {
    const ia = chaves.lastIndexOf(a);
    const ib = chaves.lastIndexOf(b);
    return ia >= ib ? a : b;
  };
  const kn = ultimo("ncm", "NCM");
  const kb = ultimo("nbs", "NBS");
  return { ncm: texto(o[kn], `${c}.${kn}`), nbs: texto(o[kb], `${c}.${kb}`) };
}

function itemClassico(v: unknown, caminho: string): ItemSimplesInput | null {
  const o = objeto(v, caminho);
  if (!o) return null;
  const { ncm, nbs } = nomenclatura(o, caminho);
  return {
    numero: inteiro(o.numero, `${caminho}.numero`),
    cAtivSN: texto(o.cAtivSN, `${caminho}.cAtivSN`),
    cClassTrib: texto(o.cClassTrib, `${caminho}.cClassTrib`),
    nbs,
    ncm,
    baseCalculo: texto(o.baseCalculo, `${caminho}.baseCalculo`),
    valorImpostoSeletivo: texto(o.valorImpostoSeletivo, `${caminho}.valorImpostoSeletivo`),
    pIBSSN: texto(o.pIBSSN, `${caminho}.pIBSSN`),
    pCBSSN: texto(o.pCBSSN, `${caminho}.pCBSSN`),
  };
}

function itemUnificado(v: unknown, caminho: string): ItemSimplesUnificadoInput | null {
  const o = objeto(v, caminho);
  if (!o) return null;
  const { ncm, nbs } = nomenclatura(o, caminho);
  return {
    numero: inteiro(o.numero, `${caminho}.numero`),
    cAtivSN: texto(o.cAtivSN, `${caminho}.cAtivSN`),
    cClassTrib: texto(o.cClassTrib, `${caminho}.cClassTrib`),
    nbs,
    ncm,
    baseCalculo: texto(o.baseCalculo, `${caminho}.baseCalculo`),
    valorImpostoSeletivo: texto(o.valorImpostoSeletivo, `${caminho}.valorImpostoSeletivo`),
    tribISSQN: texto(o.tribISSQN, `${caminho}.tribISSQN`),
    tpRetISSQN: texto(o.tpRetISSQN, `${caminho}.tpRetISSQN`),
    tpBM: texto(o.tpBM, `${caminho}.tpBM`),
  };
}

function corpo(raw: unknown): Record<string, unknown> {
  const o = objeto(raw, "$");
  if (!o) recusa("$", "corpo ausente");
  return o as Record<string, unknown>;
}

export function lerOperacaoClassica(raw: unknown): OperacaoSimplesInput {
  const o = corpo(raw);
  const itens = lista(o.itens, "itens");
  return {
    id: texto(o.id, "id"),
    versao: texto(o.versao, "versao"),
    data: texto(o.data, "data"),
    tpDoc: texto(o.tpDoc, "tpDoc"),
    CRT: texto(o.CRT, "CRT"),
    tpRegimeIBSCBS: texto(o.tpRegimeIBSCBS, "tpRegimeIBSCBS"),
    tpEnteGov: texto(o.tpEnteGov, "tpEnteGov"),
    itens: itens && itens.map((i, n) => itemClassico(i, `itens[${n}]`)),
  };
}

export function lerOperacaoNaoAssistida(raw: unknown): OperacaoSimplesNaoAssistidaInput {
  const o = corpo(raw);
  const itens = lista(o.itens, "itens");
  return {
    id: texto(o.id, "id"),
    versao: texto(o.versao, "versao"),
    data: texto(o.data, "data"),
    tpDoc: texto(o.tpDoc, "tpDoc"),
    CRT: texto(o.CRT, "CRT"),
    tpRegimeIBSCBS: texto(o.tpRegimeIBSCBS, "tpRegimeIBSCBS"),
    opSimpNac: texto(o.opSimpNac, "opSimpNac"),
    regApIBSCBSSN: texto(o.regApIBSCBSSN, "regApIBSCBSSN"),
    regApTribSN: texto(o.regApTribSN, "regApTribSN"),
    tpEnteGov: texto(o.tpEnteGov, "tpEnteGov"),
    aliquotasEfetivas: aliquotasEfetivas(o.aliquotasEfetivas, "aliquotasEfetivas"),
    itens: itens && itens.map((i, n) => itemUnificado(i, `itens[${n}]`)),
  };
}
