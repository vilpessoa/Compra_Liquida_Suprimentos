/**
 * Testes do snapshot oficial RTC (src/data/rtc).
 * Nenhum valor tributario e digitado aqui: tudo e lido de meta.json, dos JSON e dos .sql oficiais em .rfb/.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "src", "data", "rtc");
const RFB = process.env.RFB_DIR ? path.resolve(process.env.RFB_DIR) : path.join(ROOT, ".rfb");
const REGIME = "calculadora-rtc-regime-regular";
const hasSources = fs.existsSync(path.join(RFB, REGIME, "flyway"));
if (!hasSources) console.warn(`[extract-rtc-data.test] fontes ausentes em ${RFB}: testes contra o SQL serao pulados (bash scripts/fetch-rfb-sources.sh)`);

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

type TableDump = { meta: { columns: { name: string; type: string; pk: number }[]; decimalAsStringColumns: string[]; rowCount: number }; rows: Record<string, unknown>[] };
type Meta = {
  sources: { repo: string; sha: string; date: string }[];
  appliedSql: { order: number; role: string; file: string; sha256: string }[];
  rowCounts: Record<string, number>;
  totalRows: number;
  files: Record<string, { sha256: string; bytes: number; tables: string[] }>;
  excludedInternalTables: string[];
};
const meta: Meta = JSON.parse(fs.readFileSync(path.join(DATA, "meta.json"), "utf8"));
const loaded = new Map<string, Record<string, TableDump>>();
const domain = (file: string) => {
  if (!loaded.has(file)) loaded.set(file, JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8")));
  return loaded.get(file)!;
};
const table = (name: string): TableDump => {
  for (const [file, info] of Object.entries(meta.files)) if (info.tables.includes(name)) return domain(file)[name];
  throw new Error(`tabela ${name} nao esta no meta`);
};

describe("meta.json x arquivos JSON", () => {
  it("hash e tamanho de cada JSON batem com o meta", () => {
    for (const [file, info] of Object.entries(meta.files)) {
      const buf = fs.readFileSync(path.join(DATA, file));
      expect(sha256(buf), file).toBe(info.sha256);
      expect(buf.length, file).toBe(info.bytes);
    }
  });

  it("nao ha JSON no diretorio fora do meta (alem do proprio meta.json)", () => {
    const onDisk = fs.readdirSync(DATA).filter((f) => f.endsWith(".json") && f !== "meta.json").sort();
    expect(onDisk).toEqual(Object.keys(meta.files).sort());
  });

  it("contagem de linhas: meta == cabecalho do JSON == linhas reais; total confere", () => {
    let total = 0;
    for (const [file, info] of Object.entries(meta.files)) {
      const d = domain(file);
      expect(Object.keys(d).sort(), file).toEqual([...info.tables].sort());
      for (const t of info.tables) {
        expect(d[t].rows.length, t).toBe(d[t].meta.rowCount);
        expect(d[t].rows.length, t).toBe(meta.rowCounts[t]);
        total += d[t].rows.length;
      }
    }
    expect(total).toBe(meta.totalRows);
  });

  it("colunas de cada linha sao exatamente as colunas declaradas (nomes originais)", () => {
    for (const [file, info] of Object.entries(meta.files)) {
      for (const t of info.tables) {
        const cols = domain(file)[t].meta.columns.map((c) => c.name);
        for (const r of domain(file)[t].rows) expect(Object.keys(r), t).toEqual(cols);
      }
    }
  });

  it("decimais sao string: nenhuma celula numerica nao inteira; colunas REAL viram string ou null", () => {
    for (const [file, info] of Object.entries(meta.files)) {
      for (const t of info.tables) {
        const d = domain(file)[t];
        const realCols = d.meta.columns.filter((c) => /REAL|NUM|DEC|FLOA|DOUB/i.test(c.type)).map((c) => c.name);
        for (const c of realCols) expect(d.meta.decimalAsStringColumns, `${t}.${c}`).toContain(c);
        for (const r of d.rows) {
          for (const [k, v] of Object.entries(r)) {
            if (typeof v === "number") expect(Number.isInteger(v), `${t}.${k}`).toBe(true);
            if (d.meta.decimalAsStringColumns.includes(k) && v !== null) {
              expect(typeof v, `${t}.${k}`).toBe("string");
              expect(Number.isFinite(Number(v)), `${t}.${k}`).toBe(true);
            }
          }
        }
      }
    }
  });
});

// --------------------------------------------------------------------------------------------
// Utilitarios de leitura do SQL fonte
// --------------------------------------------------------------------------------------------
type Tok = { t: "str"; v: string } | { t: "num"; v: string } | { t: "null" } | { t: "other"; v: string } | { t: "punct"; v: string };

/** Tokenizador minimo de SQL: ignora comentarios, entende 'strings' com '' e numeros. */
function tokenize(sql: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") { while (i < n && sql[i] !== "\n") i++; continue; }
    if (c === "/" && sql[i + 1] === "*") { const e = sql.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === "'") {
      let s = ""; i++;
      while (i < n) {
        if (sql[i] === "'") { if (sql[i + 1] === "'") { s += "'"; i += 2; continue; } i++; break; }
        s += sql[i++];
      }
      out.push({ t: "str", v: s });
      continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || ((c === "-" || c === ".") && /[0-9]/.test(sql[i + 1] ?? ""))) {
      const m = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(sql.slice(i, i + 64))!;
      out.push({ t: "num", v: m[0] }); i += m[0].length; continue;
    }
    if ((c === "X" || c === "x") && sql[i + 1] === "'") {
      // literal hexadecimal X'0a' (usado para quebras de linha em textos concatenados)
      const e = sql.indexOf("'", i + 2);
      out.push({ t: "str", v: Buffer.from(sql.slice(i + 2, e), "hex").toString("utf8") });
      i = e + 1; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(sql.slice(i, i + 128))!;
      out.push(m[0].toUpperCase() === "NULL" ? { t: "null" } : { t: "other", v: m[0] }); i += m[0].length; continue;
    }
    out.push({ t: "punct", v: c }); i++;
  }
  // concatenacao de literais: 'a' || X'0a' || 'b' -> 'a\nb'
  const merged: Tok[] = [];
  for (let k = 0; k < out.length; k++) {
    const t = out[k];
    const prev = merged[merged.length - 1];
    if (t.t === "punct" && t.v === "|" && (out[k + 1] as Tok | undefined)?.t === "punct" && (out[k + 1] as { v: string }).v === "|" && prev?.t === "str" && out[k + 2]?.t === "str") {
      merged[merged.length - 1] = { t: "str", v: prev.v + (out[k + 2] as { v: string }).v };
      k += 2;
      continue;
    }
    merged.push(t);
  }
  return merged;
}

