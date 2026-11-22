import { buscarClassificacoesVigentes, buscarTipoReceitaBrutaPadrao } from "./consultas";
import { carregarDadosBase, vigente, type AtividadeSn, type DadosBase } from "./data";
import { compararInteiros, isBlank, javaTrim, parseIntJava, parseLocalDate } from "./java-compat";
import {
  problemaBadRequest,
  problemaParametroAusente,
  problemaTipoArgumento,
  type ContextoHttp,
} from "./http";
import type {
  AtividadeSimplesDomain,
  ConsultaAtividades,
  ModoFatorR,
  ProblemDetail,
  RespostaAtividade,
  RespostaAtividades,
} from "./official-types";

/**
 * Port de `AtividadeSimplesController`, `AtividadeSimplesService` e `DerivacaoAnexosSimples`:
 * `GET /calculadora/simples-nacional/atividades` e `/{codigo}` (catálogo de atividades × anexos).
 */

const ANEXOS_VALIDOS = ["I", "II", "III", "IV", "V"] as const;
const PATH = "/calculadora/simples-nacional/atividades";

class RespostaStatusException extends Error {
  constructor(readonly motivo: string) {
    super(motivo);
  }
}

interface Derivacao {
  disponivel: boolean;
  anexosFaltantes: string[];
  modoFatorR: ModoFatorR;
}

function derivar(sem: string | null, com: string | null, configurados: Set<string> | null): Derivacao {
  if (com != null && sem == null) {
    throw new Error(
      `Atividade inconsistente: anexoComFatorR (${com}) preenchido sem anexoSemFatorR. Não existe atividade "só com Fator R"; corrija o banco.`,
    );
  }
  const conf = configurados ?? new Set<string>(ANEXOS_VALIDOS);
  const possiveis = ANEXOS_VALIDOS.filter((a) => a === sem || a === com);
  const faltantes = possiveis.filter((a) => !conf.has(a));
  const disponivel = possiveis.length === 0 || possiveis.some((a) => conf.has(a));
  let modo: ModoFatorR;
  if (com == null) modo = "NAO_APLICAVEL";
  else if (conf.has(com)) modo = sem != null && conf.has(sem) ? "OPCIONAL" : "OBRIGATORIO";
  else modo = "INDISPONIVEL";
  return { disponivel, anexosFaltantes: faltantes, modoFatorR: modo };
}

/** Elementos de `?anexos=` como o Spring os entrega ao controller (split por vírgula, vazios ignorados). */
function converterAnexos(anexos: string[] | null | undefined): Set<string> | null {
  if (anexos == null) return null;
  const configurados = new Set<string>();
  for (const elemento of anexos) {
    for (const anexo of elemento.split(",")) {
      if (anexo.length === 0) continue;
      if (!(ANEXOS_VALIDOS as readonly string[]).includes(anexo)) {
        throw new RespostaStatusException(`Anexo inválido: '${anexo}'. Valores aceitos: ${ANEXOS_VALIDOS.join(", ")}.`);
      }
      configurados.add(anexo);
    }
  }
  return configurados;
}

function validarTpDoc(d: DadosBase, tpDoc: string | null | undefined): string | null {
  if (tpDoc == null || isBlank(tpDoc)) return null;
  const informado = javaTrim(tpDoc);
  let tipo: number;
  try {
    tipo = parseIntJava(informado);
  } catch {
    throw new RespostaStatusException(
      `Tipo de documento fiscal inválido: '${informado}'. Informe o valor numérico da coluna TPDF_TIPO da TIPO_DFE (ex.: 55, 65, 91).`,
    );
  }
  // contarTiposDfePorTipo: todas as linhas de TIPO_DFE com o tipo, sem filtro de vigência.
  if (tipo < 0 || d.tiposDfe.filter((t) => t.tipo === tipo).length === 0) {
    throw new RespostaStatusException(
      `Tipo de documento fiscal desconhecido: '${informado}'. Não há linha na TIPO_DFE com TPDF_TIPO correspondente.`,
    );
  }
  return String(tipo);
}

function resolverVedadoNaoTributavel(d: DadosBase, cClassTrib: string | null | undefined, data: string): boolean | null {
  if (cClassTrib == null || isBlank(cClassTrib)) return null;
  const codigo = javaTrim(cClassTrib);
  const vigentes = buscarClassificacoesVigentes(d, codigo, data);
  if (vigentes.length === 0) {
    throw new RespostaStatusException(
      `Código de classificação tributária desconhecido ou fora de vigência: '${codigo}'. Informe um cClassTrib do grupo da CBS vigente na data de referência.`,
    );
  }
  const tpRBSN = vigentes[0].tpRBSN;
  const tipo = buscarTipoReceitaBrutaPadrao(d, tpRBSN, data);
  if (tipo == null) {
    throw new RespostaStatusException(
      `Não há parametrização de efeito vigente para o tipo de receita bruta tpRBSN=${tpRBSN} do cClassTrib '${codigo}' na data de referência.`,
    );
  }
  return tipo.vedadoNaoTributavel;
}

