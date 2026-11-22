/**
 * Conformidade do motor local (src/lib/engines/rtc) com o corpus golden master do motor oficial da RFB
 * (conformance/corpus/regime-regular/*.json; formato e normalizações em conformance/README.md).
 *
 * Para CADA caso do corpus: roda o motor local com `request` e compara com `response` (deep equal) após as
 * normalizações documentadas no README:
 *   1. campos `timestamp` -> "<TIMESTAMP>";
 *   2. listas de erros somente-VAL-* e os segmentos do detail "Um ou mais campos são inválidos - [..] [..]"
 *      comparados sem depender da ordem (o Java usa um Set);
 *   3. casos `naoDeterministico` (POST /regime-geral, vários itens, erro): o motor oficial devolve o primeiro erro
 *      que terminar. O README não lista as saídas possíveis; compara-se status HTTP e o tipo de erro (equivalente
 *      ao código), que deve ser um dos erros possíveis do conjunto de itens avaliados individualmente.
 *
 * Também confere o header `x-warning-dados-simulados` (campo `warn` do caso).
 * Ao final de uma execução completa gera conformance/RELATORIO-regime-regular.md.
 * Casos de endpoints não portados (pedágio, base de cálculo) são listados como "fora do escopo", não aprovados.
 * O teste NÃO é ajustado para passar: divergências ficam como falhas.
 */
import { afterAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getRtcRepos, processarObservabilidade, calcularRegimeGeral, MotorLocalNaoValidadoError } from "@/lib/engines/rtc";
import type { RtcHttpResponse } from "@/lib/engines/rtc";

const CORPUS_DIR = join(__dirname, "corpus", "regime-regular");
const ONLY = process.env.RTC_ONLY; // trecho do nome do arquivo (depuração); relatório só é gerado sem filtro

interface Caso {
  id: string;
  request?: unknown;
  status: number;
  response: unknown;
  warn?: string;
  path?: string;
  method?: string;
  tags?: string[];
  naoDeterministico?: boolean;
}
interface Lote {
  meta: { lote: string; endpoint: string; method: string };
  cases: Caso[];
}

type Resultado = {
  arquivo: string;
  id: string;
  situacao: "aprovado" | "reprovado" | "nao-validado" | "fora-do-escopo";
  motivo?: string;
  itens: Array<{ codigo: string; ok: boolean }>;
};
const resultados: Resultado[] = [];

// ───────────────────────────── normalização ─────────────────────────────

type J = unknown;

