/**
 * Tipos EXATOS dos contratos do motor oficial do Simples Nacional
 * (ReceitaFederal/calculadora-rtc-simples-nacional, SHA em scripts/rfb-sources.lock).
 *
 * Entradas: records Java em `api/simplesnacional/model/input/**`. Todos os valores numéricos de entrada
 * são TEXTO (validação tolerante com códigos VSN-*). Saídas: records `*Domain` em
 * `api/simplesnacional/model/output/**` e `api/atividadesimples/dto/**`, com a serialização Jackson
 * (`@JsonInclude(NON_NULL)` omite campos nulos; `ALWAYS` os mantém como `null`).
 */

// ─── Entradas ────────────────────────────────────────────────────────────────

/** OperacaoSimplesInput — `POST /calculadora/observabilidade/simples-nacional` (contrato clássico, OBSOLETO mas ativo). */
export interface OperacaoSimplesInput {
  id?: string | null;
  versao?: string | null;
  /** Data do fato gerador (YYYY-MM-DD). */
  data?: string | null;
  tpDoc?: string | null;
  CRT?: string | null;
  tpRegimeIBSCBS?: string | null;
  tpEnteGov?: string | null;
  itens?: Array<ItemSimplesInput | null> | null;
}

/** ItemSimplesInput (clássico): alíquotas efetivas por item, em pontos percentuais (texto). */
export interface ItemSimplesInput {
  numero?: number | null;
  cAtivSN?: string | null;
  cClassTrib?: string | null;
  /** Aceita também a grafia `NBS` (JsonAlias). */
  nbs?: string | null;
  NBS?: string | null;
  /** Aceita também a grafia `NCM` (JsonAlias). */
  ncm?: string | null;
  NCM?: string | null;
  /** 13v2, sem o vIS. */
  baseCalculo?: string | null;
  valorImpostoSeletivo?: string | null;
  pIBSSN?: string | null;
  pCBSSN?: string | null;
}

/** AliquotasEfetivasInput.ParAliquotasInput. */
export interface ParAliquotasInput {
  pCBSSN?: string | null;
  pIBSSN?: string | null;
}

/** AliquotasEfetivasInput.AnexoParUnicoInput (anexos I e II). */
export interface AnexoParUnicoInput {
  pCBSSN?: string | null;
  pIBSSN?: string | null;
}

/** AliquotasEfetivasInput.AnexoComIssInput (anexos III, IV e V). */
export interface AnexoComIssInput {
  pCBSSN?: string | null;
  pIBSSN?: string | null;
  semRedistribuicaoISS?: ParAliquotasInput | null;
}

/** AliquotasEfetivasInput: a linha de alíquotas efetivas do contribuinte (ADR-005). */
export interface AliquotasEfetivasInput {
  fatorR?: boolean | null;
  impedimentoSublimite?: boolean | null;
  anexoI?: AnexoParUnicoInput | null;
  anexoII?: AnexoParUnicoInput | null;
  anexoIII?: AnexoComIssInput | null;
  anexoIV?: AnexoComIssInput | null;
  anexoV?: AnexoComIssInput | null;
}

/** ItemSimplesUnificadoInput (não assistido/assistido, todos os documentos). */
export interface ItemSimplesUnificadoInput {
  numero?: number | null;
  cAtivSN?: string | null;
  cClassTrib?: string | null;
  nbs?: string | null;
  NBS?: string | null;
  ncm?: string | null;
  NCM?: string | null;
  baseCalculo?: string | null;
  valorImpostoSeletivo?: string | null;
  tribISSQN?: string | null;
  tpRetISSQN?: string | null;
  tpBM?: string | null;
}

/** OperacaoSimplesNaoAssistidaInput — `POST /calculadora/observabilidade/simples-nacional/nao-assistido`. */
export interface OperacaoSimplesNaoAssistidaInput {
  id?: string | null;
  versao?: string | null;
  data?: string | null;
  tpDoc?: string | null;
  CRT?: string | null;
  tpRegimeIBSCBS?: string | null;
  opSimpNac?: string | null;
  regApIBSCBSSN?: string | null;
  regApTribSN?: string | null;
  tpEnteGov?: string | null;
  aliquotasEfetivas?: AliquotasEfetivasInput | null;
  itens?: Array<ItemSimplesUnificadoInput | null> | null;
}

