import {
  maisRecentePrimeiro,
  vigente,
  type AtividadeSn,
  type ClassificacaoTributaria,
  type DadosBase,
  type Enquadramento,
  type RegimeApuracao,
  type SituacaoIss,
  type TipoDfe,
  type TipoDfeCalculo,
  type TipoReceitaBruta,
  type Vocabulario,
} from "./data";
import type { Dec } from "./decimal";

/**
 * Port das consultas dos repositórios do motor oficial (JPQL/SQL nativo), sobre os JSON oficiais.
 * Cada função cita o repositório de origem; a semântica de vigência é `:data BETWEEN INICIO AND
 * COALESCE(FIM, :data)`.
 */

const vig = <T extends { inicio: string; fim: string | null }>(l: T[], data: string): T[] =>
  l.filter((x) => vigente(data, x.inicio, x.fim));

// ─── ParametroCalculoSimplesService / TipoDfeCalculoSimplesRepository ────────

/** Linhas de TIPO_DFE vigentes com TPDF_TIPO = tpDoc. */
function tiposDfeVigentes(d: DadosBase, tpDoc: number, data: string): TipoDfe[] {
  return vig(d.tiposDfe.filter((t) => t.tipo === tpDoc), data);
}

/** `contarSemTratamentoCalculadoraVigentes(...) > 0`. */
export function tpDocSemTratamentoCalculadora(d: DadosBase, tpDoc: number, data: string): boolean {
  return tiposDfeVigentes(d, tpDoc, data).some((t) => !t.possuiTratamentoCalculadora);
}

/** `buscarVigentes(tpDoc, data)`: linhas de cálculo do tipo de DFe, por início de vigência decrescente. */
export function buscarTiposDfeCalculo(d: DadosBase, tpDoc: number, data: string): TipoDfeCalculo[] {
  const ids = new Set(tiposDfeVigentes(d, tpDoc, data).map((t) => t.id));
  return maisRecentePrimeiro(vig(d.tiposDfeCalculo.filter((t) => ids.has(t.tipoDfeId)), data));
}

/** `tpDocSuportado`: `contarVinculosVigentes > 0` (mesma junção de `buscarVigentes`). */
export function tpDocSuportado(d: DadosBase, tpDoc: number, data: string): boolean {
  return buscarTiposDfeCalculo(d, tpDoc, data).length > 0;
}

export function buscarSiglaVigentePorId(d: DadosBase, tipoDfeId: number, data: string): string | null {
  const t = d.tiposDfe.find((x) => x.id === tipoDfeId && vigente(data, x.inicio, x.fim));
  return t ? t.sigla : null;
}

export function permiteNcmZeroVigentePorId(d: DadosBase, tipoDfeId: number, data: string): boolean {
  const t = d.tiposDfe.find((x) => x.id === tipoDfeId && vigente(data, x.inicio, x.fim));
  return t ? t.permiteNcmZero : false;
}

// ─── TipoReceitaBrutaSimplesRepository ───────────────────────────────────────

/** `buscarVigentesPorCodigo` (linha padrão, sem vocabulário) — primeira. */
export function buscarTipoReceitaBrutaPadrao(d: DadosBase, tpRBSN: number, data: string): TipoReceitaBruta | null {
  const l = maisRecentePrimeiro(vig(d.tiposReceitaBruta.filter((t) => t.codigo === tpRBSN && t.vocabulario == null), data));
  return l[0] ?? null;
}

/** `buscarVigentesPorCodigoEVocabulario`: a linha do vocabulário, se houver; senão, a padrão. */
export function buscarTipoReceitaBrutaPorVocabulario(
  d: DadosBase,
  tpRBSN: number,
  vocabulario: Vocabulario,
  data: string,
): TipoReceitaBruta | null {
  const cand = vig(
    d.tiposReceitaBruta.filter((t) => t.codigo === tpRBSN && (t.vocabulario === vocabulario || t.vocabulario == null)),
    data,
  );
  const ord = [...cand].sort((a, b) => {
    const pa = a.vocabulario == null ? 1 : 0;
    const pb = b.vocabulario == null ? 1 : 0;
    if (pa !== pb) return pa - pb;
    return a.inicio < b.inicio ? 1 : a.inicio > b.inicio ? -1 : 0;
  });
  return ord[0] ?? null;
}

// ─── EnquadramentoRegimeSimplesRepository ────────────────────────────────────

