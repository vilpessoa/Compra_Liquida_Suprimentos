import { calcularItem, MOTIVOS_NAO_CALCULO, type InsumoCalculoSimples } from "./calculo";
import { CODIGOS_VSN, type CodigoValidacaoSimples } from "./codigos";
import { ItemCollector } from "./collector";
import {
  buscarAtividadesVigentesPorCAtivSN,
  buscarClassificacoesVigentes,
  buscarTipoReceitaBrutaPadrao,
  buscarTipoReceitaBrutaPorVocabulario,
  contarTratamentosNaoImplementados,
  contarVinculosAtividadeComTpDoc,
  contarVinculosClassificacaoComTpDoc,
} from "./consultas";
import type { AtividadeSn, ClassificacaoTributaria, DadosBase, RegimeApuracao, TipoReceitaBruta, Vocabulario } from "./data";
import { aliquotaDeTexto, D, type AliquotaDecimal, type Dec } from "./decimal";
import { isBlank, javaTrim } from "./java-compat";
import { validarEstrutural, validarPorClassificacao, type Indices } from "./nomenclatura";
import type {
  MotivoEstadoSimplesDomain,
  ObjetoSimplesDomain,
  ResolucaoAliquotaItemDomain,
} from "./official-types";

/**
 * Port de `ProcessadorItemSimples`: processamento POR ITEM do cálculo do Simples Nacional, compartilhado
 * pelo contrato clássico e pelo não assistido. Sequência:
 * 1. VSN-027 (tratamento não implementado) — prioridade máxima; 2. base e Imposto Seletivo;
 * 3. tipo de receita bruta pelo cClassTrib; 4. cAtivSN (inválido => NAO_CALCULADO, sem erro);
 * 5. alíquotas (resolvedor de cada endpoint); 6. cálculo puro.
 */

const CAMPO_CCLASSTRIB = "cClassTrib";
const FORMATO_VALOR = /^\d{1,13}(\.\d{1,2})?$/;
export const FORMATO_ALIQUOTA = /^\d{1,3}(\.\d{1,34})?$/;
export const DESCRICAO_FORMATO_ALIQUOTA =
  "até 3 dígitos inteiros e até 34 casas decimais, sem notação científica (ex.: 1.6839)";
const DESCRICAO_FORMATO_VALOR =
  "até 13 dígitos inteiros e até 2 casas decimais, sem notação científica (ex.: 1000.00)";

// ─── Contratos ───────────────────────────────────────────────────────────────

export interface EntradaItem {
  numero: number | null;
  cAtivSN: string | null;
  cClassTrib: string | null;
  baseCalculo: string | null;
  valorImpostoSeletivo: string | null;
  NCM: string | null;
  NBS: string | null;
}

export interface ContextoItem {
  data: string;
  tpDoc: number;
  regime: RegimeApuracao;
  tpEnteGov: number | null;
  fatorTransicaoCompraGov: Dec | null;
  /** `null` = só a linha padrão do tpRBSN (clássico). */
  vocabularioTipoReceita: Vocabulario | null;
  normalizarCAtivSN: boolean;
  admiteImpostoSeletivo: boolean;
  casasAliquotaCalculo: number | null;
  siglaDfe: string | null;
  permiteNcmZero: boolean;
}

export interface AtividadeItem {
  cAtivSN: string | null;
  atividade: AtividadeSn | null;
  admissivel: boolean;
}

const atividadeValida = (a: AtividadeItem) => a.atividade != null && a.admissivel;

export interface DadosAliquotasItem {
  index: number;
  atividade: AtividadeItem;
  tipoReceita: TipoReceitaBruta | null;
  cbsExigida: boolean;
  ibsExigida: boolean;
}

export interface AliquotasItem {
  pIBSSN: AliquotaDecimal | null;
  pCBSSN: AliquotaDecimal | null;
  /** `true`: item NAO_CALCULADO mesmo com cAtivSN válido (só no assistido; nunca neste motor). */
  naoCalcular: boolean;
  resolucao: ResolucaoAliquotaItemDomain | null;
}