// ─── Enumerações ─────────────────────────────────────────────────────────────

export type EstadoItemSimples =
  | "CALCULADO"
  | "NAO_CALCULADO"
  | "NAO_IMPLEMENTADO"
  | "INCONSISTENCIA_ENTRADA"
  | "FALHA_TECNICA";

export type MotivoNaoCalculoSimples =
  | "REGIME_SOMENTE_RECEITA"
  | "CATIVSN_AUSENTE"
  | "CATIVSN_DESCONHECIDO"
  | "CATIVSN_INADMISSIVEL_NO_DOCUMENTO"
  | "ANEXO_SEM_ALIQUOTA_CBS";

export type CodigoRegimeApuracaoSimples =
  | "SN_PLENO"
  | "SN_SUBLIMITE"
  | "PENDENTE"
  | "PENDENTE_SUBLIMITE"
  | "SOMENTE_RECEITA";

export type TipoAliquotaSimples = "SEM_ALIQUOTA" | "PAR_UNICO" | "SEM_REDISTRIBUICAO" | "COM_REDISTRIBUICAO";

export type RegraAliquotaSimples =
  | "DOCUMENTO"
  | "ATIVIDADE_NAO_TRIBUTADA"
  | "ANEXO_SEM_ISS"
  | "ISS_FORA_DO_SIMPLES"
  | "ATIVIDADE_SEM_ISS"
  | "ISS_NAO_INCIDE"
  | "ISENCAO_MUNICIPAL"
  | "ISS_RETIDO"
  | "PADRAO";

export type MotivoResolucaoAliquota =
  | "RESOLVIDA"
  | "ATIVIDADE_SEM_ANEXO"
  | "ATIVIDADE_DESCONHECIDA"
  | "ANEXO_SEM_ALIQUOTA"
  | "ATIVIDADE_INADMISSIVEL_NO_DOCUMENTO"
  | "FATOR_R_AUSENTE"
  | "ITEM_NAO_IMPLEMENTADO";

export type ModoFatorR = "NAO_APLICAVEL" | "OPCIONAL" | "INDISPONIVEL" | "OBRIGATORIO";

// ─── Saídas ──────────────────────────────────────────────────────────────────

/** ErroDetalhe (RFC 7807/9457; campos nulos omitidos). */
export interface ErroDetalhe {
  type?: string;
  title?: string;
  code?: string;
  /** JSON Pointer RFC 6901 (`#/...`). */
  pointer?: string;
  detail?: string;
}

export interface MotivoEstadoSimplesDomain {
  codigo: MotivoNaoCalculoSimples;
  descricao: string;
}

export interface ImpostoSeletivoSimplesDomain {
  /** TDec1302 (sempre 2 casas). */
  valor: string;
}

export interface MemoriaCalculoSimplesDomain {
  cbs?: string;
  /** Suprimida quando o regime não gera IBS (CRT=2). */
  ibs?: string;
}

/** TributosSimplesDomain (`tribCalc`); valores monetários TDec1302, alíquotas TDec0302_04 (texto). */
export interface TributosSimplesDomain {
  vRBSNitem?: string;
  tpRBSN?: number;
  tpRBSNDescricao?: string;
  vBC?: string;
  pIBSSN?: string;
  vIBSSN?: string;
  vIBSPendSusp?: string;
  pCBSSN?: string;
  vCBSSN?: string;
  vCBSPendSusp?: string;
  IS?: ImpostoSeletivoSimplesDomain;
  totalItem?: string;
  memoriaCalculo?: MemoriaCalculoSimplesDomain;
}

export interface ObjetoSimplesDomain {
  nObj?: number;
  estadoItem?: EstadoItemSimples;
  motivoEstado?: MotivoEstadoSimplesDomain;
  tribCalc?: TributosSimplesDomain;
  erros?: ErroDetalhe[];
}

