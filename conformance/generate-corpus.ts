/**
 * Gerador do corpus "golden master" do MOTOR OFICIAL da Receita Federal.
 *
 * Uso (com as duas APIs de pé, ver setup-official.sh):
 *   npx tsx conformance/generate-corpus.ts [--only=prefixo] [--out=dir] [--dry]
 *
 * REGRA: nenhum dado tributário é escrito à mão. Todas as entradas saem de
 *  (a) tabelas do banco SQLite oficial (gerado pelo Flyway oficial em
 *      conformance/work/*), (b) arquivos de teste/docs dos repositórios
 *      oficiais (literais), ou (c) parâmetros de teste explícitos e
 *      documentados em conformance/README.md (bases de cálculo, alíquotas
 *      nominais/efetivas copiadas de fixtures oficiais).
 * As respostas são gravadas como o motor as devolveu (inclusive 422 e erros).
 */
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ───────────────────────────── configuração ─────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"] as [string, string];
  }),
);
const OUT = resolve(args.get("out") ?? join(HERE, "corpus"));
const ONLY = args.get("only");
const DRY = args.has("dry");

const RR = process.env.RFB_REGIME_SRC; // repo oficial (para ler testes/docs)
const SN = process.env.RFB_SN_SRC;
const URL_RR = process.env.RFB_REGIME_URL ?? "http://localhost:8080/api";
const URL_SN = process.env.RFB_SN_URL ?? "http://localhost:8082/api";
const DB_RR = join(HERE, "work/regime-regular/calculadora/db/calculadora-pro.db");
const DB_SN = join(HERE, "work/simples-nacional/calculadora/db/calculadora-pro.db");

// Parâmetros de TESTE (não são dado tributário).
/** Bases de cálculo de teste. */
const BASES = ["0.01", "1.00", "100.00", "1234.56", "99999.99"];
/**
 * Alíquotas nominais de teste (pontos percentuais), copiadas LITERALMENTE de
 * entradas dos testes oficiais (src/test/resources/entradas/**) e do
 * docs/exemplos.md. A API exige `aliquotasNominais` a partir de 2027.
 */
const NOM_A = { cbs: 8.4, ibsEstadual: 0.05, ibsMunicipal: 0.05 }; // 91x nos testes
const NOM_SETS: Record<string, Record<string, unknown>> = {
  A: NOM_A,
  B: { cbs: 8.8, ibsEstadual: 0.05, ibsMunicipal: 0.05 }, // docs/exemplos.md
  C: { cbs: 8.8123, ibsEstadual: 0.05, ibsMunicipal: 0.05 }, // Teste T4
  D: { cbs: 1, ibsEstadual: 0, ibsMunicipal: 0 },
  E: { cbs: 10.85, ibsEstadual: 0, ibsMunicipal: 0 },
  F: { cbs: 3.285, ibsEstadual: 0.365, ibsMunicipal: 0 },
  G: { cbs: 8.5, ibsEstadual: 1.6, ibsMunicipal: 0.25 },
};
/** Alíquotas nominais de IS usadas nos testes oficiais. */
const NOM_IS = { adRem: 21.3, adValorem: 13 };
/** Linha de alíquotas efetivas (fixture oficial do teste não assistido do Simples). */
const LINHA_SN = {
  fatorR: true,
  impedimentoSublimite: false,
  anexoI: { pCBSSN: "1.1612", pIBSSN: "0.0129" },
  anexoII: { pCBSSN: "1.1184", pIBSSN: "0.0121" },
  anexoIII: { pCBSSN: "2.2154", pIBSSN: "0.0257", semRedistribuicaoISS: { pCBSSN: "1.99", pIBSSN: "0.0231" } },
  anexoIV: { pCBSSN: "2.0119", pIBSSN: "0.022", semRedistribuicaoISS: { pCBSSN: "1.85", pIBSSN: "0.0202" } },
  anexoV: { pCBSSN: "3.2534", pIBSSN: "0.0363" },
};
/** Par pIBSSN/pCBSSN do contrato clássico (literal dos testes oficiais). */
const PAR_CLASSICO = { pIBSSN: "1.25", pCBSSN: "2.75" };

// ───────────────────────────── tipos / utilitários ──────────────────────────
type J = null | boolean | number | string | J[] | { [k: string]: J };
type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Req {
  method?: "GET" | "POST";
  path?: string; // relativo à base; padrão = endpoint do lote
  body?: J;
  tags?: string[]; // um por item (documentação)
}
interface Lote {
  /** arquivo relativo a OUT (sem .json) */
  file: string;
  api: "rr" | "sn";
  endpoint: string;
  method: "GET" | "POST";
  descricao: string;
  reqs: Req[];
}
const lotes: Lote[] = [];
const add = (l: Lote) => {
  if (l.reqs.length) lotes.push(l);
};
const chunk = <T,>(a: T[], n: number): T[][] => {
  const r: T[][] = [];
  for (let i = 0; i < a.length; i += n) r.push(a.slice(i, i + n));
  return r;
};
const uniq = <T,>(a: T[]) => [...new Set(a)];
const pad = (n: number, w = 4) => String(n).padStart(w, "0");
const fg = (d: string) => `${d}T12:00:00-03:00`;

function open(path: string) {
  if (!existsSync(path)) throw new Error(`Banco oficial ausente: ${path} (rode conformance/setup-official.sh)`);
  return new Database(path, { readonly: true, fileMustExist: true });
}

// ───────────────────────────── dados oficiais (regime) ──────────────────────
const db = open(DB_RR);
const q = <T = Obj,>(sql: string, ...p: unknown[]): T[] => db.prepare(sql).all(...p) as T[];

interface Cls {
  id: number;
  cd: string;
  cst: string;
  tributos: number[];
  tipo: string;
  trtr: number;
  exige: boolean;
  incomp: boolean;
  ini: string;
  fim: string | null;
  tprbsn: number;
  gIbsCbs: boolean;
}
const classes: Cls[] = q(`
  SELECT c.CLTR_ID id, c.CLTR_CD cd, s.SITR_CD cst, c.CLTR_TIPO_ALIQUOTA tipo,
         tc.TRCL_TRTR_ID trtr, t.TRTR_IN_EXIGE_GRUPO_DESONERACAO exige, t.TRTR_IN_INCOMPATIVEL_COM_SUSPENSAO incomp,
         c.CLTR_INICIO_VIGENCIA ini, c.CLTR_FIM_VIGENCIA fim, c.CLTR_TPRBSN tprbsn, s.SITR_IND_GIBSCBS gIbsCbs,
         (SELECT group_concat(TRST_TBTO_ID) FROM TRIBUTO_SITUACAO_TRIBUTARIA WHERE TRST_SITR_ID = s.SITR_ID) tributos
  FROM CLASSIFICACAO_TRIBUTARIA c
  JOIN SITUACAO_TRIBUTARIA s ON s.SITR_ID = c.CLTR_SITR_ID
  JOIN TRATAMENTO_CLASSIFICACAO tc ON tc.TRCL_CLTR_ID = c.CLTR_ID
  JOIN TRATAMENTO_TRIBUTARIO t ON t.TRTR_ID = tc.TRCL_TRTR_ID
  ORDER BY c.CLTR_CD, c.CLTR_ID`).map((r) => ({
  ...r,
  exige: !!r.exige,
  incomp: !!r.incomp,
  gIbsCbs: !!r.gIbsCbs,
  tributos: String(r.tributos).split(",").map(Number),
})) as Cls[];
const clsCbs = classes.filter((c) => c.tributos.includes(2));
const clsIs = classes.filter((c) => c.tributos.includes(1));

// NCM/NBS completos existentes
const ncmAll = q<{ c: string; fim: string }>(
  `SELECT NCM_CD c, NCM_FIM_VIGENCIA fim FROM NCM WHERE length(NCM_CD)=8 AND substr(NCM_FIM_VIGENCIA,1,4) >= '2034' ORDER BY NCM_CD`,
).map((r) => r.c);
const nbsAll = q<{ c: string }>(`SELECT NBS_CD c FROM NBS WHERE length(NBS_CD)=9 ORDER BY NBS_CD`).map((r) => r.c);

function expandir(prefixos: string[], universo: string[], len: number): string[] {
  const out: string[] = [];
  for (const p of prefixos) {
    if (p.length === len) {
      if (universo.includes(p)) out.push(p);
    } else {
      const m = universo.find((u) => u.startsWith(p));
      if (m) out.push(m);
      const ult = [...universo].reverse().find((u) => u.startsWith(p));
      if (ult && ult !== m) out.push(ult);
    }
  }
  return uniq(out).sort();
}