function normalizarDetail(s: string): string {
  const prefixo = "Um ou mais campos são inválidos - ";
  if (!s.startsWith(prefixo)) return s;
  const segs = s
    .slice(prefixo.length)
    .trim()
    .split(/(?<=\])\s+(?=\[)/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .sort();
  return prefixo + segs.join(" ");
}

function normalizar(v: J): J {
  if (Array.isArray(v)) {
    const arr = v.map(normalizar);
    const so = arr.length > 1 && arr.every((e) => e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string" && ((e as { code: string }).code.startsWith("VAL-")));
    if (so) {
      return [...arr].sort((a, b) => {
        const ka = String((a as { pointer: string }).pointer) + (a as { code: string }).code + (a as { detail: string }).detail;
        const kb = String((b as { pointer: string }).pointer) + (b as { code: string }).code + (b as { detail: string }).detail;
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
    }
    return arr;
  }
  if (v && typeof v === "object") {
    const out: Record<string, J> = {};
    for (const [k, x] of Object.entries(v as Record<string, J>)) {
      if (k === "timestamp" && typeof x === "string") out[k] = "<TIMESTAMP>";
      else if (k === "detail" && typeof x === "string") out[k] = normalizarDetail(x);
      else out[k] = normalizar(x);
    }
    return out;
  }
  return v;
}

/** JSON canônico (chaves ordenadas) para comparação rápida independente da ordem das chaves. */
function canon(v: J): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, J>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  );
}

/** Remove undefined (equivale a serializar e reler). */
function jsonRoundtrip<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ───────────────────────────── execução ─────────────────────────────

function endpointDe(lote: Lote, c: Caso): string {
  return (c.path ?? lote.meta.endpoint).replace(/^\/+/, "");
}

async function rodar(endpoint: string, req: unknown): Promise<RtcHttpResponse> {
  const repos = await getRtcRepos();
  if (endpoint === "calculadora/observabilidade/regime-geral") return processarObservabilidade(repos, req);
  return calcularRegimeGeral(repos, req);
}

/** Erros possíveis (status + tipo) de /regime-geral avaliando cada item isoladamente. */
async function errosPossiveis(req: unknown): Promise<Set<string>> {
  const out = new Set<string>();
  const r = req as { itens?: unknown[] };
  for (const item of r.itens ?? []) {
    const resp = await rodar("calculadora/regime-geral", { ...(req as object), itens: [item] });
    if (resp.status >= 400) out.add(`${resp.status} ${(resp.body as { type: string }).type}`);
  }
  return out;
}

function codigosDoItem(o: { estadoItem?: string; erros?: Array<{ code: string }> }): string[] {
  if (o.erros && o.erros.length > 0) return o.erros.map((e) => e.code);
  return [o.estadoItem ?? "(/regime-geral) item calculado"];
}

/** Códigos de uma resposta sem `objetos` (erros globais 422 ou erro HTTP de /regime-geral). */
function codigosGlobais(golden: unknown, status: number): string[] {
  const g = golden as { objetos?: unknown; errors?: Array<{ code: string }>; type?: string };
  if (Array.isArray(g?.objetos)) return [];
  if (Array.isArray(g?.errors)) return g.errors.map((e) => `${e.code} (global)`);
  if (status >= 400) return [`HTTP ${status} ${String(g?.type).split("/").pop()}`];
  return [];
}

function compararItens(golden: unknown, local: unknown): Array<{ codigo: string; ok: boolean }> {
  const g = (golden as { objetos?: Array<{ estadoItem?: string; erros?: Array<{ code: string }> }> })?.objetos;
  const l = (local as { objetos?: unknown[] })?.objetos;
  if (!Array.isArray(g)) return [];
  return g.map((o, i) => {
    const ok = canon(normalizar(o)) === canon(normalizar(l?.[i] ?? null));
    return { codigo: codigosDoItem(o).join("+"), ok };
  });
}

const arquivos = readdirSync(CORPUS_DIR)
  .filter((f) => f.endsWith(".json"))
  .filter((f) => !ONLY || f.includes(ONLY))
  .sort();

const ENDPOINTS_PORTADOS = new Set(["calculadora/observabilidade/regime-geral", "calculadora/regime-geral"]);

for (const arquivo of arquivos) {
  const lote = JSON.parse(readFileSync(join(CORPUS_DIR, arquivo), "utf8")) as Lote;
  describe(arquivo.replace(/\.json$/, ""), () => {
    for (const c of lote.cases) {
      const endpoint = endpointDe(lote, c);
      if (!ENDPOINTS_PORTADOS.has(endpoint)) {
        it.skip(`${c.id} [fora do escopo: ${endpoint}]`, () => {});
        resultados.push({ arquivo, id: c.id, situacao: "fora-do-escopo", motivo: `endpoint ${endpoint} não portado`, itens: [] });
        continue;
      }
      it(c.id, async () => {
        let situacao = "aprovado" as Resultado["situacao"];
        let motivo: string | undefined;
        let itens: Resultado["itens"] = [];
        try {
          let resp: RtcHttpResponse;
          try {
            resp = await rodar(endpoint, c.request);
          } catch (e) {
            if (e instanceof MotorLocalNaoValidadoError) {
              situacao = "nao-validado";
              motivo = e.message;
              throw e;
            }
            throw e;
          }
          const local = normalizar(jsonRoundtrip(resp.body));
          const golden = normalizar(c.response);
          itens = compararItens(golden, local);

          let igual = true;
          try {
            expect(resp.status).toBe(c.status);
            expect(local).toEqual(golden);
          } catch (e) {
            igual = false;
            if (!c.naoDeterministico) throw e;
          }
          if (!igual && c.naoDeterministico) {
            // Saídas possíveis: mesmo status e erro de um dos itens avaliados individualmente.
            expect(resp.status).toBe(c.status);
            const possiveis = await errosPossiveis(c.request);
            const g = golden as { type?: string };
            expect(possiveis.has(`${c.status} ${g.type}`), `erro do golden (${c.status} ${g.type}) fora das saídas possíveis ${[...possiveis].join(" | ")}`).toBe(true);
            itens = [];
          }
          // header de aviso de dados simulados
          if (resp.status === 200) {
            expect(resp.headers["x-warning-dados-simulados"]).toBe(c.warn);
          }
          if (itens.length === 0) itens = codigosGlobais(c.response, c.status).map((codigo) => ({ codigo, ok: true }));
        } catch (e) {
          if (situacao !== "nao-validado") {
            situacao = "reprovado";
            motivo = (e as Error).message.split("\n").slice(0, 3).join(" ").slice(0, 300);
          }
          if (itens.length === 0) itens = codigosGlobais(c.response, c.status).map((codigo) => ({ codigo, ok: false }));
          resultados.push({ arquivo, id: c.id, situacao, motivo, itens });
          throw e;
        }
        resultados.push({ arquivo, id: c.id, situacao, motivo, itens });
      });
    }
  });
}

// ───────────────────────────── relatório ─────────────────────────────

afterAll(() => {
  if (ONLY) return;
  const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(2)}%`);
  const porArquivo = new Map<string, { total: number; ok: number; nok: number; nv: number; fora: number }>();
  for (const r of resultados) {
    const a = porArquivo.get(r.arquivo) ?? { total: 0, ok: 0, nok: 0, nv: 0, fora: 0 };
    a.total++;
    if (r.situacao === "aprovado") a.ok++;
    else if (r.situacao === "reprovado") a.nok++;
    else if (r.situacao === "nao-validado") a.nv++;
    else a.fora++;
    porArquivo.set(r.arquivo, a);
  }
  const porCodigo = new Map<string, { total: number; ok: number }>();
  for (const r of resultados) {
    if (r.situacao === "fora-do-escopo") continue;
    const itens = r.itens.length > 0 ? r.itens : [];
    for (const it of itens) {
      const k = porCodigo.get(it.codigo) ?? { total: 0, ok: 0 };
      k.total++;
      if (it.ok) k.ok++;
      porCodigo.set(it.codigo, k);
    }
  }
  const tot = [...porArquivo.values()].reduce((s, a) => ({ total: s.total + a.total, ok: s.ok + a.ok, nok: s.nok + a.nok, nv: s.nv + a.nv, fora: s.fora + a.fora }), { total: 0, ok: 0, nok: 0, nv: 0, fora: 0 });
  const avaliados = tot.total - tot.fora;
  const linhas: string[] = [];
  linhas.push("# Relatório de conformidade — regime regular", "");
  linhas.push("Gerado por `conformance/regime-regular.test.ts` (não editar à mão). Motor local `src/lib/engines/rtc` x corpus golden master `conformance/corpus/regime-regular/*.json`.", "");
  linhas.push(`**Total avaliado: ${avaliados} requisições — aprovadas ${tot.ok} (${pct(tot.ok, avaliados)}), reprovadas ${tot.nok}, não validadas (MotorLocalNaoValidadoError) ${tot.nv}. Fora do escopo (endpoints não portados): ${tot.fora}.**`, "");
  linhas.push("## Por arquivo do corpus", "", "| Arquivo | Requisições | Aprovadas | Reprovadas | Não validadas | Fora do escopo | Taxa (avaliadas) |", "|---|---:|---:|---:|---:|---:|---:|");
  for (const [arq, a] of [...porArquivo.entries()].sort()) {
    linhas.push(`| ${arq} | ${a.total} | ${a.ok} | ${a.nok} | ${a.nv} | ${a.fora} | ${pct(a.ok, a.total - a.fora)} |`);
  }
  linhas.push("", "## Por código", "", "Itens de `objetos`: estado (`CALCULADO`, `CALCULO_SIMULADO`, ...) quando sem erro, senão o código do erro do item. Respostas sem `objetos`: `<código> (global)` (422 da observabilidade) ou `HTTP <status> <tipo>` (erros de /regime-geral).", "", "| Código | Itens | Aprovados | Taxa |", "|---|---:|---:|---:|");
  for (const [cod, k] of [...porCodigo.entries()].sort()) {
    linhas.push(`| ${cod} | ${k.total} | ${k.ok} | ${pct(k.ok, k.total)} |`);
  }
  const falhas = resultados.filter((r) => r.situacao === "reprovado" || r.situacao === "nao-validado");
  linhas.push("", `## Requisições reprovadas / não validadas (${falhas.length})`, "");
  if (falhas.length === 0) linhas.push("Nenhuma.");
  for (const f of falhas.slice(0, 200)) linhas.push(`- \`${f.arquivo}\` ${f.id} — ${f.situacao}: ${f.motivo ?? ""}`);
  if (falhas.length > 200) linhas.push(`- ... e mais ${falhas.length - 200}`);
  const fora = resultados.filter((r) => r.situacao === "fora-do-escopo");
  linhas.push("", `## Fora do escopo (${fora.length})`, "", "Endpoints diferentes de `/calculadora/observabilidade/regime-geral` e `/calculadora/regime-geral` (pedágio, base de cálculo unificada), não portados neste WP.", "");
  for (const f of fora) linhas.push(`- \`${f.arquivo}\` ${f.id}: ${f.motivo}`);
  writeFileSync(join(__dirname, "RELATORIO-regime-regular.md"), linhas.join("\n") + "\n");
});