export interface ResolvedorAliquotasItem {
  resolver(dados: DadosAliquotasItem, collector: ItemCollector): AliquotasItem;
  /** Resolução mostrada quando o item é NAO_IMPLEMENTADO e não chega às alíquotas. */
  naoAvaliado(): ResolucaoAliquotaItemDomain | null;
}

export interface ItemProcessado {
  objeto: ObjetoSimplesDomain;
  resolucao: ResolucaoAliquotaItemDomain | null;
}

export interface Ambiente {
  dados: DadosBase;
  indices: Indices;
  baseURL: string;
}

// ─── Processamento ───────────────────────────────────────────────────────────

/** Processa um item; erros de validação ficam no próprio item (RFC 7807), nunca na operação. */
export function processarItem(
  amb: Ambiente,
  item: EntradaItem,
  index: number,
  ctx: ContextoItem,
  resolvedor: ResolvedorAliquotasItem,
): ItemProcessado {
  const collector = new ItemCollector(index, amb.baseURL);
  const nObj = item.numero;
  if (nObj == null) {
    collector.addErroValidacao(CODIGOS_VSN.NUMERO_AUSENTE, "numero", "O número do item é obrigatório.");
  }
  const nObjSaida = nObj ?? index + 1;

  // 0. PRIORIDADE MÁXIMA: cClassTrib vinculado a tratamento "sem implementação" (TRTR_IN_POSSUI_AJUSTE).
  if (cClassTribNaoImplementado(amb.dados, item.cClassTrib, ctx, collector)) {
    return {
      objeto: { nObj: nObjSaida, estadoItem: collector.estado, erros: collector.erros },
      resolucao: resolvedor.naoAvaliado(),
    };
  }

  // A regra do NCM zero depende do DF-e real selecionado, não do tpDoc.
  const ncm = ctx.permiteNcmZero && (item.NCM === "00" || item.NCM === "00000000") ? null : item.NCM;

  // 1. Insumos monetários.
  const baseCalculo = validarDecimal(item.baseCalculo, collector, "baseCalculo", CODIGOS_VSN.BASE_AUSENTE, CODIGOS_VSN.BASE_INVALIDA);

  // A origem executa a validação estrutural de NCM/NBS depois da base.
  const estruturaNomenclaturaValida = validarEstrutural(amb.indices, ncm, item.NBS, ctx.data, collector);

  const valorIs = ctx.admiteImpostoSeletivo
    ? validarDecimal(item.valorImpostoSeletivo, collector, "valorImpostoSeletivo", CODIGOS_VSN.IS_INVALIDO, CODIGOS_VSN.IS_INVALIDO)
    : validarImpostoSeletivoNaoAdmitido(item.valorImpostoSeletivo, collector);

  // 2. Tipo de receita bruta pelo cClassTrib.
  const resolucaoClassificacao = resolverTipoReceitaBruta(amb.dados, item.cClassTrib, ctx, collector);
  const tipoReceita = resolucaoClassificacao ? resolucaoClassificacao.tipoReceita : null;

  validarPorClassificacao(
    amb.dados,
    ncm,
    item.NBS,
    ctx.data,
    ctx.siglaDfe,
    resolucaoClassificacao ? resolucaoClassificacao.classificacao : null,
    estruturaNomenclaturaValida,
    collector,
  );

  const calculaTributos = ctx.regime.calculaTributos !== false;
  let atividade: AtividadeItem = { cAtivSN: null, atividade: null, admissivel: false };
  let aliquotas: AliquotasItem = { pIBSSN: null, pCBSSN: null, naoCalcular: false, resolucao: null };
  if (calculaTributos) {
    // 3. cAtivSN: código inválido NÃO é erro, leva a NAO_CALCULADO.
    atividade = validarCAtivSN(amb.dados, item.cAtivSN, tipoReceita, ctx, collector);

    // 4. Alíquotas exigidas apenas quando o cálculo as usa.
    const aliquotasExigidas = atividadeValida(atividade) && tipoReceita != null && tipoReceita.exigeAliquota;
    const pIbsExigida = aliquotasExigidas && ctx.regime.geraIbs === true;
    aliquotas = resolvedor.resolver(
      { index, atividade, tipoReceita, cbsExigida: aliquotasExigidas, ibsExigida: pIbsExigida },
      collector,
    );
  }

  // 5. Havendo erros de validação, não calcula.
  if (collector.hasErros()) {
    return {
      objeto: { nObj: nObjSaida, estadoItem: collector.estado, erros: collector.erros },
      resolucao: aliquotas.resolucao,
    };
  }

  // 6. Cálculo puro, com todos os parâmetros já resolvidos.
  const motivoNaoCalculo = calculaTributos ? motivoNaoCalculoDoItem(atividade, aliquotas, ctx) : null;
  try {
    const insumo: InsumoCalculoSimples = {
      regime: ctx.regime,
      tipoReceitaBruta: tipoReceita as TipoReceitaBruta,
      motivoNaoCalculo,
      baseCalculo,
      valorImpostoSeletivo: valorIs,
      pIBSSN: aliquotas.pIBSSN,
      pCBSSN: aliquotas.pCBSSN,
      tpEnteGov: ctx.tpEnteGov,
      fatorTransicaoCompraGov: ctx.fatorTransicaoCompraGov,
      casasAliquotaCalculo: ctx.casasAliquotaCalculo,
    };
    const r = calcularItem(insumo);
    const objeto: ObjetoSimplesDomain = { nObj: nObj as number, estadoItem: r.estadoItem };
    if (r.motivoEstado) objeto.motivoEstado = r.motivoEstado;
    objeto.tribCalc = r.tribCalc;
    return { objeto, resolucao: aliquotas.resolucao };
  } catch (ex) {
    collector.addFalhaTecnica(ex instanceof Error ? ex.message : String(ex));
    return {
      objeto: { nObj: nObjSaida, estadoItem: collector.estado, erros: collector.erros },
      resolucao: aliquotas.resolucao,
    };
  }
}