interface Nom {
  ncm: string[]; // vinculados por anexo (NCM_APLICAVEL), completos
  nbsAnexo: string[]; // vinculados por anexo (NBS_APLICAVEL)
  nbsIndop: string[]; // vinculados por CLASSIF_NBS_INDOP_LC
}
const nomCache = new Map<number, Nom>();
function nomDe(c: Cls): Nom {
  let n = nomCache.get(c.id);
  if (n) return n;
  const ncmP = q<{ p: string; id: number }>(`SELECT NCMA_NCM_CD p, NCMA_ID id FROM NCM_APLICAVEL WHERE NCMA_CLTR_ID=? ORDER BY NCMA_NCM_CD`, c.id);
  const exc = q<{ p: string; id: number }>(
    `SELECT ENCM_NCM_CD p, ENCM_NCMA_ID id FROM EXCECAO_NCM_APLICAVEL WHERE ENCM_NCMA_ID IN (SELECT NCMA_ID FROM NCM_APLICAVEL WHERE NCMA_CLTR_ID=?)`,
    c.id,
  );
  const ncmCand: string[] = [];
  for (const row of ncmP) {
    const ex = exc.filter((e) => e.id === row.id).map((e) => e.p);
    const cand = expandir([row.p], ncmAll, 8).filter((x) => !ex.some((e) => x.startsWith(e)));
    ncmCand.push(...cand);
  }
  const nbsP = q<{ p: string }>(`SELECT NBSA_NBS_CD p FROM NBS_APLICAVEL WHERE NBSA_CLTR_ID=? ORDER BY NBSA_NBS_CD`, c.id).map((r) => r.p);
  const indop = q<{ p: string }>(`SELECT DISTINCT CNIL_NBS_CD p FROM CLASSIF_NBS_INDOP_LC WHERE CNIL_CLTR_ID=? ORDER BY CNIL_NBS_CD`, c.id).map((r) => r.p);
  n = { ncm: uniq(ncmCand).sort(), nbsAnexo: expandir(nbsP.map((x) => x), nbsAll, 9), nbsIndop: indop.filter((x) => nbsAll.includes(x)) };
  nomCache.set(c.id, n);
  return n;
}
const first = <T,>(a: T[]) => (a.length ? a[0] : undefined);
const last = <T,>(a: T[]) => (a.length ? a[a.length - 1] : undefined);

// Nomenclatura "livre" (classes sem anexo aceitam qualquer NCM/NBS existente)
// menor NCM completo sem incidência de IS nem vínculo de anexo (NCM_APLICAVEL), para não disparar exigências adicionais
const ncmIs = q<{ n: string }>(`SELECT AAVP_NCM_CD n FROM ALIQUOTA_AD_VALOREM_PRODUTO UNION SELECT AARP_NCM_CD FROM ALIQUOTA_AD_REM_PRODUTO`).map((r) => r.n);
const ncmAnexo = q<{ n: string }>(`SELECT NCMA_NCM_CD n FROM NCM_APLICAVEL`).map((r) => r.n);
const NCM_LIVRE = ncmAll.find((n) => ![...ncmIs, ...ncmAnexo].some((p) => n.startsWith(p)))!;
const NBS_LIVRE = nbsAll[0];

// Locais: amostra de UFs/municípios reais da tabela oficial
const UFS = q<{ cd: number; sigla: string }>(`SELECT UF_CD cd, UF_SIGLA sigla FROM UF ORDER BY UF_CD`);
const SAMPLE_UFS = ["AC", "AM", "BA", "DF", "RJ", "RS", "SP", "EX"];
interface Loc { uf: string; mun: number }
const locs: Loc[] = [];
for (const s of SAMPLE_UFS) {
  const uf = UFS.find((u) => u.sigla === s);
  if (!uf) continue;
  const m = q<{ mn: number; mx: number }>(
    `SELECT min(MUNI_CD) mn, max(MUNI_CD) mx FROM MUNICIPIO WHERE MUNI_UF_CD=? AND MUNI_FIM_VIGENCIA IS NULL`,
    uf.cd,
  )[0];
  locs.push({ uf: s, mun: m.mn });
  if (m.mx !== m.mn) locs.push({ uf: s, mun: m.mx });
}
const MAIN: Loc = { uf: "RS", mun: 4314902 }; // Porto Alegre, exemplo do docs oficial; existe na tabela MUNICIPIO
if (!q(`SELECT 1 FROM MUNICIPIO WHERE MUNI_CD=?`, MAIN.mun).length) throw new Error("município de referência ausente da tabela oficial");

// Datas: uma por ano de transição presente nas tabelas oficiais de vigência
const ANOS = [2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034];
const dataAno = (y: number) => `${y}-06-30`;
// Datas de fronteira: todas as datas de início/fim de vigência das tabelas de vínculo/classificação/alíquota
const FRONTEIRAS = q<{ d: string }>(`
  SELECT d FROM (
    SELECT CLTR_INICIO_VIGENCIA d FROM CLASSIFICACAO_TRIBUTARIA UNION SELECT CLTR_FIM_VIGENCIA FROM CLASSIFICACAO_TRIBUTARIA
    UNION SELECT TRCL_INICIO_VIGENCIA FROM TRATAMENTO_CLASSIFICACAO UNION SELECT TRCL_FIM_VIGENCIA FROM TRATAMENTO_CLASSIFICACAO
    UNION SELECT PERE_INICIO_VIGENCIA FROM PERCENTUAL_REDUCAO UNION SELECT PERE_FIM_VIGENCIA FROM PERCENTUAL_REDUCAO
    UNION SELECT NCMA_INICIO_VIGENCIA FROM NCM_APLICAVEL UNION SELECT NBSA_INICIO_VIGENCIA FROM NBS_APLICAVEL
    UNION SELECT CNIL_INICIO_VIGENCIA FROM CLASSIF_NBS_INDOP_LC UNION SELECT CNIL_FIM_VIGENCIA FROM CLASSIF_NBS_INDOP_LC
    UNION SELECT TDCL_INICIO_VIGENCIA FROM TIPO_DFE_CLASSIFICACAO UNION SELECT TDCL_FIM_VIGENCIA FROM TIPO_DFE_CLASSIFICACAO
    UNION SELECT AADV_INICIO_VIGENCIA FROM ALIQUOTA_AD_VALOREM UNION SELECT AADV_FIM_VIGENCIA FROM ALIQUOTA_AD_VALOREM
    UNION SELECT ALRE_INICIO_VIGENCIA FROM ALIQUOTA_REFERENCIA UNION SELECT ALRE_FIM_VIGENCIA FROM ALIQUOTA_REFERENCIA
  ) WHERE d IS NOT NULL ORDER BY d`).map((r) => r.d.slice(0, 10));
// acrescenta o dia seguinte ao último fim de vigência (2034-01-01) e o dia anterior ao primeiro início
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const DATAS_FRONTEIRA = uniq([addDays(FRONTEIRAS[0], -1), ...FRONTEIRAS, addDays(FRONTEIRAS[FRONTEIRAS.length - 1], 1)]).sort();

// Regra de desoneração: tributacaoRegular (classificação da tributação "normal")
const regDefault = clsCbs.find((c) => c.cst === "000" && !c.exige && !c.incomp && !nomDe(c).ncm.length && !nomDe(c).nbsAnexo.length);
if (!regDefault) throw new Error("sem classificação para tributacaoRegular");

// ───────────────────────────── montagem de itens (regime) ───────────────────
interface Item { numero?: number; [k: string]: J | undefined }
let baseIdx = 0;
const nextBase = () => BASES[baseIdx++ % BASES.length];

function itemCbs(c: Cls, year: number, nomen: { ncm?: string; nbs?: string }, base: string, nomSet = "A"): Item {
  const it: Item = { cst: c.cst, cClassTrib: c.cd, baseCalculo: base as unknown as number };
  if (nomen.ncm) it.ncm = nomen.ncm;
  if (nomen.nbs) it.nbs = nomen.nbs;
  if (c.exige) it.tributacaoRegular = { cst: regDefault!.cst, cClassTrib: regDefault!.cd };
  if (year >= 2027 && nomSet) it.aliquotasNominais = NOM_SETS[nomSet] as J;
  return it;
}
/** baseCalculo em JSON deve ser número; preservamos o texto decimal via marcador e serialização customizada. */
const DEC = Symbol("dec");
function serialize(v: J | undefined): string {
  // Serializa números decimais "como escritos" (ex.: 1.00) quando o valor é string marcada com prefixo \u0000
  return JSON.stringify(v, (_k, x) => x).replace(/"\u0000([^"]*)"/g, "$1");
}
void DEC;
const dec = (s: string): J => ("\u0000" + s) as J; // número decimal literal (ex.: 100.00)
const withBase = (it: Item, base: string): Item => ({ ...it, baseCalculo: dec(base) });

function op(loc: Loc, date: string, itens: Item[], extra: Obj = {}): J {
  return {
    id: "conformance",
    versao: "1.0.0",
    dhFatoGerador: fg(date),
    municipio: loc.mun,
    uf: loc.uf,
    ...extra,
    itens: itens.map((it, i) => ({ numero: i + 1, ...it })) as J,
  };
}
const OBS = "calculadora/observabilidade/regime-geral";
const RG = "calculadora/regime-geral";

/** Parte itens (com tag) em requisições de até n itens. */
function pack(loc: Loc, date: string, items: { it: Item; tag: string }[], extra: Obj = {}, n = 40): Req[] {
  return chunk(items, n).map((g) => ({ body: op(loc, date, g.map((x) => x.it), extra), tags: g.map((x) => x.tag) }));
}