function tpDocsAdmissiveisPorAtividade(d: DadosBase, data: string): Map<number, string[]> {
  const porAtividade = new Map<number, number[]>();
  for (const v of d.tiposDfeAtividade) {
    if (!vigente(data, v.inicio, v.fim)) continue;
    const dfe = d.tiposDfe.find((t) => t.id === v.tipoDfeId && vigente(data, t.inicio, t.fim));
    if (!dfe || dfe.tipo == null) continue;
    const l = porAtividade.get(v.atividadeId);
    if (l) l.push(dfe.tipo);
    else porAtividade.set(v.atividadeId, [dfe.tipo]);
  }
  const resultado = new Map<number, string[]>();
  for (const [id, tipos] of porAtividade) resultado.set(id, [...tipos].sort(compararInteiros).map(String));
  return resultado;
}

function paraDominio(
  a: AtividadeSn,
  configurados: Set<string> | null,
  tpDocsAdmissiveis: string[],
  tpDoc: string | null,
  vedadoNaoTributavel: boolean | null,
): AtividadeSimplesDomain {
  const der = derivar(a.anexoSemFatorR, a.anexoComFatorR, configurados);
  const admissivel = tpDoc == null ? null : tpDocsAdmissiveis.includes(tpDoc);
  const compativel = vedadoNaoTributavel == null ? null : !(vedadoNaoTributavel && a.naoTributavel);
  const disponivel = der.disponivel && admissivel !== false && compativel !== false;
  const dom: AtividadeSimplesDomain = {
    codigo: a.cAtivSN as string,
    ordem: a.ordem,
    descricao: a.descricao,
    anexoSemFatorR: a.anexoSemFatorR,
    anexoComFatorR: a.anexoComFatorR,
    sujeitaFatorR: a.anexoComFatorR != null,
    rotuloAnexo: a.rotulo,
    rotuloCurtoAnexo: a.rotuloCurto,
    disponivel,
    anexosFaltantes: der.anexosFaltantes,
    modoFatorR: der.modoFatorR,
    tpDocsAdmissiveis,
  };
  if (admissivel != null) dom.admissivelNoDocumento = admissivel;
  if (compativel != null) dom.compativelComClassTrib = compativel;
  return dom;
}

function listar(
  d: DadosBase,
  data: string,
  configurados: Set<string> | null,
  tpDoc: string | null | undefined,
  cClassTrib: string | null | undefined,
): AtividadeSimplesDomain[] {
  const tpDocValidado = validarTpDoc(d, tpDoc);
  const vedado = resolverVedadoNaoTributavel(d, cClassTrib, data);
  const admissiveis = tpDocsAdmissiveisPorAtividade(d, data);
  return d.atividades
    .filter((a) => vigente(data, a.inicio, a.fim))
    .sort((x, y) => x.ordem - y.ordem)
    .map((a) => paraDominio(a, configurados, admissiveis.get(a.id) ?? [], tpDocValidado, vedado));
}

/** `@RequestParam @DateTimeFormat(iso = DATE) LocalDate data` (obrigatório). */
function lerDataObrigatoria(
  data: string | null | undefined,
  ctx: ContextoHttp,
  instance: string,
): { data: string } | { erro: ProblemDetail } {
  if (data == null || data.length === 0) {
    return { erro: problemaParametroAusente(ctx, "data", "LocalDate", instance) };
  }
  const m = /^(\d{4}-\d{2}-\d{2})(Z|[+-]\d{2}:\d{2}(:\d{2})?)?$/.exec(data);
  const iso = m ? parseLocalDate(m[1]) : null;
  if (iso == null) return { erro: problemaTipoArgumento(ctx, "data", data, instance) };
  return { data: iso };
}

export async function listarAtividades(consulta: ConsultaAtividades, ctx: ContextoHttp): Promise<RespostaAtividades> {
  const instance = `${ctx.contextPath}${PATH}`;
  const lida = lerDataObrigatoria(consulta.data, ctx, instance);
  if ("erro" in lida) return { status: 400, body: lida.erro };
  const d = await carregarDadosBase();
  try {
    const configurados = converterAnexos(consulta.anexos);
    return { status: 200, body: listar(d, lida.data, configurados, consulta.tpDoc, consulta.cClassTrib) };
  } catch (e) {
    if (e instanceof RespostaStatusException) return { status: 400, body: problemaBadRequest(e.motivo, instance) };
    throw e;
  }
}

export async function buscarAtividade(
  codigo: string,
  consulta: Omit<ConsultaAtividades, "anexos">,
  ctx: ContextoHttp,
): Promise<RespostaAtividade> {
  const instance = `${ctx.contextPath}${PATH}/${codigo}`;
  const lida = lerDataObrigatoria(consulta.data, ctx, instance);
  if ("erro" in lida) return { status: 400, body: lida.erro };
  const d = await carregarDadosBase();
  try {
    const atividade = listar(d, lida.data, null, consulta.tpDoc, consulta.cClassTrib).find((a) => a.codigo === codigo);
    return atividade ? { status: 200, body: atividade } : { status: 404, body: "" };
  } catch (e) {
    if (e instanceof RespostaStatusException) return { status: 400, body: problemaBadRequest(e.motivo, instance) };
    throw e;
  }
}