/**
 * Motivo pelo qual o item, num regime que calcula tributos, não é calculável — na ordem: cAtivSN ausente,
 * sem atividade vigente, não admitida no tpDoc e anexo sem a CBS (só no assistido).
 */
function motivoNaoCalculoDoItem(
  atividade: AtividadeItem,
  aliquotas: AliquotasItem,
  ctx: ContextoItem,
): MotivoEstadoSimplesDomain | null {
  if (atividade.cAtivSN == null) return MOTIVOS_NAO_CALCULO.CATIVSN_AUSENTE();
  if (atividade.atividade == null) return MOTIVOS_NAO_CALCULO.CATIVSN_DESCONHECIDO(atividade.cAtivSN);
  if (!atividade.admissivel) {
    const documento = ctx.siglaDfe != null ? ctx.siglaDfe : "informado";
    return MOTIVOS_NAO_CALCULO.CATIVSN_INADMISSIVEL_NO_DOCUMENTO(atividade.cAtivSN, documento, ctx.tpDoc);
  }
  if (aliquotas.naoCalcular) {
    const anexo = aliquotas.resolucao ? aliquotas.resolucao.anexoAplicado : null;
    return MOTIVOS_NAO_CALCULO.ANEXO_SEM_ALIQUOTA_CBS(anexo != null ? anexo : "aplicado");
  }
  return null;
}

/** cAtivSN como o cálculo o usa: sem espaços nas pontas e, nos endpoints novos, "7" => "07". */
export function normalizarCAtivSN(cAtivSN: string | null, completarZero: boolean): string | null {
  if (cAtivSN == null || isBlank(cAtivSN)) return null;
  const codigo = javaTrim(cAtivSN);
  return completarZero && /^\d$/.test(codigo) ? `0${codigo}` : codigo;
}