// ── Variantes de nomenclatura por classe ─────────────────────────────────────
interface Var { tag: string; nomen: { ncm?: string; nbs?: string }; core: boolean }
function variantes(c: Cls): Var[] {
  const n = nomDe(c);
  const v: Var[] = [{ tag: "sem", nomen: {}, core: true }];
  const n1 = first(n.ncm), n2 = last(n.ncm);
  const b1 = first(n.nbsAnexo), b2 = last(n.nbsAnexo);
  const i1 = first(n.nbsIndop), i2 = last(n.nbsIndop);
  if (n1) v.push({ tag: "ncm1", nomen: { ncm: n1 }, core: true });
  else v.push({ tag: "ncmL", nomen: { ncm: NCM_LIVRE }, core: true });
  if (b1) v.push({ tag: "nbs1", nomen: { nbs: b1 }, core: true });
  else if (i1) v.push({ tag: "nbsI1", nomen: { nbs: i1 }, core: true });
  else v.push({ tag: "nbsL", nomen: { nbs: NBS_LIVRE }, core: true });
  if (n2 && n2 !== n1) v.push({ tag: "ncm2", nomen: { ncm: n2 }, core: false });
  if (b2 && b2 !== b1) v.push({ tag: "nbs2", nomen: { nbs: b2 }, core: false });
  if (b1 && i1) v.push({ tag: "nbsI1", nomen: { nbs: i1 }, core: false });
  if (i2 && i2 !== i1 && !b1) v.push({ tag: "nbsI2", nomen: { nbs: i2 }, core: false });
  return v;
}

// Representantes: a menor cClassTrib CBS/IBS de cada tratamento tributário
const reps: Cls[] = [];
for (const c of clsCbs) if (!reps.some((r) => r.trtr === c.trtr)) reps.push(c);
const repVar = (c: Cls): Var => variantes(c).find((v) => v.tag !== "sem") ?? variantes(c)[0];

