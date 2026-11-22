/**
 * PÓS-VALIDAÇÃO ANTI-ALUCINAÇÃO (código, não prompt).
 * Nenhum campo vindo de LLM chega à UI sem passar por aqui. Para cada campo com valor:
 *  1. `trecho` obrigatório e deve ocorrer LITERALMENTE no texto de entrada (só espaços normalizados);
 *  2. o valor deve ser consistente com o trecho (números canonizados batem, dígitos batem, etc.);
 *  3. regras de domínio: CNPJ com DV válido, UF na lista das 27, NCM 8 dígitos / NBS 9 dígitos
 *     rotulados no próprio trecho (ou pela coluna de cabeçalho NCM/NBS em tabela TSV).
 * Falhou => valor e trecho viram null e um aviso explica o descarte.
 */
import type { CampoExtraido, ItemPropostaExtraido, PropostaExtraida } from "@/lib/ports/quote-extractor";
import {
  UFS_VALIDAS,
  cnpjValido,
  formatarCnpj,
  normalizarEspacos,
  numerosDoTrecho,
  parseNumeroBr,
  soDigitos,
} from "./text-utils";

const curto = (s: string, n = 50) => (s.length > n ? `${s.slice(0, n)}…` : s);

interface Ctx {
  texto: string;
  textoNorm: string;
  linhas: string[];
  avisos: string[];
}

type Verificador<T> = (valor: T, trechoNorm: string, rawTrecho: string) => { ok: true; valor: T } | { ok: false; motivo: string };

function validarCampo<T>(rotulo: string, c: CampoExtraido<T> | undefined, ctx: Ctx, verificar: Verificador<T>): CampoExtraido<T> {
  if (!c || c.valor === null || c.valor === undefined) return { valor: null, trecho: null };
  const descartar = (motivo: string): CampoExtraido<T> => {
    ctx.avisos.push(`${rotulo}: valor "${curto(String(c.valor))}" descartado — ${motivo}.`);
    return { valor: null, trecho: null };
  };
  if (typeof c.trecho !== "string" || !c.trecho.trim()) return descartar("sem trecho de origem");
  const trechoNorm = normalizarEspacos(c.trecho);
  if (!ctx.textoNorm.includes(trechoNorm)) return descartar("trecho não encontrado literalmente no documento");
  const r = verificar(c.valor, trechoNorm, c.trecho);
  if (!r.ok) return descartar(r.motivo);
  return { valor: r.valor, trecho: c.trecho.trim() };
}

const textoLivre = (): Verificador<string> => (valor, trechoNorm) => {
  const v = normalizarEspacos(String(valor));
  if (!v) return { ok: false, motivo: "valor vazio" };
  return trechoNorm.toLowerCase().includes(v.toLowerCase())
    ? { ok: true, valor: v }
    : { ok: false, motivo: "valor não consta no trecho informado" };
};

/** O trecho está numa linha TSV cujo cabeçalho de coluna (acima) casa com `rotulo`? */
function rotuloPorCabecalho(ctx: Ctx, trechoNorm: string, digitos: string, rotulo: RegExp): boolean {
  const i = ctx.linhas.findIndex((l) => l.includes("\t") && normalizarEspacos(l).includes(trechoNorm));
  if (i < 0) return false;
  const idx = ctx.linhas[i].split("\t").findIndex((c) => soDigitos(c) === digitos);
  if (idx < 0) return false;
  for (let k = i - 1; k >= 0 && i - k < 5000; k--) {
    const l = ctx.linhas[k];
    if (!l.trim() || l.startsWith("## Aba:")) break;
    if (l.includes("\t") && rotulo.test((l.split("\t")[idx] ?? "").trim())) return true;
  }
  return false;
}

function codigoFiscal(ctx: Ctx, nome: "NCM" | "NBS", tamanho: 8 | 9): Verificador<string> {
  return (valor, trechoNorm) => {
    const d = soDigitos(String(valor));
    if (d.length !== tamanho || d !== String(valor).replace(/[.\s]/g, "")) return { ok: false, motivo: `${nome} deve ter ${tamanho} dígitos` };
    const pontuado = tamanho === 8 ? `${d.slice(0, 4)}\\.?${d.slice(4, 6)}\\.?${d.slice(6)}` : `${d[0]}\\.?${d.slice(1, 5)}\\.?${d.slice(5, 7)}\\.?${d.slice(7)}`;
    if (!new RegExp(`(?<!\\d)${pontuado}(?!\\d)`).test(trechoNorm)) return { ok: false, motivo: `${nome} não consta no trecho` };
    const rotulado = new RegExp(`\\b${nome}\\b`, "i").test(trechoNorm) || rotuloPorCabecalho(ctx, trechoNorm, d, new RegExp(`^${nome}`, "i"));
    return rotulado ? { ok: true, valor: d } : { ok: false, motivo: `${nome} sem rótulo explícito no documento (não pode ser deduzido)` };
  };
}