/** Verificação PRIORITÁRIA de implementação do cClassTrib (VSN-027, estado NAO_IMPLEMENTADO). */
function cClassTribNaoImplementado(
  d: DadosBase,
  cClassTrib: string | null,
  ctx: ContextoItem,
  collector: ItemCollector,
): boolean {
  if (cClassTrib == null || isBlank(cClassTrib)) return false;
  const codigo = javaTrim(cClassTrib);
  if (contarTratamentosNaoImplementados(d, codigo, ctx.data) === 0) return false;
  collector.addNaoImplementado(
    CODIGOS_VSN.CCLASSTRIB_NAO_IMPLEMENTADO,
    CAMPO_CCLASSTRIB,
    `A classificação tributária '${codigo}' ainda não possui tratamento implementado no cálculo do Simples Nacional na data '${ctx.data}'. Essa funcionalidade está prevista no roadmap e será disponibilizada em versão futura.`,
  );
  return true;
}

interface ResolucaoClassificacao {
  classificacao: ClassificacaoTributaria;
  tipoReceita: TipoReceitaBruta | null;
}

/** Resolve o tipo de receita bruta do item (tpRBSN do cClassTrib + efeito do código na tabela de tipos). */
function resolverTipoReceitaBruta(
  d: DadosBase,
  cClassTrib: string | null,
  ctx: ContextoItem,
  collector: ItemCollector,
): ResolucaoClassificacao | null {
  if (cClassTrib == null || isBlank(cClassTrib)) {
    collector.addErroValidacao(
      CODIGOS_VSN.CCLASSTRIB_AUSENTE,
      CAMPO_CCLASSTRIB,
      "O código de classificação tributária (cClassTrib) é obrigatório e não foi informado.",
    );
    return null;
  }
  const codigo = javaTrim(cClassTrib);

  const vigentes = buscarClassificacoesVigentes(d, codigo, ctx.data);
  if (vigentes.length === 0) {
    collector.addErroValidacao(
      CODIGOS_VSN.CCLASSTRIB_DESCONHECIDO,
      CAMPO_CCLASSTRIB,
      `O cClassTrib '${codigo}' não existe ou não está vigente na data '${ctx.data}': o tpRBSN não pôde ser determinado.`,
    );
    return null;
  }
  const classificacao = vigentes[0];

  if (contarVinculosClassificacaoComTpDoc(d, codigo, ctx.tpDoc, ctx.data) === 0) {
    collector.addErroValidacao(
      CODIGOS_VSN.CCLASSTRIB_INCOMPATIVEL_TPDOC,
      CAMPO_CCLASSTRIB,
      `O cClassTrib '${codigo}' não é admissível para o tipo de documento fiscal ${ctx.tpDoc}.`,
    );
    return null;
  }

  const tpRBSN = classificacao.tpRBSN;
  const tipoReceita =
    ctx.vocabularioTipoReceita == null
      ? buscarTipoReceitaBrutaPadrao(d, tpRBSN, ctx.data)
      : buscarTipoReceitaBrutaPorVocabulario(d, tpRBSN, ctx.vocabularioTipoReceita, ctx.data);
  if (tipoReceita == null) {
    collector.addErroValidacao(
      CODIGOS_VSN.PARAMETRIZACAO_INDISPONIVEL,
      CAMPO_CCLASSTRIB,
      `Não há parametrização de efeito vigente para o tipo de receita bruta tpRBSN=${tpRBSN} na data '${ctx.data}'.`,
    );
  }
  return { classificacao, tipoReceita };
}

/**
 * Valida o cAtivSN. Ausente/desconhecido/fora de vigência/inadmissível NÃO é erro (NAO_CALCULADO). A única
 * exceção que É erro é VSN-023 (regra UB14-90 da NT): atividade não tributável com tpRBSN vedado.
 */