// ───────────────────────────── LOTES: regime regular ────────────────────────
function lotesRegime() {
  // 02 — matriz CST × cClassTrib × ano × nomenclatura
  for (const y of ANOS) {
    const date = dataAno(y);
    const items: { it: Item; tag: string }[] = [];
    for (const c of clsCbs)
      for (const v of variantes(c)) {
        if (!v.core && !(y === 2026 || y === 2027)) continue;
        items.push({ it: withBase(itemCbs(c, y, v.nomen, "0"), nextBase()), tag: `${c.cst}/${c.cd}|${v.tag}` });
      }
    add({ file: `regime-regular/matriz-cst-cclasstrib-${y}`, api: "rr", endpoint: OBS, method: "POST",
      descricao: `Todas as ${clsCbs.length} combinações CST×cClassTrib (CBS/IBS) do banco oficial, em ${date}, com variantes de NCM/NBS vinculados (tabelas NCM_APLICAVEL/NBS_APLICAVEL/CLASSIF_NBS_INDOP_LC) e base de cálculo rotativa. Local: ${MAIN.uf}/${MAIN.mun}.`,
      reqs: pack(MAIN, date, items) });
  }

  // 03 — Imposto Seletivo
  {
    const adRemNcm = q<{ n: string; u: string }>(`SELECT p.AARP_NCM_CD n, u.UNMD_SIGLA u FROM ALIQUOTA_AD_REM_PRODUTO p JOIN ALIQUOTA_AD_REM a ON a.AARE_ID=p.AARP_AARE_ID JOIN UNIDADE_MEDIDA u ON u.UNMD_ID=a.AARE_UNMD_ID ORDER BY 1`);
    const adValNcm = q<{ n: string }>(`SELECT DISTINCT AAVP_NCM_CD n FROM ALIQUOTA_AD_VALOREM_PRODUTO WHERE length(AAVP_NCM_CD)=8 ORDER BY 1`).map((r) => r.n);
    const amostra = [first(adValNcm), adValNcm[Math.floor(adValNcm.length / 2)], last(adValNcm)].filter(Boolean) as string[];
    const normal = clsCbs.find((c) => c.cd === "000001")!;
    const cand: { ncm: string; un: string | null; k: string }[] = [
      ...adRemNcm.map((r) => ({ ncm: r.n, un: r.u, k: "adRem" })),
      ...amostra.map((n, i) => ({ ncm: n, un: null, k: `adVal${i + 1}` })),
    ];
    for (const y of ANOS) {
      const date = dataAno(y);
      const items: { it: Item; tag: string }[] = [];
      for (const ic of clsIs)
        for (const nc of cand) {
          for (const modo of ["base", "informado"]) {
            if (modo === "informado" && !(y === 2026 || y === 2027)) continue;
            const base = nextBase();
            const is: Obj = { cst: ic.cst, cClassTrib: ic.cd, baseCalculo: dec(base) };
            if (nc.un) { is.quantidade = 1; is.unidade = nc.un; }
            if (modo === "informado") is.impostoInformado = dec("12.00");
            const it: Item = { ncm: nc.ncm, cst: normal.cst, cClassTrib: normal.cd, impostoSeletivo: is as J };
            if (modo === "informado") it.baseCalculo = dec((Number(base) + 12).toFixed(2));
            if (y >= 2027) it.aliquotasNominais = { ...NOM_A, impostoSeletivo: nc.un ? NOM_IS : { adValorem: NOM_IS.adValorem } } as J;
            items.push({ it, tag: `IS ${ic.cst}/${ic.cd}|${nc.k}|${modo}` });
          }
        }
      add({ file: `regime-regular/imposto-seletivo-${y}`, api: "rr", endpoint: OBS, method: "POST",
        descricao: `Imposto Seletivo em ${date}: todas as ${clsIs.length} classificações de IS × NCMs de IS do banco (ad rem: todos; ad valorem: primeiro/mediano/último), CBS/IBS por ${normal.cst}/${normal.cd}.`,
        reqs: pack(MAIN, date, items, {}, 30) });
    }
  }

  // 04 — bases de cálculo
  {
    const items: Map<number, { it: Item; tag: string }[]> = new Map();
    for (const y of [2026, 2027, 2033]) {
      const l: { it: Item; tag: string }[] = [];
      for (const c of reps) for (const b of BASES) l.push({ it: withBase(itemCbs(c, y, repVar(c).nomen, "0"), b), tag: `${c.cst}/${c.cd}|${repVar(c).tag}|b=${b}` });
      items.set(y, l);
    }
    for (const [y, l] of items)
      add({ file: `regime-regular/bases-${y}`, api: "rr", endpoint: OBS, method: "POST",
        descricao: `Varredura das ${BASES.length} bases de teste (${BASES.join(", ")}) sobre a menor cClassTrib de cada um dos ${reps.length} tratamentos tributários, em ${dataAno(y)}.`,
        reqs: pack(MAIN, dataAno(y), l) });
  }

  // 05 — UF/município
  for (const y of [2026, 2027]) {
    const reqs: Req[] = [];
    for (const loc of locs) {
      const l = reps.map((c) => ({ it: withBase(itemCbs(c, y, repVar(c).nomen, "0"), nextBase()), tag: `${c.cst}/${c.cd}|${repVar(c).tag}` }));
      reqs.push(...pack(loc, dataAno(y), l));
    }
    add({ file: `regime-regular/localidades-${y}`, api: "rr", endpoint: OBS, method: "POST",
      descricao: `Amostra de ${locs.length} municípios reais (menor e maior código vigente) em ${SAMPLE_UFS.length} UFs (${SAMPLE_UFS.join(", ")}) da tabela MUNICIPIO, para a menor cClassTrib de cada tratamento, em ${dataAno(y)}.`,
      reqs });
  }

  // 06 — compra governamental
  {
    const reqs: Req[] = [];
    for (const y of [2026, 2027, 2029, 2030, 2031, 2032, 2033]) {
      for (const ente of [1, 2, 3, 4, 5, 6]) {
        const l = reps.map((c) => ({ it: withBase(itemCbs(c, y, repVar(c).nomen, "0"), "1234.56"), tag: `${c.cst}/${c.cd}|ente=${ente}` }));
        reqs.push(...pack(MAIN, dataAno(y), l, { gCompraGov: { tpEnteGov: ente } }));
      }
    }
    for (const oper of [1, 2, 3, 4, 5])
      for (const ente of [1, 2, 4]) {
        const c = clsCbs.find((x) => x.cd === "000001")!;
        reqs.push(...pack(MAIN, dataAno(2027), [{ it: withBase(itemCbs(c, 2027, {}, "0"), "1234.56"), tag: `000001|ente=${ente}|oper=${oper}` }], { gCompraGov: { tpEnteGov: ente, tpOperGov: oper } }));
      }
    reqs.push(...pack(MAIN, dataAno(2027), [{ it: withBase(itemCbs(clsCbs[0], 2027, {}, "0"), "100.00"), tag: "ente-invalido" }], { gCompraGov: { tpEnteGov: 7 } }));
    reqs.push(...pack(MAIN, dataAno(2027), [{ it: withBase(itemCbs(clsCbs[0], 2027, {}, "0"), "100.00"), tag: "oper-invalido" }], { gCompraGov: { tpEnteGov: 2, tpOperGov: 9 } }));
    add({ file: "regime-regular/compra-governamental", api: "rr", endpoint: OBS, method: "POST",
      descricao: "gCompraGov: tpEnteGov 1..6 (enum do Java) × anos da transição CBS-ente (tabela TRANSFERENCIA_CBS_ENTE_GOV) × menor cClassTrib de cada tratamento; tpOperGov 1..5; valores inválidos.", reqs });
  }

  // 07 — aliquotasNominais (comportamento)
  {
    const reqs: Req[] = [];
    // (a) conjuntos de alíquotas oficiais de teste × tratamentos × 2027/2033
    for (const y of [2027, 2033])
      for (const [k, set] of Object.entries(NOM_SETS)) {
        const l = reps.map((c) => ({ it: withBase({ ...itemCbs(c, y, repVar(c).nomen, "0"), aliquotasNominais: set as J }, "1234.56"), tag: `${c.cst}/${c.cd}|nom=${k}` }));
        reqs.push(...pack(MAIN, dataAno(y), l));
      }
    // (b) ausência / parcialidade / uso indevido
    const alvo = clsCbs.filter((c) => c.gIbsCbs).slice(0, 1).concat(clsCbs.filter((c) => !c.gIbsCbs).slice(0, 2));
    for (const y of [2026, 2027, 2028, 2033]) {
      const l: { it: Item; tag: string }[] = [];
      for (const c of alvo) {
        const baseIt = (extra: Item) => withBase({ cst: c.cst, cClassTrib: c.cd, ...(c.exige ? { tributacaoRegular: { cst: regDefault!.cst, cClassTrib: regDefault!.cd } } : {}), ...extra }, "100.00");
        l.push({ it: baseIt({}), tag: `${c.cst}/${c.cd}|sem-nominais` });
        l.push({ it: baseIt({ aliquotasNominais: NOM_A as J }), tag: `${c.cst}/${c.cd}|nominais-completas` });
        l.push({ it: baseIt({ aliquotasNominais: { cbs: NOM_A.cbs } }), tag: `${c.cst}/${c.cd}|so-cbs` });
        l.push({ it: baseIt({ aliquotasNominais: { cbs: NOM_A.cbs, ibsEstadual: NOM_A.ibsEstadual } }), tag: `${c.cst}/${c.cd}|sem-ibsMun` });
        l.push({ it: baseIt({ aliquotasNominais: {} }), tag: `${c.cst}/${c.cd}|objeto-vazio` });
        l.push({ it: baseIt({ aliquotasNominais: { ...NOM_A, impostoSeletivo: NOM_IS } as J }), tag: `${c.cst}/${c.cd}|com-IS-sem-grupo-IS` });
        l.push({ it: baseIt({ aliquotasNominais: { cbs: 101, ibsEstadual: 0, ibsMunicipal: 0 } }), tag: `${c.cst}/${c.cd}|cbs>100` });
        l.push({ it: baseIt({ aliquotasNominais: { cbs: -1, ibsEstadual: 0, ibsMunicipal: 0 } }), tag: `${c.cst}/${c.cd}|cbs<0` });
        l.push({ it: baseIt({ aliquotasNominais: { cbs: 8.12345, ibsEstadual: 0, ibsMunicipal: 0 } }), tag: `${c.cst}/${c.cd}|5-casas` });
      }
      reqs.push(...pack(MAIN, dataAno(y), l, {}, 40));
    }
    // (c) alíquotas nominais iguais às de referência de 2026 aplicadas em 2027+ (equivalência)
    const refs = q<{ t: number; v: number }>(`SELECT ALRE_TBTO_ID t, ALRE_VALOR v FROM ALIQUOTA_REFERENCIA ORDER BY ALRE_TBTO_ID`);
    const refSet = { cbs: refs.find((r) => r.t === 2)!.v, ibsEstadual: refs.find((r) => r.t === 3)!.v, ibsMunicipal: refs.find((r) => r.t === 4)!.v };
    for (const y of [2027]) {
      const l = reps.map((c) => ({ it: withBase({ ...itemCbs(c, y, repVar(c).nomen, "0"), aliquotasNominais: refSet as J }, "1234.56"), tag: `${c.cst}/${c.cd}|nom=ref2026` }));
      reqs.push(...pack(MAIN, dataAno(y), l));
    }
    add({ file: "regime-regular/aliquotas-nominais", api: "rr", endpoint: OBS, method: "POST",
      descricao: "Papel de aliquotasNominais: conjuntos de teste (literais dos testes oficiais) sobre cada tratamento em 2027/2033; ausência/parcialidade/uso indevido (REG-036/REG-037) em 2026/2027/2028/2033; valores fora do domínio; as alíquotas de referência oficiais de 2026 reaplicadas em 2027.", reqs });
  }

  // 08 — tpDoc
  {
    const tipos = q<{ id: number; tipo: number; sigla: string }>(`SELECT TPDF_ID id, TPDF_TIPO tipo, TPDF_SIGLA sigla FROM TIPO_DFE ORDER BY TPDF_TIPO`);
    const noTrat = new Set(q<{ t: number }>(`SELECT TPDF_TIPO t FROM TIPO_DFE WHERE TPDF_B_POSSUI_TRATAMENTO_CALCULADORA=0`).map((r) => r.t));
    const reqsByDate = new Map<string, Req[]>();
    for (const date of [dataAno(2026), dataAno(2027)]) {
      const y = Number(date.slice(0, 4));
      const reqs: Req[] = [];
      for (const t of tipos) {
        const vinc = q<{ cd: string }>(`SELECT DISTINCT c.CLTR_CD cd FROM TIPO_DFE_CLASSIFICACAO d JOIN CLASSIFICACAO_TRIBUTARIA c ON c.CLTR_ID=d.TDCL_CLTR_ID WHERE d.TDCL_TPDF_ID=? ORDER BY 1`, t.id).map((r) => r.cd);
        const cl = clsCbs.filter((c) => vinc.includes(c.cd));
        const nao = clsCbs.filter((c) => !vinc.includes(c.cd)).slice(0, 3);
        const l: { it: Item; tag: string }[] = [];
        for (const c of [...cl, ...nao]) {
          const v = variantes(c);
          for (const vv of [v[0], v.find((x) => x.tag !== "sem")!]) {
            l.push({ it: withBase(itemCbs(c, y, vv.nomen, "0"), nextBase()), tag: `${c.cst}/${c.cd}|${vv.tag}|${vinc.includes(c.cd) ? "vinculada" : "NAO-vinculada"}` });
          }
        }
        reqs.push(...pack(MAIN, date, noTrat.has(t.tipo) ? l.slice(0, 3) : l, { tpDoc: t.tipo }, 40));
      }
      // tpDoc inexistente
      reqs.push({ body: op(MAIN, date, [withBase(itemCbs(clsCbs[0], y, {}, "0"), "100.00")], { tpDoc: 999 }), tags: ["tpDoc=999"] });
      reqsByDate.set(date, reqs);
    }
    for (const [date, reqs] of reqsByDate)
      add({ file: `regime-regular/tpdoc-${date.slice(0, 4)}`, api: "rr", endpoint: OBS, method: "POST",
        descricao: `tpDoc (TIPO_DFE.TPDF_TIPO) em ${date}: para cada tipo, as cClassTrib vinculadas (TIPO_DFE_CLASSIFICACAO) — com e sem NCM/NBS — e 3 cClassTrib NÃO vinculadas.`, reqs });
  }

  // 09 — fronteiras de vigência
  {
    const reqs: Req[] = [];
    for (const d of DATAS_FRONTEIRA) {
      const y = Number(d.slice(0, 4));
      const l: { it: Item; tag: string }[] = [];
      for (const c of reps) l.push({ it: withBase(itemCbs(c, y, repVar(c).nomen, "0"), "100.00"), tag: `${c.cst}/${c.cd}|${repVar(c).tag}` });
      // classes que começam ou terminam exatamente nesta data (ou no dia seguinte)
      for (const c of clsCbs.filter((c) => c.ini.slice(0, 10) === d || (c.fim ?? "").slice(0, 10) === d || (c.fim ?? "").slice(0, 10) === addDays(d, -1)))
        if (!reps.includes(c)) l.push({ it: withBase(itemCbs(c, y, {}, "0"), "100.00"), tag: `${c.cst}/${c.cd}|sem|vigencia-borda` });
      reqs.push(...pack(MAIN, d, l));
    }
    add({ file: "regime-regular/fronteiras-vigencia", api: "rr", endpoint: OBS, method: "POST",
      descricao: `Datas de início/fim de vigência (todas as ${DATAS_FRONTEIRA.length} datas distintas das tabelas oficiais de classificação, tratamento, redução, anexos, vínculos DFe, alíquotas e referência, mais o dia anterior e o posterior ao conjunto): ${DATAS_FRONTEIRA.join(", ")}.`, reqs });
  }

  // 10 — erros de operação (globais)
  {
    const it = withBase(itemCbs(clsCbs.find((c) => c.cd === "000001")!, 2026, {}, "0"), "100.00");
    const outraUf = q<{ m: number }>(`SELECT min(MUNI_CD) m FROM MUNICIPIO WHERE MUNI_UF_CD=35`)[0].m;
    const mk = (extra: Obj, tag: string, drop: string[] = []): Req => {
      const o = op(MAIN, "2026-06-30", [it], extra) as Obj;
      for (const k of drop) delete o[k];
      return { body: o as J, tags: [tag] };
    };
    const reqs = [
      mk({}, "referencia-valida"),
      mk({ uf: "ZZ" }, "uf-inexistente"),
      mk({ municipio: outraUf }, "municipio-de-outra-uf"),
      mk({ municipio: 1 }, "municipio-inexistente"),
      mk({ municipio: 12345678 }, "municipio>9999999"),
      mk({}, "sem-data", ["dhFatoGerador"]),
      mk({ dhFatoGerador: undefined, dataHoraEmissao: fg("2026-06-30") }, "dataHoraEmissao-obsoleta", ["dhFatoGerador"]),
      mk({}, "sem-uf-derivada-do-municipio", ["uf"]),
      mk({}, "sem-id", ["id"]),
      mk({}, "sem-versao", ["versao"]),
      mk({ itens: [] }, "itens-vazio"),
      mk({ tpDoc: 0 }, "tpDoc=0"),
      mk({ tpDoc: 1000 }, "tpDoc=1000"),
    ];
    // item com campos inválidos
    const bad = (extra: Item, tag: string): Req => ({ body: op(MAIN, "2026-06-30", [{ cst: "000", cClassTrib: "000001", baseCalculo: dec("100.00"), ...extra }]), tags: [tag] });
    reqs.push(
      bad({ cst: "00" }, "cst-2-digitos"), bad({ cst: "ABC" }, "cst-letras"), bad({ cClassTrib: "0000011" }, "cClassTrib-7-digitos"),
      bad({ cst: "999" }, "cst-inexistente"), bad({ cClassTrib: "999999" }, "cClassTrib-inexistente"),
      bad({ baseCalculo: dec("-1.00") }, "base-negativa"), bad({ baseCalculo: dec("1.234") }, "base-3-casas"),
      bad({ baseCalculo: undefined }, "sem-base"), bad({ quantidade: 0 }, "quantidade-0"), bad({ ncm: "22030000", nbs: NBS_LIVRE }, "ncm+nbs"),
      bad({ ncm: "99999999" }, "ncm-inexistente"), bad({ nbs: "999999999" }, "nbs-inexistente"),
    );
    add({ file: "regime-regular/operacao-erros", api: "rr", endpoint: OBS, method: "POST",
      descricao: "Erros globais (HTTP 422) e de validação por item: UF/município/data/tpDoc/itens e campos de item inválidos.", reqs });
  }

  // 11 — endpoint /regime-geral (falha na primeira inconsistência) — amostra
  {
    const reqs: Req[] = [];
    for (const y of [2026, 2027, 2030])
      for (const c of reps) reqs.push({ body: op(MAIN, dataAno(y), [withBase(itemCbs(c, y, repVar(c).nomen, "0"), nextBase())]), tags: [`${c.cst}/${c.cd}|${repVar(c).tag}`] });
    // mesma operação multi-item (com um item inválido) nos dois endpoints
    const itens = [clsCbs[0], clsCbs[1], clsCbs[2]].map((c) => ({ it: withBase(itemCbs(c, 2026, {}, "0"), nextBase()), tag: c.cd }));
    reqs.push(...pack(MAIN, "2026-06-30", itens));
    add({ file: "regime-regular/regime-geral-endpoint", api: "rr", endpoint: RG, method: "POST",
      descricao: "POST /regime-geral (resposta completa, aborta no primeiro erro): uma operação de 1 item por tratamento × 2026/2027/2030, mais uma de 3 itens.", reqs });
  }
}

