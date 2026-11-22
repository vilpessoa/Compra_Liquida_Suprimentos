/**
 * Teste diferencial (fuzz) motor local × motor oficial RFB em execução.
 *
 * Usa as estruturas de requisição do corpus golden (já válidas e cobrindo todas as combinações
 * CST × cClassTrib), sorteia novos valores numéricos (bases, quantidades, alíquotas nominais,
 * alíquotas efetivas do Simples) e novas datas no mesmo ano, envia a MESMA requisição aos dois
 * motores e compara status + corpo (normalizações iguais às do corpus).
 *
 * Os valores sorteados são parâmetros de teste, não dados tributários.
 *
 * Uso (com conformance/setup-official.sh rodando):
 *   npx tsx conformance/differential.ts [--n=2000] [--seed=42]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { getRtcRepos, processarObservabilidade, MotorLocalNaoValidadoError } from "../src/lib/engines/rtc";
import { LocalSimplesEngine } from "../src/lib/adapters/simples-engine/local-simples-engine";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const N = Number(args.n ?? 2000);
let seed = Number(args.seed ?? 42);
const RR_URL = process.env.RTC_API_URL ?? "http://localhost:8080/api";
const SN_URL = process.env.RTC_SIMPLES_API_URL ?? "http://localhost:8082/api";

function rnd(): number {
  // mulberry32 — determinístico para reprodutibilidade
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

function decimal(intMax: number, escala: number): string {
  const inteiro = int(0, intMax);
  if (escala === 0) return String(inteiro);
  const frac = String(int(0, 10 ** escala - 1)).padStart(escala, "0");
  return `${inteiro}.${frac}`;
}

const CHAVES_VALOR = /^(baseCalculo|vBC|impostoInformado|valor\w*|v[A-Z]\w*)$/;
const CHAVES_QTD = /^(quantidade|qTrib|qCom)$/;
const CHAVES_ALIQ = /^(cbs|ibsEstadual|ibsMunicipal|adValorem|adRem|p[A-Z]\w*)$/;

function mutar(v: unknown, chave = ""): unknown {
  if (Array.isArray(v)) return v.map((x) => mutar(x, chave));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = mutar(x, k);
    return out;
  }
  const numerico = (typeof v === "string" && /^\u0000?-?\d+(\.\d+)?$/.test(v)) || typeof v === "number";
  if (!numerico) {
    if (chave === "dhFatoGerador" && typeof v === "string") {
      const m = /^(\d{4})-\d{2}-\d{2}(T.*)$/.exec(v);
      if (m) return `${m[1]}-${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}${m[2]}`;
    }
    if (chave === "data" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const ano = v.slice(0, 4);
      return `${ano}-${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}`;
    }
    return v;
  }
  if (CHAVES_VALOR.test(chave)) return decimal(int(0, 3) === 0 ? 9 : 9_999_999, 2);
  if (CHAVES_QTD.test(chave)) return decimal(99_999, int(0, 4));
  if (CHAVES_ALIQ.test(chave)) return decimal(30, int(0, 4));
  return v;
}

function normalizar(v: unknown): unknown {
  if (Array.isArray(v)) {
    const itens = v.map(normalizar);
    const todosVal = itens.length > 1 && itens.every((e) => typeof (e as { code?: unknown })?.code === "string" && String((e as { code: string }).code).startsWith("VAL-"));
    if (todosVal) {
      const k = (e: unknown) => JSON.stringify([(e as { pointer?: string }).pointer, (e as { code?: string }).code, (e as { detail?: string }).detail]);
      return [...itens].sort((a, b) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0));
    }
    return itens;
  }
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === "timestamp") out[k] = "<TIMESTAMP>";
      else if (k === "detail" && typeof x === "string") out[k] = x.split("; ").sort().join("; ");
      else out[k] = normalizar(x);
    }
    return out;
  }
  return v;
}

interface Lote { meta: { endpoint: string; method: string; api?: string }; cases: Array<{ id: string; request?: unknown; naoDeterministico?: boolean }> }

async function oficial(base: string, endpoint: string, body: unknown) {
  const r = await fetch(`${base}/${endpoint}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const txt = await r.text();
  return { status: r.status, body: txt ? JSON.parse(txt) : "" };
}

async function main() {
  const repos = await getRtcRepos();
  const sn = new LocalSimplesEngine();
  const raiz = path.join(__dirname, "corpus");
  const modelos: Array<{ api: "rr" | "sn"; endpoint: string; request: unknown }> = [];
  for (const api of ["regime-regular", "simples"] as const) {
    for (const f of readdirSync(path.join(raiz, api)).filter((x) => x.endsWith(".json"))) {
      const lote = JSON.parse(readFileSync(path.join(raiz, api, f), "utf8")) as Lote;
      if (lote.meta.method !== "POST") continue;
      const ep = lote.meta.endpoint.replace(/^\/+/, "");
      if (api === "regime-regular" && ep !== "calculadora/observabilidade/regime-geral") continue;
      for (const c of lote.cases) if (c.request && !c.naoDeterministico) modelos.push({ api: api === "simples" ? "sn" : "rr", endpoint: ep, request: c.request });
    }
  }
  let ok = 0, nok = 0, nv = 0;
  const falhas: string[] = [];
  for (let i = 0; i < N; i++) {
    const m = modelos[int(0, modelos.length - 1)];
    const req = JSON.parse(JSON.stringify(mutar(m.request)));
    if (args.show && i < 2) console.log("exemplo de requisição sorteada:", JSON.stringify(req).slice(0, 500));
    try {
      const esperado = await oficial(m.api === "rr" ? RR_URL : SN_URL, m.endpoint, req);
      let obtido: { status: number; body: unknown };
      if (m.api === "rr") {
        const r = await processarObservabilidade(repos, req);
        obtido = { status: r.status, body: r.body };
      } else {
        obtido = m.endpoint.endsWith("/nao-assistido") ? await sn.calcularNaoAssistido(req as never) : await sn.calcularClassico(req as never);
      }
      const a = normalizar(JSON.parse(JSON.stringify(obtido)));
      const b = normalizar(esperado);
      if (isDeepStrictEqual(a, b)) ok++;
      else {
        nok++;
        if (falhas.length < 25) falhas.push(JSON.stringify({ api: m.api, endpoint: m.endpoint, req, esperado, obtido }).slice(0, 4000));
      }
    } catch (e) {
      if (e instanceof MotorLocalNaoValidadoError || (e as Error)?.name === "MotorLocalNaoValidadoError") nv++;
      else throw e;
    }
    if ((i + 1) % 250 === 0) console.log(`${i + 1}/${N} ok=${ok} divergentes=${nok} recusados=${nv}`);
  }
  const resumo = `Diferencial: ${N} requisições sorteadas (seed ${args.seed ?? 42}) — idênticas ${ok}, divergentes ${nok}, recusadas pelo motor local ${nv}.`;
  console.log(resumo);
  writeFileSync(path.join(__dirname, "work", "differential-falhas.jsonl"), falhas.join("\n"));
  process.exitCode = nok > 0 ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(2); });
