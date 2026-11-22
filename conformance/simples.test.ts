/**
 * Conformidade do motor LOCAL do Simples Nacional contra o corpus "golden master" do motor oficial da RFB
 * (conformance/corpus/simples/*.json). Cada caso é executado no motor local e comparado por igualdade
 * profunda ESTRITA (status HTTP + corpo JSON), com SOMENTE as normalizações documentadas em
 * conformance/README.md:
 *   1. campos `timestamp` => "<TIMESTAMP>";
 *   2. arrays de erros só-VAL-* (Bean Validation) comparados sem depender da ordem;
 *   4. URLs `type` dos erros: o motor local usa `http://localhost` como o corpus (nada a normalizar).
 * (A normalização 3 só vale para o regime regular.)
 *
 * Gera conformance/RELATORIO-simples.md (aprovação por arquivo e por código).
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MotorLocalNaoValidadoError } from "@/lib/engines/simples/errors";
import { LocalSimplesEngine } from "@/lib/adapters/simples-engine/local-simples-engine";
import type { SimplesEnginePort } from "@/lib/ports/simples-engine";

const RAIZ = path.resolve(__dirname);
const CORPUS = path.join(RAIZ, "corpus", "simples");
const RELATORIO = path.join(RAIZ, "RELATORIO-simples.md");

interface Caso {
  id: string;
  status: number;
  request?: unknown;
  response: unknown;
  path?: string;
  method?: string;
  tags?: string[];
}
interface Lote {
  meta: { lote: string; endpoint: string; method: string; motor?: Record<string, unknown> };
  cases: Caso[];
}

type Veredito = "OK" | "FALHA" | "NAO_SUPORTADO";
interface Resultado {
  caso: Caso;
  veredito: Veredito;
  detalhe?: string;
  codigos: string[];
}

// ─── Normalizações documentadas ──────────────────────────────────────────────

function normalizar(v: unknown): unknown {
  if (Array.isArray(v)) {
    const itens = v.map(normalizar);
    const todosVal =
      itens.length > 1 &&
      itens.every((e) => e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string" && String((e as { code: string }).code).startsWith("VAL-"));
    if (todosVal) {
      const chave = (e: unknown) => {
        const o = e as { pointer?: string; code?: string; detail?: string };
        return `${o.pointer ?? ""}\u0000${o.code ?? ""}\u0000${o.detail ?? ""}`;
      };
      return [...itens].sort((a, b) => (chave(a) < chave(b) ? -1 : chave(a) > chave(b) ? 1 : 0));
    }
    return itens;
  }
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = k === "timestamp" ? "<TIMESTAMP>" : normalizar(val);
    }
    return out;
  }
  return v;
}

function primeiraDiferenca(a: unknown, b: unknown, caminho = "$"): string | null {
  if (isDeepStrictEqual(a, b)) return null;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${caminho}: tamanho ${a.length} (obtido) != ${b.length} (esperado)`;
    for (let i = 0; i < a.length; i++) {
      const d = primeiraDiferenca(a[i], b[i], `${caminho}[${i}]`);
      if (d) return d;
    }
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    for (const k of new Set([...ka, ...kb])) {
      if (!(k in (a as object))) return `${caminho}.${k}: ausente no obtido (esperado ${JSON.stringify((b as Record<string, unknown>)[k]).slice(0, 200)})`;
      if (!(k in (b as object))) return `${caminho}.${k}: presente no obtido (${JSON.stringify((a as Record<string, unknown>)[k]).slice(0, 200)}) mas ausente no esperado`;
      const d = primeiraDiferenca((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${caminho}.${k}`);
      if (d) return d;
    }
  }
  return `${caminho}: obtido ${JSON.stringify(a)?.slice(0, 200)} != esperado ${JSON.stringify(b)?.slice(0, 200)}`;
}

/** Códigos (VSN e VAL) que aparecem na resposta esperada (erros por item, globais) e estados. */
function codigosDa(resp: unknown): string[] {
  const achados = new Set<string>();
  const visita = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visita);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.code === "string") achados.add(o.code);
      Object.values(o).forEach(visita);
    }
  };
  visita(resp);
  return [...achados].sort();
}

// ─── Execução ────────────────────────────────────────────────────────────────

async function executar(motor: SimplesEnginePort, lote: Lote, caso: Caso): Promise<{ status: number; body: unknown }> {
  if (lote.meta.method === "GET") {
    const url = new URL(`http://x/${caso.path}`);
    const partes = url.pathname.split("/").filter(Boolean); // calculadora/simples-nacional/atividades[/codigo]
    const consulta = {
      data: url.searchParams.get("data"),
      tpDoc: url.searchParams.get("tpDoc"),
      cClassTrib: url.searchParams.get("cClassTrib"),
    };
    if (partes.length > 3) return motor.buscarAtividade(decodeURIComponent(partes[3]), consulta);
    const anexos = url.searchParams.getAll("anexos");
    return motor.listarAtividades({ ...consulta, anexos: anexos.length ? anexos : null });
  }
  if (lote.meta.endpoint.endsWith("/nao-assistido")) return motor.calcularNaoAssistido(caso.request as never);
  return motor.calcularClassico(caso.request as never);
}

const arquivos = readdirSync(CORPUS).filter((f) => f.endsWith(".json")).sort();
const lotes = new Map<string, Lote>(arquivos.map((f) => [f, JSON.parse(readFileSync(path.join(CORPUS, f), "utf8")) as Lote]));
const resultados = new Map<string, Resultado[]>();