// ───────────────────────────── oficiais (literais) ──────────────────────────
function lerJson(p: string): J { return JSON.parse(readFileSync(p, "utf8")) as J; }
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  }).sort();
}
function lotesOficiais() {
  if (!RR) { console.warn("RFB_REGIME_SRC não definido: lotes 'oficiais' omitidos"); return; }
  const base = join(RR, "src/test/resources/entradas");
  const files = walk(base).filter((f) => f.endsWith(".json"));
  const ops: Req[] = [], peds: Req[] = [], bcu: Req[] = [], bcn: Req[] = [];
  for (const f of files) {
    const rel = relative(base, f);
    if (/_output_|^xml\//.test(rel)) continue; // saídas esperadas / XML não são entradas de cálculo
    const body = lerJson(f) as Obj;
    const r: Req = { body: body as J, tags: [rel] };
    if (Array.isArray(body.trechos)) peds.push(r);
    else if ("anoFatoGerador" in body && "natureza" in body) bcu.push(r);
    else if ("anoFatoGerador" in body && "locacao" in body) bcn.push(r);
    else if (Array.isArray(body.itens)) ops.push(r);
    else console.warn("entrada oficial sem endpoint conhecido:", rel);
  }
  add({ file: "regime-regular/oficial-testes-observabilidade", api: "rr", endpoint: OBS, method: "POST",
    descricao: "Entradas LITERAIS de src/test/resources/entradas/** (formato de operação), enviadas ao endpoint com observabilidade.", reqs: ops });
  add({ file: "regime-regular/oficial-testes-regime-geral", api: "rr", endpoint: RG, method: "POST",
    descricao: "As mesmas entradas literais, enviadas a POST /regime-geral (aborta no primeiro erro).", reqs: ops.map((r) => ({ ...r })) });
  add({ file: "regime-regular/oficial-testes-pedagio", api: "rr", endpoint: "calculadora/pedagio", method: "POST",
    descricao: "Entradas literais de pedágio (entradas/pedagio, validacoes/pedagio, arredondamento/T6_pedagio).", reqs: peds });
  add({ file: "regime-regular/oficial-testes-base-calculo", api: "rr", endpoint: "calculadora/base-calculo/base-calculo-unificada", method: "POST",
    descricao: "Entradas literais da base de cálculo unificada (NF-e/NFC-e).", reqs: bcu });
  add({ file: "regime-regular/oficial-testes-base-calculo-nfse", api: "rr", endpoint: "calculadora/base-calculo/base-calculo-unificada-nfse", method: "POST",
    descricao: "Entrada literal da base de cálculo unificada da NFS-e.", reqs: bcn });

  // docs/exemplos.md — blocos JSON de entrada
  const md = readFileSync(join(RR, "docs/exemplos.md"), "utf8");
  const blocos = [...md.matchAll(/\*\*Entrada\*\* \(`([^`]+)`\):\s*```json\n([\s\S]*?)```/g)];
  const docOps: Req[] = [], docBase: Req[] = [];
  for (const b of blocos) {
    const body = JSON.parse(b[2]) as Obj;
    const r: Req = { body: body as J, tags: [`docs/exemplos.md#${b[1]}`] };
    if (Array.isArray(body.itens)) docOps.push(r); else if ("natureza" in body) docBase.push(r);
  }
  add({ file: "regime-regular/oficial-docs-exemplos", api: "rr", endpoint: OBS, method: "POST", descricao: "Operações de docs/exemplos.md (literais).", reqs: docOps });
  add({ file: "regime-regular/oficial-docs-exemplos-rg", api: "rr", endpoint: RG, method: "POST", descricao: "Operações de docs/exemplos.md em POST /regime-geral.", reqs: docOps.map((r) => ({ ...r })) });
  add({ file: "regime-regular/oficial-docs-exemplos-base", api: "rr", endpoint: "calculadora/base-calculo/base-calculo-unificada", method: "POST", descricao: "Base unificada de docs/exemplos.md (literal).", reqs: docBase });
}

// ───────────────────────────── LOTES: Simples Nacional ──────────────────────
function lotesSimples() {
  const sn = open(DB_SN);
  const qs = <T = Obj,>(sql: string, ...p: unknown[]): T[] => sn.prepare(sql).all(...p) as T[];
  const atividades = qs<{ id: number; cd: string; iss: number; anexoSem: string | null; anexoCom: string | null; naoTrib: number; benef: number; ini: string }>(
    `SELECT ATSN_ID id, ATSN_CATIVSN cd, ATSN_IN_ISS_NO_SIMPLES iss, ATSN_ANEXO_SEM_FATOR_R anexoSem, ATSN_ANEXO_COM_FATOR_R anexoCom, ATSN_IN_NAO_TRIBUTAVEL naoTrib, ATSN_IN_ADMITE_BENEFICIO_MUNICIPAL benef, ATSN_INICIO_VIGENCIA ini FROM ATIVIDADE_SIMPLES_NACIONAL ORDER BY ATSN_ORDEM`);
  const docs = qs<{ tipo: number; vocab: string; max: number | null; admiteIs: number }>(
    `SELECT t.TPDF_TIPO tipo, d.TDCS_VOCABULARIO_REGIME vocab, d.TDCS_MAXIMO_ITENS max, d.TDCS_IN_ADMITE_IS admiteIs FROM TIPO_DFE_CALCULO_SIMPLES_NACIONAL d JOIN TIPO_DFE t ON t.TPDF_ID=d.TDCS_TPDF_ID ORDER BY t.TPDF_TIPO`);
  const vinc = qs<{ cd: string; tipo: number }>(
    `SELECT a.ATSN_CATIVSN cd, t.TPDF_TIPO tipo FROM TIPO_DFE_ATIVIDADE_SIMPLES_NACIONAL x JOIN ATIVIDADE_SIMPLES_NACIONAL a ON a.ATSN_ID=x.TDAS_ATSN_ID JOIN TIPO_DFE t ON t.TPDF_ID=x.TDAS_TPDF_ID`);
  const ativDoc = (tipo: number) => {
    const comVinc = new Set(vinc.map((v) => v.cd));
    return atividades.filter((a) => !comVinc.has(a.cd) || vinc.some((v) => v.cd === a.cd && v.tipo === tipo)).map((a) => a.cd);
  };
  const enq = qs<{ voc: string; crt: number | null; tp: number | null; ops: number | null; reg: number | null }>(
    `SELECT ERSN_VOCABULARIO_REGIME voc, ERSN_CRT crt, ERSN_TPREGIMEIBSCBS tp, ERSN_OPSIMPNAC ops, ERSN_REGAPIBSCBSSN reg FROM ENQUADRAMENTO_REGIME_SIMPLES_NACIONAL ORDER BY ERSN_ID`);
  // classes CBS/IBS do banco do Simples (mesmos dados)
  const cls = qs<{ cd: string; cst: string; tprbsn: number; ini: string }>(
    `SELECT c.CLTR_CD cd, s.SITR_CD cst, c.CLTR_TPRBSN tprbsn, c.CLTR_INICIO_VIGENCIA ini FROM CLASSIFICACAO_TRIBUTARIA c JOIN SITUACAO_TRIBUTARIA s ON s.SITR_ID=c.CLTR_SITR_ID JOIN TRIBUTO_SITUACAO_TRIBUTARIA t ON t.TRST_SITR_ID=s.SITR_ID WHERE t.TRST_TBTO_ID=2 ORDER BY c.CLTR_CD, c.CLTR_ID`);
  /** cClassTrib vinculadas ao tipo de documento (TIPO_DFE_CLASSIFICACAO): só elas são admissíveis (VSN-022). */
  const vincCls = (tipo: number) => {
    const cds = new Set(qs<{ cd: string }>(`SELECT DISTINCT c.CLTR_CD cd FROM TIPO_DFE_CLASSIFICACAO d JOIN TIPO_DFE t ON t.TPDF_ID=d.TDCL_TPDF_ID JOIN CLASSIFICACAO_TRIBUTARIA c ON c.CLTR_ID=d.TDCL_CLTR_ID WHERE t.TPDF_TIPO=?`, tipo).map((r) => r.cd));
    return cls.filter((c) => cds.has(c.cd));
  };
  const repsFor = (tipo: number) => {
    const v = vincCls(tipo), out: typeof cls = [];
    for (const t of uniq(v.map((c) => c.tprbsn)).sort((a, b) => a - b)) out.push(...v.filter((c) => c.tprbsn === t).slice(0, 2));
    return out;
  };
  // nomenclatura para o Simples: sem exigir vínculo; usa a mesma lógica (anexo) do regime quando existir
  const clsRR = (cd: string, cst: string) => clsCbs.find((c) => c.cd === cd && c.cst === cst);
  const nomenSn = (cd: string, cst: string, which: "sem" | "ncm" | "nbs"): { ncm?: string; nbs?: string } => {
    const c = clsRR(cd, cst);
    if (!c || which === "sem") return {};
    const n = nomDe(c);
    if (which === "ncm") return { ncm: first(n.ncm) ?? NCM_LIVRE };
    return { nbs: first(n.nbsAnexo) ?? first(n.nbsIndop) ?? NBS_LIVRE };
  };

  const CLASSICO = "calculadora/observabilidade/simples-nacional";
  const NAOASS = "calculadora/observabilidade/simples-nacional/nao-assistido";
  const DATAS_SN = [addDays("2027-01-01", -1), ...ANOS.slice(1).map(dataAno)]; // 2026-12-31 (antes da vigência) + 2027..2034

  const sNum = (a: string, w = 0) => a + w;
  void sNum;

  // classico: contrato OperacaoSimplesInput
  const opClassico = (date: string, tpDoc: number, crt: number, tpReg: number | undefined, itens: Obj[], extra: Obj = {}): J => ({
    id: "conformance", versao: "2.0.0", data: date, tpDoc: String(tpDoc), CRT: String(crt),
    ...(tpReg ? { tpRegimeIBSCBS: String(tpReg) } : {}), ...extra,
    itens: itens.map((it, i) => ({ numero: i + 1, ...it })) as J,
  });
  const itClassico = (ativ: string, c: { cd: string; cst: string }, which: "sem" | "ncm" | "nbs", base: string): Obj => {
    const n = nomenSn(c.cd, c.cst, which);
    return { cAtivSN: ativ, cClassTrib: c.cd, baseCalculo: base, valorImpostoSeletivo: "0.00", ...PAR_CLASSICO, ...(n.ncm ? { NCM: n.ncm } : {}), ...(n.nbs ? { NBS: n.nbs } : {}) };
  };
  const regimesCrt: [number, number | undefined][] = [[1, undefined], [2, undefined], [3, 2]];

  // S1 — matriz atividade × tpRBSN × documento × regime × ano
  {
    for (const date of DATAS_SN) {
      const reqs: Req[] = [];
      const yr = Number(date.slice(0, 4));
      for (const d of docs) {
        if (d.tipo !== 55 && ![2027, 2030].includes(yr)) continue;
        for (const [crt, tp] of regimesCrt) {
          const l: { it: Obj; tag: string }[] = [];
          for (const a of ativDoc(d.tipo)) for (const c of repsFor(d.tipo)) l.push({ it: itClassico(a, c, "sem", nextBase()), tag: `ativ=${a}|${c.cst}/${c.cd}|tpRBSN=${c.tprbsn}` });
          for (const g of chunk(l, 40)) reqs.push({ body: opClassico(date, d.tipo, crt, tp, g.map((x) => x.it)), tags: g.map((x) => x.tag) });
        }
      }
      add({ file: `simples/classico-matriz-${date}`, api: "sn", endpoint: CLASSICO, method: "POST",
        descricao: `Contrato clássico (OBSOLETO no motor, mas ativo): atividades admissíveis (TIPO_DFE_ATIVIDADE_SIMPLES_NACIONAL) × 2 cClassTrib por tpRBSN × tpDoc (${docs.map((d) => d.tipo).join(",")}) × CRT (1; 2; 3+tpRegimeIBSCBS=2), data ${date}. pIBSSN/pCBSSN = ${JSON.stringify(PAR_CLASSICO)} (literal dos testes oficiais).`, reqs });
    }
  }
  // S2 — todas as cClassTrib × atividade rotativa × nomenclatura (NF-e)
  {
    const ativs = ativDoc(55);
    for (const date of [dataAno(2027), dataAno(2033)]) {
      const l: { it: Obj; tag: string }[] = [];
      let k = 0;
      for (const c of vincCls(55)) for (const w of ["sem", "ncm", "nbs"] as const) {
        const a = ativs[k++ % ativs.length];
        l.push({ it: itClassico(a, c, w, nextBase()), tag: `ativ=${a}|${c.cst}/${c.cd}|tpRBSN=${c.tprbsn}|${w}` });
      }
      add({ file: `simples/classico-cclasstrib-${date.slice(0, 4)}`, api: "sn", endpoint: CLASSICO, method: "POST",
        descricao: `Todas as ${vincCls(55).length} cClassTrib CBS/IBS vinculadas à NF-e (TIPO_DFE_CLASSIFICACAO) × {sem NCM/NBS, NCM, NBS} com atividade rotativa (admissíveis na NF-e), CRT=1, data ${date}.`,
        reqs: chunk(l, 40).map((g) => ({ body: opClassico(date, 55, 1, undefined, g.map((x) => x.it)), tags: g.map((x) => x.tag) })) });
    }
  }
  // S3 — compra governamental (tpEnteGov) e Imposto Seletivo informado
  {
    const reqs: Req[] = [];
    for (const date of DATAS_SN.slice(1)) for (const ente of ["1", "2", "3", "4", "5", "0"]) {
      const l = repsFor(55).map((c) => ({ it: itClassico("01", c, "sem", "1234.56"), tag: `${c.cst}/${c.cd}|ente=${ente}` }));
      for (const g of chunk(l, 40)) reqs.push({ body: opClassico(date, 55, 1, undefined, g.map((x) => x.it), { tpEnteGov: ente }), tags: g.map((x) => x.tag) });
    }
    for (const vis of ["0.00", "50.00", "-1.00", "1.234", "abc"]) {
      const c = repsFor(55)[0];
      reqs.push({ body: opClassico(dataAno(2027), 55, 1, undefined, [{ ...itClassico("01", c, "sem", "950.00"), valorImpostoSeletivo: vis }]), tags: [`vIS=${vis}`] });
    }
    add({ file: "simples/classico-compra-gov-is", api: "sn", endpoint: CLASSICO, method: "POST",
      descricao: "tpEnteGov (1..4 válidos; 5 e 0 inválidos) por ano da transição (TRANSICAO_ALIQUOTA_COMPRA_GOV_SIMPLES_NACIONAL) e valorImpostoSeletivo (válidos e inválidos).", reqs });
  }
  // S4 — erros globais do clássico
  {
    const c = repsFor(55)[1];
    const it = [itClassico("01", c, "sem", "100.00")];
    const mk = (tag: string, o: Obj): Req => ({ body: { ...(opClassico(dataAno(2027), 55, 1, undefined, it) as Obj), ...o } as J, tags: [tag] });
    const reqs: Req[] = [
      mk("referencia", {}), mk("sem-tpDoc", { tpDoc: undefined }), mk("tpDoc=999", { tpDoc: "999" }), mk("tpDoc=91", { tpDoc: "91" }),
      mk("CRT=4", { CRT: "4" }), mk("CRT=5", { CRT: "5" }), mk("sem-CRT", { CRT: undefined }), mk("CRT=3-sem-tpRegime", { CRT: "3" }),
      mk("CRT=1+tpRegime=1", { tpRegimeIBSCBS: "1" }), mk("CRT=1+tpRegime=2", { tpRegimeIBSCBS: "2" }), mk("CRT=3+tpRegime=1", { CRT: "3", tpRegimeIBSCBS: "1" }),
      mk("data-invalida", { data: "2027-13-45" }), mk("sem-data", { data: undefined }), mk("data-pre-vigencia", { data: "2026-12-31" }),
      mk("sem-itens", { itens: [] }), mk("sem-id", { id: undefined }), mk("sem-versao", { versao: undefined }),
    ];
    const bad = (tag: string, extra: Obj): Req => ({ body: opClassico(dataAno(2027), 55, 1, undefined, [{ ...itClassico("01", c, "sem", "100.00"), ...extra }]), tags: [tag] });
    reqs.push(
      bad("sem-cAtivSN", { cAtivSN: undefined }), bad("cAtivSN-inexistente", { cAtivSN: "99" }), bad("cAtivSN-fora-do-doc", { cAtivSN: "07" }),
      bad("sem-pIBSSN", { pIBSSN: undefined }), bad("sem-pCBSSN", { pCBSSN: undefined }), bad("pIBSSN-invalida", { pIBSSN: "abc" }),
      bad("base-invalida", { baseCalculo: "x" }), bad("sem-cClassTrib", { cClassTrib: undefined }), bad("cClassTrib-inexistente", { cClassTrib: "999999" }),
      bad("ncm+nbs", { NCM: NCM_LIVRE, NBS: NBS_LIVRE }),
    );
    add({ file: "simples/classico-erros", api: "sn", endpoint: CLASSICO, method: "POST", descricao: "Erros globais (422) e por item (VSN-*) do contrato clássico.", reqs });
  }

  // não assistido — CRT
  const opNA = (date: string, o: Obj, itens: Obj[]): J => ({ id: "conformance", versao: "3.0.0", data: date, ...o, itens: itens.map((it, i) => ({ numero: i + 1, ...it })) as J });
  const itNA = (ativ: string | undefined, c: { cd: string; cst: string }, which: "sem" | "ncm" | "nbs", base: string, extra: Obj = {}): Obj => {
    const n = nomenSn(c.cd, c.cst, which);
    return { ...(ativ ? { cAtivSN: ativ } : {}), cClassTrib: c.cd, baseCalculo: base, ...(n.ncm ? { NCM: n.ncm } : {}), ...(n.nbs ? { NBS: n.nbs } : {}), ...extra };
  };
  {
    for (const date of [dataAno(2027), dataAno(2030), dataAno(2033)]) {
      const reqs: Req[] = [];
      for (const e of enq.filter((x) => x.voc === "CRT"))
        for (const d of docs.filter((x) => x.vocab === "CRT"))
          for (const fatorR of date === dataAno(2027) ? [true, false] : [true])
            for (const imp of [false, true]) {
              if (imp && date !== dataAno(2027)) continue;
              const l: { it: Obj; tag: string }[] = [];
              for (const a of ativDoc(d.tipo)) for (const c of repsFor(d.tipo)) l.push({ it: itNA(a, c, "sem", nextBase(), { valorImpostoSeletivo: "0.00" }), tag: `ativ=${a}|${c.cst}/${c.cd}|tpRBSN=${c.tprbsn}` });
              for (const g of chunk(l, 40))
                reqs.push({
                  body: opNA(date, { tpDoc: String(d.tipo), CRT: String(e.crt), ...(e.tp ? { tpRegimeIBSCBS: String(e.tp) } : {}), aliquotasEfetivas: { ...LINHA_SN, fatorR, impedimentoSublimite: imp } }, g.map((x) => x.it)),
                  tags: g.map((x) => `CRT=${e.crt}/${e.tp ?? "-"}|doc=${d.tipo}|fatorR=${fatorR}|imp=${imp}|${x.tag}`),
                });
            }
      add({ file: `simples/nao-assistido-crt-${date}`, api: "sn", endpoint: NAOASS, method: "POST",
        descricao: `Não assistido, documentos com CRT (ENQUADRAMENTO_REGIME_SIMPLES_NACIONAL vocabulário CRT) × tpDoc × atividades admissíveis × 2 cClassTrib por tpRBSN × fatorR {true,false} × impedimentoSublimite {false,true@2027}, data ${date}. Linha de alíquotas = fixture oficial do teste (ver README).`, reqs });
    }
  }
  // não assistido — NFS-e
  {
    const nfse = docs.find((d) => d.tipo === 91);
    if (nfse) for (const date of [dataAno(2027), dataAno(2031)]) {
      const reqs: Req[] = [];
      for (const e of enq.filter((x) => x.voc === "NFSE"))
        for (const a of atividades.filter((x) => ativDoc(91).includes(x.cd)))
          for (const c of repsFor(91).filter((x, i, a) => a.findIndex((y) => y.tprbsn === x.tprbsn) === i).slice(0, 3)) {
            const combos: Obj[] = [{}];
            if (a.iss) {
              combos.length = 0;
              for (const trib of ["1", "2", "3", "4"]) {
                if (trib === "1") for (const ret of ["1", "2", "3"]) for (const bm of a.benef ? [undefined, "1", "2", "3", "4"] : [undefined]) combos.push({ tribISSQN: trib, tpRetISSQN: ret, ...(bm ? { tpBM: bm } : {}) });
                else combos.push({ tribISSQN: trib });
              }
            }
            for (const cb of date === dataAno(2027) ? combos : combos.slice(0, 1))
              reqs.push({
                body: opNA(date, { tpDoc: "91", opSimpNac: String(e.ops), regApIBSCBSSN: String(e.reg), regApTribSN: "1", aliquotasEfetivas: { ...LINHA_SN, fatorR: true } }, [itNA(a.cd, c, "sem", nextBase(), cb)]),
                tags: [`opSimpNac=${e.ops}|regAp=${e.reg}|ativ=${a.cd}|${c.cst}/${c.cd}|tpRBSN=${c.tprbsn}|${JSON.stringify(cb)}`],
              });
          }
      add({ file: `simples/nao-assistido-nfse-${date}`, api: "sn", endpoint: NAOASS, method: "POST",
        descricao: `Não assistido NFS-e (tpDoc 91, 1 item/operação): enquadramentos NFSE × atividades 07..14,90 × cClassTrib × tribISSQN/tpRetISSQN/tpBM nas atividades com ISS, data ${date}.`, reqs });
    }
  }
  // não assistido — fator R, regApTribSN, anexos, erros
  {
    const reqs: Req[] = [];
    const c = repsFor(55).find((x) => x.tprbsn === 1)!;
    const crt = (o: Obj, itens: Obj[], date = dataAno(2027)) => ({ body: opNA(date, { tpDoc: "55", CRT: "1", aliquotasEfetivas: LINHA_SN, ...o }, itens), tags: [JSON.stringify(o).slice(0, 80)] });
    reqs.push(crt({}, [itNA("09", c, "sem", "1000.00", { valorImpostoSeletivo: "0.00" })]));
    reqs.push(crt({ aliquotasEfetivas: { ...LINHA_SN, fatorR: undefined } }, [itNA("09", c, "sem", "1000.00", { valorImpostoSeletivo: "0.00" })]));
    reqs.push(crt({ aliquotasEfetivas: undefined }, [itNA("01", c, "sem", "1000.00", { valorImpostoSeletivo: "0.00" })]));
    for (const anexo of ["anexoI", "anexoII", "anexoIII", "anexoIV", "anexoV"])
      reqs.push(crt({ aliquotasEfetivas: { ...LINHA_SN, [anexo]: undefined } }, atividades.filter((a) => (a.anexoSem ?? "").length && (`anexo${a.anexoSem}` === anexo)).map((a) => itNA(a.cd, c, "sem", "1000.00", { valorImpostoSeletivo: "0.00" })).slice(0, 1)));
    for (const [tag, o] of [["CRT=4", { CRT: "4" }], ["CRT=3-sem-tpRegime", { CRT: "3" }], ["CRT=1+tpRegime=1-SOMENTE_RECEITA", { tpRegimeIBSCBS: "1" }], ["tpDoc=91+CRT", { tpDoc: "91" }], ["opSimpNac-em-CRT", { opSimpNac: "3" }]] as [string, Obj][])
      reqs.push({ ...crt(o, [itNA("01", c, "sem", "1000.00", { valorImpostoSeletivo: "0.00" })]), tags: [tag] });
    add({ file: "simples/nao-assistido-variados", api: "sn", endpoint: NAOASS, method: "POST", descricao: "Não assistido: exigência condicional de fatorR/aliquotasEfetivas/anexos, escopo (CRT 4, regime regular) e proibições.", reqs });
  }

  // catálogo de atividades (GET)
  {
    const reqs: Req[] = [];
    for (const d of DATAS_SN) reqs.push({ method: "GET", path: `calculadora/simples-nacional/atividades?data=${d}`, tags: [d] });
    for (const a of atividades) reqs.push({ method: "GET", path: `calculadora/simples-nacional/atividades/${a.cd}?data=${dataAno(2027)}`, tags: [a.cd] });
    reqs.push({ method: "GET", path: `calculadora/simples-nacional/atividades/99?data=${dataAno(2027)}`, tags: ["inexistente"] });
    for (const t of docs) reqs.push({ method: "GET", path: `calculadora/simples-nacional/atividades?data=${dataAno(2027)}&tpDoc=${t.tipo}`, tags: [`tpDoc=${t.tipo}`] });
    for (const anexos of ["I", "II", "III", "IV", "V", "III,V", "I,II,III,IV,V"]) reqs.push({ method: "GET", path: `calculadora/simples-nacional/atividades?data=${dataAno(2027)}&anexos=${anexos}`, tags: [`anexos=${anexos}`] });
    for (const c of repsFor(55)) reqs.push({ method: "GET", path: `calculadora/simples-nacional/atividades?data=${dataAno(2027)}&cClassTrib=${c.cd}`, tags: [`cClassTrib=${c.cd}`] });
    reqs.push({ method: "GET", path: "calculadora/simples-nacional/atividades", tags: ["sem-data"] });
    add({ file: "simples/atividades-catalogo", api: "sn", endpoint: "calculadora/simples-nacional/atividades", method: "GET", descricao: "Catálogo oficial de atividades (GET) por data, código, anexos, tpDoc e cClassTrib.", reqs });
  }
}

// ───────────────────────────── execução ─────────────────────────────────────
interface CaseOut {
  id: string;
  path?: string;
  method?: string;
  tags?: string[];
  request?: J;
  status: number;
  warn?: string;
  response: unknown;
}
const stats = { cases: 0, itens: 0, porEstado: {} as Record<string, number>, porCodigo: {} as Record<string, number>, porStatus: {} as Record<string, number>, porLote: {} as Record<string, Obj> };
const engine: Obj = {};

async function call(base: string, endpoint: string, method: "GET" | "POST", body: J | undefined): Promise<{ status: number; warn?: string; resp: unknown; app: string | null; dbv: string | null }> {
  const url = `${base}/${endpoint}`;
  let lastErr: unknown;
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json", Accept: "application/json" }, body: method === "POST" ? serialize(body) : undefined });
      const txt = await r.text();
      let resp: unknown = txt;
      try { resp = JSON.parse(txt); } catch { /* texto */ }
      return { status: r.status, warn: r.headers.get("x-warning-dados-simulados") ?? undefined, resp, app: r.headers.get("x-calc-app-version"), dbv: r.headers.get("x-calc-db-version") };
    } catch (e) { lastErr = e; await new Promise((s) => setTimeout(s, 500)); }
  }
  throw lastErr;
}

