/**
 * Extrai o snapshot oficial da Calculadora RTC (Receita Federal) para JSON.
 *
 * Fluxo:
 *  1. Le scripts/rfb-sources.lock e confere que .rfb/<repo> esta exatamente no SHA fixado e sem modificacoes.
 *  2. Le flyway/*.conf do repo regime-regular para descobrir `locations` e aplica as migracoes
 *     num SQLite em memoria seguindo a semantica Flyway (beforeMigrate -> B -> V em ordem numerica
 *     -> R -> afterMigrate; cada migracao em transacao, exceto as que alteram PRAGMA foreign_keys).
 *  3. Exporta TODAS as tabelas de usuario para src/data/rtc/*.json (colunas originais, REAL como string).
 *  4. Gera src/data/rtc/meta.json (fontes, SQL aplicados + SHA-256, contagens, SHA-256 dos JSON).
 *
 * Nenhum valor e digitado a mao: tudo vem dos .sql oficiais. Veja docs/DADOS_OFICIAIS.md.
 *
 * Uso: npm run extract:rtc   (RFB_DIR=<dir> sobrescreve o diretorio das fontes; padrao .rfb)
 */
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const RFB_DIR = process.env.RFB_DIR ? path.resolve(process.env.RFB_DIR) : path.join(ROOT, ".rfb");
const OUT_DIR = process.env.RTC_OUT_DIR ? path.resolve(process.env.RTC_OUT_DIR) : path.join(ROOT, "src", "data", "rtc");
const LOCK_FILE = path.join(ROOT, "scripts", "rfb-sources.lock");

const REPO_REGIME = "calculadora-rtc-regime-regular";
const REPO_SIMPLES = "calculadora-rtc-simples-nacional";

/** Dominio -> tabelas (nomes reais do banco). Toda tabela de usuario DEVE estar mapeada. */
const DOMAINS: Record<string, string[]> = {
  "aliquotas": [
    "TRIBUTO", "UNIDADE_MEDIDA", "ALIQUOTA_REFERENCIA", "ALIQUOTA_PADRAO", "AJUSTE", "REDUTOR",
    "REDUTOR_COMPRA_GOVERNAMENTAL", "TRANSFERENCIA_CBS_ENTE_GOV", "APROPRIACAO_CREDITO_ADQUIRENTE",
  ],
  "tratamentos-tributarios": ["TRATAMENTO_TRIBUTARIO", "TRATAMENTO_CLASSIFICACAO"],
  "situacoes-tributarias": ["SITUACAO_TRIBUTARIA", "TRIBUTO_SITUACAO_TRIBUTARIA"],
  "classificacoes-tributarias": ["CLASSIFICACAO_TRIBUTARIA", "PERCENTUAL_REDUCAO"],
  "fundamentacoes-legais": ["FUNDAMENTACAO_LEGAL", "FUNDAMENTACAO_CLASSIFICACAO"],
  "vinculos-ncm-nbs": [
    "NCM_APLICAVEL", "EXCECAO_NCM_APLICAVEL", "NBS_APLICAVEL", "EXCECAO_NBS_APLICAVEL",
    "CLASSIF_NBS_INDOP_LC", "INDICADOR_OPERACAO_IBS_CBS", "LISTA_SERVICOS_LC_116",
  ],
  "ncm": ["NCM"],
  "nbs": ["NBS"],
  "imposto-seletivo": [
    "ALIQUOTA_AD_VALOREM", "ALIQUOTA_AD_VALOREM_PRODUTO", "ALIQUOTA_AD_VALOREM_SERVICO",
    "ALIQUOTA_AD_REM", "ALIQUOTA_AD_REM_PRODUTO", "ALIQUOTA_AD_REM_SERVICO",
    "EXCECAO_AD_VALOREM_PRODUTO", "EXCECAO_AD_VALOREM_SERVICO", "EXCECAO_AD_REM_PRODUTO", "EXCECAO_AD_REM_SERVICO",
  ],
  "simples-nacional": [
    "ATIVIDADE_SIMPLES_NACIONAL", "ENQUADRAMENTO_REGIME_SIMPLES_NACIONAL", "REGIME_APURACAO_SIMPLES_NACIONAL",
    "SITUACAO_ISS_PAR_ALIQUOTA_SIMPLES_NACIONAL", "TIPO_DFE_ATIVIDADE_SIMPLES_NACIONAL",
    "TIPO_DFE_CALCULO_SIMPLES_NACIONAL", "TIPO_RECEITA_BRUTA_SIMPLES_NACIONAL",
    "TRANSICAO_ALIQUOTA_COMPRA_GOV_SIMPLES_NACIONAL",
  ],
  "anexos-nfse": ["ANEXO"],
  "documentos-fiscais": ["TIPO_DFE", "GRUPO_DFE", "TIPO_DFE_CLASSIFICACAO", "TOMADOR_ESPECIFICO"],
  "atores": ["GRUPO_ATOR", "ATOR", "ATOR_CLASSIFICACAO", "ATOR_CLASSIFICACAO_FUNDAMENTACAO"],
  "localidades": ["UF", "MUNICIPIO"],
  "versao-base": ["VERSAO_BASE_DADO"],
};