/** Linhas de `INSERT INTO <table> (cols) VALUES (...),(...);` -> objetos coluna->valor literal. */
function insertRows(sql: string, tableName: string): Record<string, string | null>[] {
  const toks = tokenize(sql);
  const rows: Record<string, string | null>[] = [];
  for (let i = 0; i < toks.length; i++) {
    const a = toks[i], b = toks[i + 1], c = toks[i + 2];
    if (!(a.t === "other" && a.v.toUpperCase() === "INSERT" && b?.t === "other" && b.v.toUpperCase() === "INTO" && c?.t === "other" && c.v.toUpperCase() === tableName)) continue;
    let j = i + 3;
    if (toks[j]?.t !== "punct" || (toks[j] as { v: string }).v !== "(") throw new Error(`INSERT ${tableName} sem lista de colunas`);
    const cols: string[] = [];
    for (j++; !(toks[j].t === "punct" && (toks[j] as { v: string }).v === ")"); j++) if (toks[j].t === "other") cols.push((toks[j] as { v: string }).v);
    j++;
    if (!(toks[j].t === "other" && (toks[j] as { v: string }).v.toUpperCase() === "VALUES")) continue; // INSERT ... SELECT: ignorado
    j++;
    while (toks[j]?.t === "punct" && (toks[j] as { v: string }).v === "(") {
      const vals: (string | null)[] = [];
      for (j++; !(toks[j].t === "punct" && (toks[j] as { v: string }).v === ")"); j++) {
        const t = toks[j];
        if (t.t === "punct") continue; // virgula
        if (t.t === "null") vals.push(null);
        else if (t.t === "str" || t.t === "num") vals.push(t.v);
        else throw new Error(`expressao nao literal em INSERT ${tableName}: ${JSON.stringify(t)}`);
      }
      if (vals.length !== cols.length) throw new Error(`INSERT ${tableName}: ${vals.length} valores para ${cols.length} colunas`);
      rows.push(Object.fromEntries(cols.map((k, x) => [k, vals[x]])));
      j++;
      if (toks[j]?.t === "punct" && (toks[j] as { v: string }).v === ",") j++;
    }
    i = j;
  }
  return rows;
}