beforeAll(async () => {
  const motor = new LocalSimplesEngine();
  for (const [arquivo, lote] of lotes) {
    const lista: Resultado[] = [];
    for (const caso of lote.cases) {
      const codigos = codigosDa(caso.response);
      try {
        const obtido = await executar(motor, lote, caso);
        const a = normalizar(JSON.parse(JSON.stringify({ status: obtido.status, body: obtido.body })));
        const b = normalizar({ status: caso.status, body: caso.response });
        const dif = primeiraDiferenca(a, b);
        lista.push(dif ? { caso, veredito: "FALHA", detalhe: dif, codigos } : { caso, veredito: "OK", codigos });
      } catch (e) {
        if (e instanceof MotorLocalNaoValidadoError) {
          lista.push({ caso, veredito: "NAO_SUPORTADO", detalhe: e.message, codigos });
        } else {
          lista.push({ caso, veredito: "FALHA", detalhe: `exceção: ${(e as Error).stack ?? e}`, codigos });
        }
      }
    }
    resultados.set(arquivo, lista);
  }
}, 600_000);

// ─── Relatório ───────────────────────────────────────────────────────────────

function pct(ok: number, total: number): string {
  return total === 0 ? "n/a" : `${((ok / total) * 100).toFixed(2)}%`;
}

function gerarRelatorio(): string {
  const linhasArquivo: string[] = [];
  const porCodigo = new Map<string, { total: number; ok: number }>();
  let tot = 0;
  let ok = 0;
  let ns = 0;
  const problemas: string[] = [];

  for (const [arquivo, lista] of resultados) {
    const aprov = lista.filter((r) => r.veredito === "OK").length;
    const naoSup = lista.filter((r) => r.veredito === "NAO_SUPORTADO").length;
    const falhas = lista.length - aprov - naoSup;
    tot += lista.length;
    ok += aprov;
    ns += naoSup;
    linhasArquivo.push(`| \`${arquivo}\` | ${lista.length} | ${aprov} | ${falhas} | ${naoSup} | ${pct(aprov, lista.length)} |`);
    for (const r of lista) {
      for (const c of r.codigos) {
        const e = porCodigo.get(c) ?? { total: 0, ok: 0 };
        e.total++;
        if (r.veredito === "OK") e.ok++;
        porCodigo.set(c, e);
      }
      if (r.veredito !== "OK") problemas.push(`- \`${arquivo}\` / \`${r.caso.id}\` (${r.veredito}): ${(r.detalhe ?? "").split("\n")[0].slice(0, 300)}`);
    }
  }

  const linhasCodigo = [...porCodigo.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([c, e]) => `| \`${c}\` | ${e.total} | ${e.ok} | ${e.total - e.ok} | ${pct(e.ok, e.total)} |`);

  const motor = [...lotes.values()][0]?.meta.motor;
  return [
    "# Relatório de conformidade — Simples Nacional (motor local x motor oficial RFB)",
    "",
    "Gerado por `conformance/simples.test.ts` (não editar à mão). Cada caso do corpus",
    "`conformance/corpus/simples/*.json` é executado no motor local e comparado ao par `{status, response}` do",
    "motor oficial por igualdade profunda estrita, com as normalizações documentadas em `conformance/README.md`",
    "(`timestamp` => `<TIMESTAMP>`; arrays só-`VAL-*` sem depender da ordem).",
    "",
    `Motor oficial do corpus: \`${JSON.stringify(motor)}\``,
    "",
    "## Resumo",
    "",
    `- Casos: **${tot}** | aprovados: **${ok}** (${pct(ok, tot)}) | reprovados: **${tot - ok - ns}** | não suportados: **${ns}**`,
    "",
    "## Aprovação por arquivo",
    "",
    "| Arquivo | Casos | Aprovados | Reprovados | Não suportados | Aprovação |",
    "|---|---:|---:|---:|---:|---:|",
    ...linhasArquivo,
    "",
    "## Aprovação por código",
    "",
    "Um caso conta em cada código `VSN-*` presente na resposta esperada (erros por item e globais). Casos sem",
    "erro não aparecem aqui (estão apenas na tabela por arquivo).",
    "",
    "| Código | Casos | Aprovados | Reprovados | Aprovação |",
    "|---|---:|---:|---:|---:|",
    ...linhasCodigo,
    "",
    "## Casos não aprovados",
    "",
    problemas.length === 0 ? "Nenhum." : problemas.slice(0, 200).join("\n"),
    problemas.length > 200 ? `\n... e mais ${problemas.length - 200}.` : "",
    "",
  ].join("\n");
}

afterAll(() => {
  if (resultados.size === 0) return;
  writeFileSync(RELATORIO, gerarRelatorio(), "utf8");
});

// ─── Testes ──────────────────────────────────────────────────────────────────

describe("Simples Nacional: motor local == motor oficial (corpus golden master)", () => {
  for (const arquivo of arquivos) {
    it(`${arquivo}`, () => {
      const lista = resultados.get(arquivo) ?? [];
      const ruins = lista.filter((r) => r.veredito !== "OK");
      const msg = ruins
        .slice(0, 5)
        .map((r) => `${r.caso.id} [${r.veredito}]: ${r.detalhe}`)
        .join("\n");
      expect(lista.length, "arquivo sem casos").toBeGreaterThan(0);
      expect(ruins.length, `${ruins.length}/${lista.length} caso(s) divergentes:\n${msg}`).toBe(0);
    });
  }

  it("o corpus foi lido por inteiro (20 arquivos de Simples; 1817 requisições)", () => {
    const total = [...lotes.values()].reduce((n, l) => n + l.cases.length, 0);
    expect(arquivos.length).toBe(20);
    expect(total).toBe(1817);
  });
});