type Source = { repo: string; sha: string; date: string };
type Migration = { kind: "B" | "V" | "R"; version: number[]; description: string; file: string };

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();

function readLock(): Source[] {
  return fs
    .readFileSync(LOCK_FILE, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [repo, sha, date] = l.split(/\s+/);
      return { repo, sha, date };
    });
}

function verifySource(s: Source): string {
  const dir = path.join(RFB_DIR, s.repo);
  if (!fs.existsSync(path.join(dir, ".git"))) throw new Error(`fonte ausente: ${dir} (rode bash scripts/fetch-rfb-sources.sh)`);
  const head = git(dir, "rev-parse", "HEAD");
  if (head !== s.sha) throw new Error(`${s.repo}: HEAD ${head} != lock ${s.sha}`);
  if (git(dir, "status", "--porcelain")) throw new Error(`${s.repo}: working tree modificado; fonte deve ser somente leitura`);
  return dir;
}

/** Le .conf estilo Flyway (chave=valor, # comentario). */
function parseConf(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}

const cmpVersion = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

const CALLBACKS = new Set(["beforeMigrate", "afterMigrate"]);

function discoverMigrations(repoDir: string) {
  const flywayDir = path.join(repoDir, "flyway");
  const confs = fs.readdirSync(flywayDir).filter((f) => f.endsWith(".conf")).sort();
  if (!confs.length) throw new Error("nenhum .conf Flyway encontrado");
  const confInfo: Record<string, Record<string, string>> = {};
  const locations = new Set<string>();
  for (const c of confs) {
    const conf = parseConf(path.join(flywayDir, c));
    confInfo[c] = conf;
    for (const loc of (conf["flyway.locations"] ?? "").split(",").map((s) => s.trim()).filter(Boolean)) locations.add(loc);
  }
  if (!locations.size) throw new Error("flyway.locations ausente");

  const migrations: Migration[] = [];
  const callbacks: Record<string, string> = {};
  for (const loc of locations) {
    if (!loc.startsWith("filesystem:")) throw new Error(`location nao suportada: ${loc}`);
    const dir = path.resolve(repoDir, loc.slice("filesystem:".length)); // relativo a raiz do repo (cwd do mvnw)
    if (!fs.existsSync(dir)) throw new Error(`location inexistente: ${dir}`);
    for (const f of walk(dir).sort()) {
      const base = path.basename(f);
      if (!base.endsWith(".sql")) continue;
      const stem = base.slice(0, -4);
      if (CALLBACKS.has(stem)) {
        if (callbacks[stem]) throw new Error(`callback duplicado: ${stem}`);
        callbacks[stem] = f;
        continue;
      }
      if (/^(before|after)\w*$/.test(stem)) throw new Error(`callback Flyway nao suportado por este extrator: ${base}`);
      let m = /^([BV])(\d+(?:[._]\d+)*)__(.+)$/.exec(stem);
      if (m) {
        migrations.push({ kind: m[1] as "B" | "V", version: m[2].split(/[._]/).map(Number), description: m[3], file: f });
        continue;
      }
      m = /^R__(.+)$/.exec(stem);
      if (m) {
        migrations.push({ kind: "R", version: [], description: m[1], file: f });
        continue;
      }
      throw new Error(`SQL fora do padrao Flyway: ${f}`);
    }
  }
  return { confs, confInfo, locations: [...locations], migrations, callbacks };
}