const sqlCache = new Map<string, string>();
const readSql = (rel: string) => {
  if (!sqlCache.has(rel)) sqlCache.set(rel, fs.readFileSync(path.join(RFB, REGIME, rel), "utf8"));
  return sqlCache.get(rel)!;
};
const appliedFiles = () => meta.appliedSql.map((a) => a.file);
const corpus = () => appliedFiles().map(readSql).join("\n");

/** O valor JSON (REAL como string canonica do SQLite) equivale ao literal SQL? Texto igual ou numericamente igual. */
const sameValue = (jsonV: unknown, sqlV: string | null, isDecimal: boolean) => {
  if (sqlV === null) return jsonV === null;
  if (jsonV === null) return false;
  if (isDecimal || typeof jsonV === "number") return Number(jsonV) === Number(sqlV);
  return jsonV === sqlV;
};

describe.skipIf(!hasSources)("snapshot x SQL oficial", () => {
  it("SHA-256 dos SQL aplicados registrados no meta bate com os arquivos fonte", () => {
    expect(meta.appliedSql.length).toBeGreaterThan(0);
    for (const a of meta.appliedSql) expect(sha256(fs.readFileSync(path.join(RFB, REGIME, a.file))), a.file).toBe(a.sha256);
  });

  it("fontes do meta == scripts/rfb-sources.lock e HEAD dos clones", () => {
    const lock = fs.readFileSync(path.join(ROOT, "scripts", "rfb-sources.lock"), "utf8").split("\n").filter((l) => l.trim()).map((l) => l.trim().split(/\s+/));
    expect(meta.sources.map((s) => [s.repo, s.sha, s.date])).toEqual(lock.map(([r, s, d]) => [r, s, d]));
    for (const s of meta.sources) {
      const head = fs.readFileSync(path.join(RFB, s.repo, ".git", "HEAD"), "utf8").trim();
      expect(head, s.repo).toBe(s.sha); // checkout --detach grava o SHA em HEAD
    }
  });

  it("ordem aplicada: beforeMigrate, B0001, V em ordem numerica, afterMigrate", () => {
    const roles = meta.appliedSql.map((a) => a.role);
    expect(roles[0]).toBe("beforeMigrate");
    expect(roles[1]).toBe("baseline");
    expect(roles[roles.length - 1]).toBe("afterMigrate");
    const versions = meta.appliedSql.filter((a) => a.role === "versioned").map((a) => Number(/\/V(\d+)__/.exec(a.file)![1]));
    expect(versions).toEqual([...versions].sort((x, y) => x - y));
    const onDisk = fs.readdirSync(path.join(RFB, REGIME, "flyway", "sql", "manutencao")).filter((f) => /^V\d+__.*\.sql$/.test(f));
    expect(versions.length).toBe(onDisk.length); // nenhuma migracao omitida
  });

  it("UF: JSON == INSERT do SQL (linha a linha) e nenhuma migracao posterior a altera", () => {
    expect(corpus()).not.toMatch(/^\s*(UPDATE|DELETE\s+FROM|DROP\s+TABLE|ALTER\s+TABLE)\s+UF\b/im);
    const sql = insertRows(corpus(), "UF");
    const json = table("UF");
    expect(sql.length).toBeGreaterThan(0);
    expect(json.rows.length).toBe(sql.length);
    sql.forEach((s, i) => {
      for (const [k, v] of Object.entries(s)) expect(sameValue(json.rows[i][k], v, false), `UF[${i}].${k}`).toBe(true);
    });
  });

  it("ALIQUOTA_REFERENCIA: cada linha do JSON existe no INSERT do SQL (valor, tributo, inicio); fim de vigencia vem do INSERT ou de UPDATE literal", () => {
    const all = corpus();
    const sqlRows = insertRows(readSql(meta.appliedSql.find((a) => a.role === "baseline")!.file), "ALIQUOTA_REFERENCIA");
    expect(sqlRows.length).toBeGreaterThan(0);
    const json = table("ALIQUOTA_REFERENCIA");
    expect(json.rows.length).toBeGreaterThan(0);
    expect(json.rows.length).toBeLessThanOrEqual(sqlRows.length);
    if (json.rows.length < sqlRows.length) expect(all).toMatch(/DELETE\s+FROM\s+ALIQUOTA_REFERENCIA/i); // reducao so por DELETE explicito
    const tokens = tokenize(all);
    const strLiterals = new Set(tokens.filter((t) => t.t === "str").map((t) => (t as { v: string }).v));
    for (const r of json.rows) {
      const s = sqlRows.find((x) => Number(x.ALRE_ID) === r.ALRE_ID);
      expect(s, `ALRE_ID ${r.ALRE_ID} ausente no INSERT`).toBeDefined();
      expect(sameValue(r.ALRE_VALOR, s!.ALRE_VALOR, true)).toBe(true);
      expect(sameValue(r.ALRE_TBTO_ID, s!.ALRE_TBTO_ID, false)).toBe(true);
      expect(sameValue(r.ALRE_INICIO_VIGENCIA, s!.ALRE_INICIO_VIGENCIA, false)).toBe(true);
      if (!sameValue(r.ALRE_FIM_VIGENCIA, s!.ALRE_FIM_VIGENCIA, false)) {
        expect(all).toMatch(/UPDATE\s+ALIQUOTA_REFERENCIA\s+SET\s+ALRE_FIM_VIGENCIA/i);
        expect(strLiterals.has(r.ALRE_FIM_VIGENCIA as string), "fim de vigencia deve ser literal do SQL").toBe(true);
      }
    }
  });

  it("proveniencia: todo valor textual/numerico de cada tabela aparece como literal nos SQL aplicados", () => {
    const toks = tokenize(corpus());
    const strs = new Set<string>();
    const nums = new Set<number>();
    for (const t of toks) {
      if (t.t === "str") { strs.add(t.v); if (/^-?\d+(\.\d+)?$/.test(t.v)) nums.add(Number(t.v)); }
      if (t.t === "num") nums.add(Number(t.v));
    }
    const exempt = new Set(["VERSAO_BASE_DADO.VRBD_DATA"]); // datetime('now') no momento da migracao (expressao, nao literal)
    const missing: string[] = [];
    for (const [file, info] of Object.entries(meta.files)) {
      for (const t of info.tables) {
        const d = domain(file)[t];
        for (const r of d.rows) {
          for (const [k, v] of Object.entries(r)) {
            if (v === null || exempt.has(`${t}.${k}`)) continue;
            const ok = typeof v === "number" ? nums.has(v) : d.meta.decimalAsStringColumns.includes(k) ? nums.has(Number(v)) : strs.has(v as string) || nums.has(Number(v));
            if (!ok && missing.length < 25) missing.push(`${t}.${k}=${JSON.stringify(v)}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