export interface OperacaoSimplesDomain {
  data?: string;
  tpDoc?: string;
  CRT?: string;
  tpRegimeIBSCBS?: string;
  opSimpNac?: string;
  regApIBSCBSSN?: string;
  regApTribSN?: string;
  tpEnteGov?: string;
  regimeApuracao?: CodigoRegimeApuracaoSimples;
}

export interface TotalSimplesDomain {
  vRBSNtot?: string;
  vBC?: string;
  vIBSSNtot?: string;
  vIBSSNtotPendSusp?: string;
  vCBSSNtot?: string;
  vCBSSNtotPendSusp?: string;
  totalIs?: string;
  totalTributos?: string;
}

/** ResolucaoAliquotaItemDomain (`@JsonInclude(ALWAYS)`: nulos aparecem como `null`). */
export interface ResolucaoAliquotaItemDomain {
  numero: number | null;
  cAtivSN: string | null;
  anexoAplicado: string | null;
  tipoAliquota: TipoAliquotaSimples | null;
  regraAliquota: RegraAliquotaSimples | null;
  /** Pontos percentuais, precisão integral, texto (`toPlainString`). */
  pIBSSN: string | null;
  pCBSSN: string | null;
  motivo: MotivoResolucaoAliquota;
  avisos: string[];
}

export interface ResolucaoAliquotasNaoAssistidoDomain {
  fatorR: boolean | null;
  indSublimite: boolean;
  itens: ResolucaoAliquotaItemDomain[];
  avisos: string[];
}

export interface ObservabilidadeSimplesDomain {
  oper?: OperacaoSimplesDomain;
  /** Só no contrato não assistido e quando o regime calcula tributos. */
  resolucaoAliquotas?: ResolucaoAliquotasNaoAssistidoDomain;
  objetos?: ObjetoSimplesDomain[];
  /** Ausente quando nenhum item tem `tribCalc`. */
  total?: TotalSimplesDomain;
}

/** AtividadeSimplesDomain (`GET /calculadora/simples-nacional/atividades[/{codigo}]`). */
export interface AtividadeSimplesDomain {
  codigo: string;
  ordem: number;
  descricao: string;
  anexoSemFatorR: string | null;
  anexoComFatorR: string | null;
  sujeitaFatorR: boolean;
  rotuloAnexo: string;
  rotuloCurtoAnexo: string;
  disponivel: boolean;
  anexosFaltantes: string[];
  modoFatorR: ModoFatorR;
  tpDocsAdmissiveis: string[];
  admissivelNoDocumento?: boolean;
  compativelComClassTrib?: boolean;
}

/** ProblemDetail (RFC 9457) tal como o `ApiExceptionHandler` oficial o serializa. */
export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  timestamp?: string;
  errors?: ErroDetalhe[];
}

// ─── Respostas HTTP ──────────────────────────────────────────────────────────

/**
 * Resposta HTTP do endpoint oficial: status + corpo JSON idêntico. Corpo vazio (ex.: 404 do
 * GET /atividades/{codigo}) é a string `""`.
 */
export interface SimplesHttpResponse<T> {
  status: number;
  body: T;
  /** Cabeçalhos relevantes (ex.: X-CALC-APP-VERSION) quando o motor os devolve. */
  headers?: Record<string, string>;
}

export type RespostaObservabilidade = SimplesHttpResponse<ObservabilidadeSimplesDomain | ProblemDetail>;
export type RespostaAtividades = SimplesHttpResponse<AtividadeSimplesDomain[] | ProblemDetail>;
export type RespostaAtividade = SimplesHttpResponse<AtividadeSimplesDomain | ProblemDetail | "">;

/** Query string do GET de atividades, como recebida (valores crus). */
export interface ConsultaAtividades {
  /** Obrigatório (YYYY-MM-DD). */
  data?: string | null;
  /** `?anexos=I&anexos=III` ou `?anexos=I,III`: cada elemento pode trazer vírgulas. */
  anexos?: string[] | null;
  tpDoc?: string | null;
  cClassTrib?: string | null;
}