function validarCAtivSN(
  d: DadosBase,
  cAtivSN: string | null,
  tipoReceita: TipoReceitaBruta | null,
  ctx: ContextoItem,
  collector: ItemCollector,
): AtividadeItem {
  const codigo = normalizarCAtivSN(cAtivSN, ctx.normalizarCAtivSN);
  if (codigo == null) return { cAtivSN: null, atividade: null, admissivel: false };

  const atividades = buscarAtividadesVigentesPorCAtivSN(d, codigo, ctx.data);
  if (atividades.length === 0) return { cAtivSN: codigo, atividade: null, admissivel: false };
  const atividade = atividades[0];

  if (contarVinculosAtividadeComTpDoc(d, atividade.id, ctx.tpDoc, ctx.data) === 0) {
    return { cAtivSN: codigo, atividade, admissivel: false };
  }

  if (atividade.naoTributavel && tipoReceita != null && tipoReceita.vedadoNaoTributavel) {
    collector.addErroValidacao(
      CODIGOS_VSN.CATIVSN_INCOMPATIVEL_CCLASSTRIB,
      "cAtivSN",
      `O código de atividade '${codigo}' (Operações não Tributáveis) é incompatível com cClassTrib de tpRBSN=${tipoReceita.codigo}.`,
    );
  }
  return { cAtivSN: codigo, atividade, admissivel: true };
}

// ─── Validação/conversão de números ──────────────────────────────────────────

/** Alíquota (pontos percentuais) em texto; ausência só é erro quando exigida; formato inválido é sempre erro. */
export function validarAliquota(
  valor: string | null,
  exigida: boolean,
  collector: ItemCollector,
  campo: string,
  codigoAusente: CodigoValidacaoSimples,
  codigoInvalido: CodigoValidacaoSimples,
): AliquotaDecimal | null {
  if (valor == null || isBlank(valor)) {
    if (exigida) {
      collector.addErroValidacao(codigoAusente, campo, "A alíquota é exigida para o cálculo do item e não foi informada.");
    }
    return null;
  }
  const t = converterNoFormato(valor, FORMATO_ALIQUOTA, DESCRICAO_FORMATO_ALIQUOTA, collector, campo, codigoInvalido);
  return t == null ? null : aliquotaDeTexto(t);
}

function validarDecimal(
  valor: string | null,
  collector: ItemCollector,
  campo: string,
  codigoAusente: CodigoValidacaoSimples,
  codigoInvalido: CodigoValidacaoSimples,
): Dec | null {
  if (valor == null || isBlank(valor)) {
    collector.addErroValidacao(codigoAusente, campo, "O campo é obrigatório e não foi informado.");
    return null;
  }
  const t = converterNoFormato(valor, FORMATO_VALOR, DESCRICAO_FORMATO_VALOR, collector, campo, codigoInvalido);
  return t == null ? null : new D(t);
}

/** IS em documento que não o tem (NFS-e): ausente ou zero aceito; formato inválido VSN-003; outro valor VSN-035. */
function validarImpostoSeletivoNaoAdmitido(valor: string | null, collector: ItemCollector): Dec | null {
  if (valor == null || isBlank(valor)) return null;
  const t = converterNoFormato(valor, FORMATO_VALOR, DESCRICAO_FORMATO_VALOR, collector, "valorImpostoSeletivo", CODIGOS_VSN.IS_INVALIDO);
  if (t != null && !new D(t).isZero()) {
    collector.addErroValidacao(
      CODIGOS_VSN.IS_NAO_ADMITIDO,
      "valorImpostoSeletivo",
      `O documento não tem Imposto Seletivo: o valor deve ser zero ou não ser informado, recebido: '${valor}'.`,
    );
  }
  return null;
}

/**
 * Valida o formato ANTES de converter (aceita só `\d{1,N}(\.\d{1,M})?`, sem expoente). Devolve o texto
 * `trim`ado se válido; senão acumula `codigoInvalido` e devolve `null`.
 */
export function converterNoFormato(
  valor: string,
  formato: RegExp,
  descricaoFormato: string,
  collector: ItemCollector,
  campo: string,
  codigoInvalido: CodigoValidacaoSimples,
): string | null {
  const texto = javaTrim(valor);
  if (formato.test(texto)) return texto;
  if (texto.startsWith("-") && formato.test(texto.slice(1))) {
    collector.addErroValidacao(codigoInvalido, campo, `O valor não pode ser negativo, recebido: '${valor}'.`);
  } else {
    collector.addErroValidacao(
      codigoInvalido,
      campo,
      `O valor não é um número decimal válido, recebido: '${valor}'. Informe ${descricaoFormato}.`,
    );
  }
  return null;
}