/** Campos `timestamp` (hora do servidor) são não determinísticos: substituídos por "<TIMESTAMP>" (documentado no README). */
function maskTs(o: unknown) {
  if (Array.isArray(o)) o.forEach(maskTs);
  else if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o as Obj)) {
      if (k === "timestamp" && typeof v === "string") (o as Obj)[k] = "<TIMESTAMP>";
      else {
        // A ordem das violações de Bean Validation (VAL-*) vem de um Set do Java e NÃO é estável entre execuções:
        // ordenamos por (pointer, code, detail) para tornar o corpus reprodutível.
        if ((k === "erros" || k === "errors") && Array.isArray(v) && v.length > 1 && v.every((e) => typeof e?.code === "string" && e.code.startsWith("VAL-")))
          v.sort((a: Obj, b: Obj) => (String(a.pointer) + a.code + a.detail).localeCompare(String(b.pointer) + b.code + b.detail));
        maskTs(v);
      }
    }
  }
}

function tally(resp: unknown, status: number) {
  stats.porStatus[status] = (stats.porStatus[status] ?? 0) + 1;
  const r = resp as Obj;
  const objs = r?.objetos;
  if (Array.isArray(objs)) {
    for (const o of objs) {
      stats.itens++;
      const e = String(o.estadoItem ?? o.estado ?? "?");
      stats.porEstado[e] = (stats.porEstado[e] ?? 0) + 1;
      for (const er of o.erros ?? []) stats.porCodigo[er.code] = (stats.porCodigo[er.code] ?? 0) + 1;
    }
  }
  if (r && Array.isArray(r.errors)) for (const er of r.errors) if (er.code) stats.porCodigo[er.code] = (stats.porCodigo[er.code] ?? 0) + 1;
  if (r && typeof r === "object" && !Array.isArray(r) && "code" in r) stats.porCodigo[String(r.code)] = (stats.porCodigo[String(r.code)] ?? 0) + 1;
}