/** Ordem Flyway: baseline B (maior versao) -> V (> baseline) por versao -> R por descricao. */
function orderMigrations(all: Migration[]): Migration[] {
  const bs = all.filter((m) => m.kind === "B").sort((a, b) => cmpVersion(a.version, b.version));
  const baseline = bs.length ? bs[bs.length - 1] : undefined;
  const vs = all.filter((m) => m.kind === "V").sort((a, b) => cmpVersion(a.version, b.version));
  for (let i = 1; i < vs.length; i++) {
    if (cmpVersion(vs[i - 1].version, vs[i].version) === 0) throw new Error(`versao duplicada: ${vs[i].file}`);
  }
  if (baseline) for (const v of vs) if (cmpVersion(v.version, baseline.version) <= 0) throw new Error(`V <= baseline: ${v.file}`);
  const rs = all.filter((m) => m.kind === "R").sort((a, b) => a.description.localeCompare(b.description));
  return [...(baseline ? [baseline] : []), ...vs, ...rs];
}

/**
 * Executa um script. O Flyway roda cada migracao dentro de uma transacao, salvo scripts que
 * alteram PRAGMA foreign_keys (que e no-op em transacao): esses rodam sem transacao (flyway.mixed=true).
 * `PRAGMA defer_foreign_keys` so funciona dentro de transacao, por isso a distincao e necessaria.
 */
function runScript(db: Database.Database, file: string): { transactional: boolean } {
  const sql = fs.readFileSync(file, "utf8");
  const transactional = !/^\s*PRAGMA\s+foreign_keys\s*=/im.test(sql);
  try {
    if (!transactional) {
      db.exec(sql);
    } else {
      db.exec("BEGIN");
      try {
        db.exec(sql);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
  } catch (e) {
    throw new Error(`falha ao aplicar ${path.basename(file)}: ${(e as Error).message}`);
  }
  return { transactional };
}

type ColInfo = { name: string; type: string; pk: number; notnull: boolean };

function exportTable(db: Database.Database, table: string) {
  const cols = (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; type: string; pk: number; notnull: number }[]).map(
    (c): ColInfo => ({ name: c.name, type: c.type, pk: c.pk, notnull: !!c.notnull }),
  );
  const pkCols = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => `"${c.name}"`);
  const orderBy = pkCols.length ? pkCols.join(", ") : "rowid";

  const decimalCols: string[] = [];
  for (const c of cols) {
    const has = db.prepare(`SELECT 1 FROM "${table}" WHERE typeof("${c.name}")='real' LIMIT 1`).get();
    const declaredDecimal = /REAL|NUM|DEC|FLOA|DOUB/i.test(c.type);
    if (has || declaredDecimal) {
      const bad = db.prepare(`SELECT count(*) n FROM "${table}" WHERE typeof("${c.name}")='real' AND CAST(CAST("${c.name}" AS TEXT) AS REAL) != "${c.name}"`).get() as { n: number };
      if (bad.n) throw new Error(`${table}.${c.name}: texto decimal nao reconverte ao mesmo valor (perda de precisao)`);
      decimalCols.push(c.name);
    }
    const blob = db.prepare(`SELECT 1 FROM "${table}" WHERE typeof("${c.name}")='blob' LIMIT 1`).get();
    if (blob) throw new Error(`${table}.${c.name}: BLOB nao suportado`);
  }
  // REAL -> texto canonico do SQLite (CAST AS TEXT); demais tipos inalterados
  const select = cols
    .map((c) => `CASE WHEN typeof("${c.name}")='real' THEN CAST("${c.name}" AS TEXT) ELSE "${c.name}" END AS "${c.name}"`)
    .join(", ");
  const rows = db.prepare(`SELECT ${select} FROM "${table}" ORDER BY ${orderBy}`).all() as Record<string, unknown>[];
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === "number" && !Number.isSafeInteger(v)) throw new Error(`${table}.${k}: inteiro fora da faixa segura`);
    }
  }
  return { cols, decimalCols, rows, orderBy };
}