/** `buscarEnquadramentosVigentes` + regime vigente; igualdade com NULL conforme a query oficial. */
export function buscarRegimeApuracao(
  d: DadosBase,
  vocabulario: Vocabulario,
  crt: number | null,
  tpRegimeIBSCBS: number | null,
  opSimpNac: number | null,
  regApIBSCBSSN: number | null,
  data: string,
): RegimeApuracao | null {
  const iguala = (param: number | null, coluna: number | null) => (param == null ? coluna == null : coluna === param);
  const cand: Array<{ e: Enquadramento; r: RegimeApuracao }> = [];
  for (const e of d.enquadramentos) {
    if (e.vocabulario !== vocabulario) continue;
    if (!iguala(crt, e.crt) || !iguala(tpRegimeIBSCBS, e.tpRegimeIBSCBS)) continue;
    if (!iguala(opSimpNac, e.opSimpNac) || !iguala(regApIBSCBSSN, e.regApIBSCBSSN)) continue;
    if (!vigente(data, e.inicio, e.fim)) continue;
    const r = d.regimes.get(e.regimeId);
    if (!r || !vigente(data, r.inicio, r.fim)) continue;
    cand.push({ e, r });
  }
  cand.sort((a, b) =>
    a.e.inicio !== b.e.inicio ? (a.e.inicio < b.e.inicio ? 1 : -1) : a.r.inicio < b.r.inicio ? 1 : a.r.inicio > b.r.inicio ? -1 : 0,
  );
  return cand[0]?.r ?? null;
}

/** `buscarFatorTransicaoCompraGov` (primeira vigente, início decrescente). */
export function buscarFatorTransicaoCompraGov(d: DadosBase, data: string): Dec | null {
  return maisRecentePrimeiro(vig(d.transicoesCompraGov, data))[0]?.fator ?? null;
}

/** `SituacaoIssParAliquotaSimplesRepository.buscarVigentes`: ordem ASC, id ASC. */
export function buscarSituacoesIss(d: DadosBase, data: string): SituacaoIss[] {
  return vig(d.situacoesIss, data).sort((a, b) => a.ordem - b.ordem || a.id - b.id);
}

// ─── AtividadeSimplesCalculoRepository ───────────────────────────────────────

export function buscarAtividadesVigentesPorCAtivSN(d: DadosBase, cAtivSN: string, data: string): AtividadeSn[] {
  return maisRecentePrimeiro(vig(d.atividades.filter((a) => a.cAtivSN === cAtivSN), data));
}

/** `contarVinculosComTpDoc(atividadeId, tpDoc, data)`. */
export function contarVinculosAtividadeComTpDoc(d: DadosBase, atividadeId: number, tpDoc: number, data: string): number {
  const dfe = new Set(tiposDfeVigentes(d, tpDoc, data).map((t) => t.id));
  return vig(d.tiposDfeAtividade.filter((t) => t.atividadeId === atividadeId && dfe.has(t.tipoDfeId)), data).length;
}

// ─── ClassificacaoTributariaSimplesRepository ────────────────────────────────

/** `buscarVigentes(codigo, data)` (grupo da CBS: CLTR_SITR_ID com TRIBUTO_SITUACAO_TRIBUTARIA.tributo = 2). */
export function buscarClassificacoesVigentes(d: DadosBase, codigo: string, data: string): ClassificacaoTributaria[] {
  return maisRecentePrimeiro(vig(d.classificacoes.filter((c) => c.codigo === codigo && d.sitrComCbs.has(c.sitrId)), data));
}

/** `contarVinculosComTpDoc(codigo, tpDoc, data)`: sem filtro de vigência da classificação (como no SQL oficial). */
export function contarVinculosClassificacaoComTpDoc(d: DadosBase, codigo: string, tpDoc: number, data: string): number {
  const cltrs = new Set(d.classificacoes.filter((c) => c.codigo === codigo && d.sitrComCbs.has(c.sitrId)).map((c) => c.id));
  const dfe = new Set(tiposDfeVigentes(d, tpDoc, data).map((t) => t.id));
  return vig(d.tiposDfeClassificacao.filter((t) => cltrs.has(t.cltrId) && dfe.has(t.tipoDfeId)), data).length;
}

/** `contarTratamentosNaoImplementados(codigo, data)`: tratamento vigente com TRTR_IN_POSSUI_AJUSTE = 1. */
export function contarTratamentosNaoImplementados(d: DadosBase, codigo: string, data: string): number {
  const cltrs = new Set(buscarClassificacoesVigentes(d, codigo, data).map((c) => c.id));
  let n = 0;
  for (const tc of d.tratamentoClassificacoes) {
    if (!cltrs.has(tc.cltrId) || !vigente(data, tc.inicio, tc.fim)) continue;
    const tt = d.tratamentos.get(tc.trtrId);
    if (tt && tt.possuiAjuste && vigente(data, tt.inicio, tt.fim)) n++;
  }
  return n;
}