async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

async function main() {
  lotesRegime();
  lotesOficiais();
  lotesSimples();
  if (!DRY) {
    // versão do motor (headers X-CALC-*) lida de chamadas de sondagem
    const p1 = await call(URL_RR, OBS, "POST", op(MAIN, "2026-06-30", [withBase({ cst: "000", cClassTrib: "000001" }, "1.00")]));
    const p2 = await call(URL_SN, "calculadora/observabilidade/simples-nacional", "POST", { id: "p", versao: "2.0.0", data: "2027-06-30", tpDoc: "55", CRT: "1", itens: [{ numero: 1, cAtivSN: "01", cClassTrib: "000001", baseCalculo: "1.00", valorImpostoSeletivo: "0.00", ...PAR_CLASSICO }] });
    if (!p1.app || !p2.app) throw new Error("APIs oficiais não responderam com X-CALC-APP-VERSION (rode setup-official.sh)");
    engine.rr = { app: p1.app, db: p1.dbv };
    engine.sn = { app: p2.app, db: p2.dbv };
  }
  const sel = lotes.filter((l) => !ONLY || l.file.includes(ONLY));
  const nReq = sel.reduce((s, l) => s + l.reqs.length, 0);
  console.log(`${sel.length} lotes, ${nReq} requisições${DRY ? " (dry-run)" : ""}`);
  if (DRY) { for (const l of sel) console.log(`  ${l.file}: ${l.reqs.length} reqs`); return; }
  if (!ONLY) rmSync(OUT, { recursive: true, force: true });
  const sha = (n: string) => (existsSync(join(ROOT, "scripts/rfb-sources.lock")) ? readFileSync(join(ROOT, "scripts/rfb-sources.lock"), "utf8").split("\n").find((l) => l.startsWith(n))?.split(/\s+/)[1] : undefined) ?? null;
  for (const l of sel) {
    const base = l.api === "rr" ? URL_RR : URL_SN;
    const res = await pool(l.reqs, 6, async (rq, i) => {
      const method = rq.method ?? l.method;
      const path = rq.path ?? l.endpoint;
      const r = await call(base, path, method, rq.body);
      if (r.app && r.dbv) engine[l.api] ??= { app: r.app, db: r.dbv };
      if (r.app && r.dbv && (engine[l.api].app !== r.app || engine[l.api].db !== r.dbv)) throw new Error("versão do motor mudou durante a geração");
      maskTs(r.resp);
      const c: CaseOut = { id: `${l.file.split("/").pop()}-${pad(i + 1)}`, status: r.status, response: r.resp };
      if (rq.path) c.path = rq.path;
      if (rq.method && rq.method !== l.method) c.method = rq.method;
      if (rq.tags) c.tags = rq.tags;
      if (rq.body !== undefined) c.request = JSON.parse(serialize(rq.body)) as J;
      if (r.warn) c.warn = r.warn;
      return c;
    });
    for (const c of res) tally(c.response, c.status);
    stats.cases += res.length;
    const file = join(OUT, `${l.file}.json`);
    mkdirSync(dirname(file), { recursive: true });
    const doc = {
      meta: {
        lote: l.file, descricao: l.descricao, api: l.api === "rr" ? "regime-regular" : "simples-nacional", endpoint: l.endpoint, method: l.method,
        motor: { aplicacao: engine[l.api].app, bancoDeDados: engine[l.api].db, repo: l.api === "rr" ? "calculadora-rtc-regime-regular" : "calculadora-rtc-simples-nacional", sha: sha(l.api === "rr" ? "calculadora-rtc-regime-regular" : "calculadora-rtc-simples-nacional") },
        nota: "request/response como trocados com o motor oficial (exceções normalizadas: campos timestamp => <TIMESTAMP>; arrays de erros só-VAL-* ordenados por pointer/code/detail, pois a ordem do motor não é estável); tags = descrição de cada item (documentação, não faz parte do contrato); warn = header x-warning-dados-simulados.",
      },
      cases: res,
    };
    const body = JSON.stringify(doc);
    writeFileSync(file, body + "\n");
    const itens = res.reduce((s, c) => s + (((c.request as Obj)?.itens as unknown[])?.length ?? 0), 0);
    stats.porLote[l.file] = { requisicoes: res.length, itens, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex").slice(0, 16) };
    console.log(`${l.file}: ${res.length} reqs, ${itens} itens, ${(body.length / 1024).toFixed(0)} KiB`);
  }
  if (!ONLY) {
    const manifest = { geradoPor: "conformance/generate-corpus.ts", motor: engine, ...stats };
    writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
  }
  console.log(JSON.stringify({ cases: stats.cases, porEstado: stats.porEstado, porStatus: stats.porStatus }, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