function numero(rotulo: string, ctx: Ctx): Verificador<string> {
  return (valor, trechoNorm) => {
    const n = parseNumeroBr(String(valor));
    if (!n) return { ok: false, motivo: "valor não é um número válido" };
    if (!numerosDoTrecho(trechoNorm).includes(n.canonico)) return { ok: false, motivo: "número não bate com o trecho" };
    if (n.ambiguo) ctx.avisos.push(`${rotulo}: "${valor}" é ambíguo (milhar ou decimal) — interpretado como milhar; confira.`);
    return { ok: true, valor: n.canonico };
  };
}

export function posValidarProposta(p: PropostaExtraida, textoOriginal: string): PropostaExtraida {
  const texto = textoOriginal.replace(/\r\n?/g, "\n");
  const ctx: Ctx = { texto, textoNorm: normalizarEspacos(texto), linhas: texto.split("\n"), avisos: [] };

  const fornecedor = validarCampo("Fornecedor", p.fornecedor, ctx, textoLivre());

  const cnpj = validarCampo("CNPJ", p.cnpj, ctx, (valor, trechoNorm) => {
    const d = soDigitos(String(valor));
    if (d.length !== 14) return { ok: false, motivo: "CNPJ não tem 14 dígitos" };
    if (!cnpjValido(d)) return { ok: false, motivo: "dígitos verificadores do CNPJ inválidos" };
    if (!soDigitos(trechoNorm).includes(d)) return { ok: false, motivo: "CNPJ não bate com o trecho" };
    return { ok: true, valor: formatarCnpj(d) };
  });

  const uf = validarCampo("UF", p.uf, ctx, (valor, trechoNorm) => {
    const v = String(valor);
    if (!UFS_VALIDAS.has(v)) return { ok: false, motivo: "sigla de UF inválida" };
    return new RegExp(`(?<![A-Za-z])${v}(?![A-Za-z])`).test(trechoNorm)
      ? { ok: true, valor: v }
      : { ok: false, motivo: "UF não consta no trecho" };
  });

  const regimeTributario = validarCampo<"REGULAR" | "SIMPLES_NACIONAL">("Regime tributário", p.regimeTributario, ctx, (valor, trechoNorm) => {
    const naoOptante = /n[ãa]o[\s-]+optante/i.test(trechoNorm);
    if (valor === "SIMPLES_NACIONAL")
      return /Simples\s+Nacional/i.test(trechoNorm) && !naoOptante
        ? { ok: true, valor }
        : { ok: false, motivo: "trecho não declara optante pelo Simples Nacional" };
    if (valor === "REGULAR")
      return /Lucro\s+(Presumido|Real)|Regime\s+(Tribut[áa]rio\s*[:\-]?\s*)?(Normal|Regular|Geral)|n[ãa]o[\s-]+optante\s+(pel[oa]|do|da)\s+Simples/i.test(trechoNorm)
        ? { ok: true, valor }
        : { ok: false, motivo: "trecho não declara regime regular (Lucro Presumido/Real)" };
    return { ok: false, motivo: "regime desconhecido" };
  });

  const itens: ItemPropostaExtraido[] = [];
  (p.itens ?? []).forEach((it, i) => {
    const r = (s: string) => `Item ${i + 1} — ${s}`;
    const item: ItemPropostaExtraido = {
      descricao: validarCampo(r("descrição"), it.descricao, ctx, textoLivre()),
      ncm: validarCampo(r("NCM"), it.ncm, ctx, codigoFiscal(ctx, "NCM", 8)),
      nbs: validarCampo(r("NBS"), it.nbs, ctx, codigoFiscal(ctx, "NBS", 9)),
      quantidade: validarCampo(r("quantidade"), it.quantidade, ctx, numero(r("quantidade"), ctx)),
      unidade: validarCampo(r("unidade"), it.unidade, ctx, textoLivre()),
      valorUnitario: validarCampo(r("valor unitário"), it.valorUnitario, ctx, numero(r("valor unitário"), ctx)),
    };
    const algum = Object.values(item).some((c) => c.valor !== null);
    if (!algum) ctx.avisos.push(`Item ${i + 1} descartado: nenhum campo pôde ser confirmado no texto.`);
    else {
      if (item.descricao.valor === null) ctx.avisos.push(`Item ${itens.length + 1}: descrição não confirmada no documento.`);
      itens.push(item);
    }
  });

  const nulos = (c: CampoExtraido<unknown>) => c.valor === null;
  if (nulos(fornecedor)) ctx.avisos.push("Fornecedor não identificado de forma literal no documento.");
  if (nulos(cnpj)) ctx.avisos.push("CNPJ não identificado (ausente ou inválido).");
  if (nulos(uf)) ctx.avisos.push("UF não identificada de forma literal no documento.");
  if (nulos(regimeTributario)) ctx.avisos.push("Regime tributário não declarado explicitamente no documento.");
  if (itens.length === 0) ctx.avisos.push("Nenhum item confirmado no documento — preencha a grade manualmente.");

  const avisosLlm = (p.avisos ?? []).filter((a) => typeof a === "string" && a.trim()).map((a) => `IA: ${curto(a.trim(), 300)}`);
  return { fornecedor, cnpj, uf, regimeTributario, itens, avisos: [...ctx.avisos, ...avisosLlm] };
}