function serializeDomain(tables: Record<string, ReturnType<typeof exportTable>>): string {
  const parts: string[] = [];
  for (const [name, t] of Object.entries(tables)) {
    const head = JSON.stringify({
      columns: t.cols.map((c) => ({ name: c.name, type: c.type, pk: c.pk })),
      decimalAsStringColumns: t.decimalCols,
      rowCount: t.rows.length,
    });
    const body = t.rows.map((r) => "      " + JSON.stringify(r)).join(",\n");
    parts.push(`  ${JSON.stringify(name)}: {\n    "meta": ${head},\n    "rows": [${t.rows.length ? "\n" + body + "\n    " : ""}]\n  }`);
  }
  return `{\n${parts.join(",\n")}\n}\n`;
}

function javaTableNames(repoDir: string): Set<string> {
  const names = new Set<string>();
  for (const f of walk(path.join(repoDir, "src", "main", "java")).filter((x) => x.endsWith(".java"))) {
    for (const m of fs.readFileSync(f, "utf8").matchAll(/@Table\s*\(\s*name\s*=\s*"([A-Z_0-9]+)"/g)) names.add(m[1]);
  }
  return names;
}

function main() {
  const lock = readLock();
  const sources = lock.map((s) => ({ ...s, dir: verifySource(s) }));
  const regime = sources.find((s) => s.repo === REPO_REGIME);
  const simples = sources.find((s) => s.repo === REPO_SIMPLES);
  if (!regime || !simples) throw new Error("lock deve conter regime-regular e simples-nacional");

  // Simples Nacional: confirma que NAO tem migracoes proprias (usa o banco do regime-regular)
  const simplesSql = walk(simples.dir).filter((f) => f.endsWith(".sql") && !f.includes(`${path.sep}.git${path.sep}`));
  if (fs.existsSync(path.join(simples.dir, "flyway")) || simplesSql.length) {
    throw new Error(`simples-nacional passou a ter migracoes proprias (${simplesSql.length} .sql): extrator precisa ser ajustado`);
  }
  const simplesReadme = fs.readFileSync(path.join(simples.dir, "README.md"), "utf8");
  if (!simplesReadme.includes("flyway/ presente no repositório https://github.com/ReceitaFederal/calculadora-rtc-regime-regular")) {
    throw new Error("README do simples-nacional nao confirma o uso das migracoes do regime-regular");
  }

  const { confs, confInfo, locations, migrations, callbacks } = discoverMigrations(regime.dir);
  const ordered = orderMigrations(migrations);

  const db = new Database(":memory:");
  const applied: { order: number; role: string; file: string; sha256: string; transactional: boolean }[] = [];
  const rel = (f: string) => path.relative(regime.dir, f).split(path.sep).join("/");
  const apply = (role: string, file: string) => {
    const { transactional } = runScript(db, file);
    applied.push({ order: applied.length + 1, role, file: rel(file), sha256: sha256(fs.readFileSync(file)), transactional });
  };
  if (callbacks.beforeMigrate) apply("beforeMigrate", callbacks.beforeMigrate);
  for (const m of ordered) apply(m.kind === "B" ? "baseline" : m.kind === "V" ? "versioned" : "repeatable", m.file);
  if (callbacks.afterMigrate) apply("afterMigrate", callbacks.afterMigrate);

  // Integridade pos-migracao
  const integrity = db.pragma("integrity_check") as { integrity_check: string }[];
  if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") throw new Error(`integrity_check falhou: ${JSON.stringify(integrity)}`);
  const fk = db.pragma("foreign_key_check") as unknown[];
  if (fk.length) throw new Error(`foreign_key_check: ${fk.length} violacoes`);

  // Tabelas de usuario (sqlite_* sao internas; sqlite_stat* vem do ANALYZE do afterMigrate)
  const dbTables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
  const mapped = Object.values(DOMAINS).flat();
  const dup = mapped.filter((t, i) => mapped.indexOf(t) !== i);
  if (dup.length) throw new Error(`tabela em mais de um dominio: ${dup.join(", ")}`);
  const unmapped = dbTables.filter((t) => !mapped.includes(t));
  const missing = mapped.filter((t) => !dbTables.includes(t));
  if (unmapped.length || missing.length) throw new Error(`tabelas nao mapeadas: [${unmapped}] ; mapeadas inexistentes: [${missing}]`);
  // Toda tabela consultada pelas entidades Java dos dois repos existe e foi exportada
  const javaTables = { [REPO_REGIME]: [...javaTableNames(regime.dir)].sort(), [REPO_SIMPLES]: [...javaTableNames(simples.dir)].sort() };
  for (const [repo, ts] of Object.entries(javaTables)) {
    const absent = ts.filter((t) => !mapped.includes(t));
    if (absent.length) throw new Error(`${repo}: entidades referenciam tabelas nao exportadas: ${absent.join(", ")}`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const f of fs.readdirSync(OUT_DIR)) if (f.endsWith(".json")) fs.rmSync(path.join(OUT_DIR, f));

  const rowCounts: Record<string, number> = {};
  const files: Record<string, { sha256: string; bytes: number; tables: string[] }> = {};
  let totalBytes = 0;
  for (const [domain, tables] of Object.entries(DOMAINS)) {
    const exported: Record<string, ReturnType<typeof exportTable>> = {};
    for (const t of tables) {
      const e = exportTable(db, t);
      const n = (db.prepare(`SELECT count(*) n FROM "${t}"`).get() as { n: number }).n;
      if (n !== e.rows.length) throw new Error(`${t}: contagem ${n} != exportado ${e.rows.length}`);
      exported[t] = e;
      rowCounts[t] = n;
    }
    const text = serializeDomain(exported);
    const buf = Buffer.from(text, "utf8");
    JSON.parse(text); // sanidade
    fs.writeFileSync(path.join(OUT_DIR, `${domain}.json`), buf);
    files[`${domain}.json`] = { sha256: sha256(buf), bytes: buf.length, tables };
    totalBytes += buf.length;
  }
  db.close();

  const meta = {
    generatedBy: "scripts/extract-rtc-data.ts",
    extractedAt: new Date().toISOString(),
    sources: lock.map((s) => ({
      repo: s.repo, sha: s.sha, date: s.date,
      url: `https://github.com/ReceitaFederal/${s.repo}`,
      role:
        s.repo === REPO_REGIME ? "migracoes Flyway aplicadas (fonte dos dados)"
        : s.repo === REPO_SIMPLES ? "sem migracoes proprias; usa o banco do regime-regular (verificado); usado so para conferir tabelas das entidades"
        : "nao usado na extracao de dados",
    })),
    flyway: {
      repo: REPO_REGIME,
      confFiles: confs.map((c) => ({ file: `flyway/${c}`, sha256: sha256(fs.readFileSync(path.join(regime.dir, "flyway", c))), settings: confInfo[c] })),
      locations,
      semantics: "beforeMigrate; baseline B; V em ordem numerica; R; afterMigrate. Transacao por migracao, exceto scripts com PRAGMA foreign_keys (sem transacao, flyway.mixed=true).",
    },
    appliedSql: applied,
    javaEntityTables: javaTables,
    excludedInternalTables: ["sqlite_stat1", "sqlite_stat4"],
    integrity: { integrity_check: "ok", foreign_key_violations: 0 },
    rowCounts,
    totalRows: Object.values(rowCounts).reduce((a, b) => a + b, 0),
    files,
    totalBytes,
  };
  fs.writeFileSync(path.join(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 2) + "\n");

  console.log(`SQL aplicados: ${applied.length}`);
  for (const t of Object.keys(rowCounts)) console.log(`  ${t.padEnd(48)} ${rowCounts[t]}`);
  for (const [f, i] of Object.entries(files)) console.log(`  ${f.padEnd(34)} ${(i.bytes / 1024).toFixed(1)} KiB`);
  console.log(`Total: ${meta.totalRows} linhas, ${(totalBytes / 1048576).toFixed(2)} MiB em ${Object.keys(files).length} arquivos -> ${path.relative(ROOT, OUT_DIR)}`);
}

main();
