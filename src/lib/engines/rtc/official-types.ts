/**
 * Tipos EXATOS dos contratos JSON oficiais da API
 * ReceitaFederal/calculadora-rtc-regime-regular (SHA em scripts/rfb-sources.lock).
 *
 * Fonte (somente leitura, .rfb/calculadora-rtc-regime-regular/src/main/java/br/gov/serpro/rtc):
 *  - entrada : api/model/input/{OperacaoInput,ItemOperacaoInput,ImpostoSeletivoInput,TributacaoRegularInput,
 *              AliquotasNominaisInput,AliquotasNominaisImpostoSeletivo,CompraGovernamentalInput,
 *              basecalculo/ComponentesBaseCalculoInput}.java
 *  - saída   : api/model/roc/*.java (ROCDomain, ObservabilidadeROCDomain, ObservabilidadeItemDomain, TributosDomain,
 *              IBSCBSDomain, GrupoIBSCBSDomain, CBSDomain, IBSUFDomain, IBSMunDomain, DiferimentoDomain,
 *              ReducaoAliquotaDomain, TributacaoRegularDomain, TributacaoCompraGovernamentalDomain,
 *              ImpostoSeletivoDomain, MemoriaCalculoDomain, ValoresTotaisDomain e totais)
 *  - erros   : api/exceptionhandler/dto/ErroDetalhe.java e ObservabilidadeExceptionHandler.java (RFC 9457)
 *
 * Todos os campos decimais de SAÍDA trafegam como string (serializers BigDecimalTDec1302/0302_04/1104OpRTC).
 * Os campos decimais de ENTRADA são números JSON (ou strings numéricas, que o Jackson oficial também aceita);
 * o tipo `JsonDecimal` reflete isso.
 */

/** Decimal de entrada: número JSON ou string numérica (Jackson coage ambos para BigDecimal). */
export type JsonDecimal = number | string;

/** Enum numérico `TipoEnteGovernamental`: 1=União 2=Estado 3=DF 4=Município 5=Consórcio 6=Comitê Gestor IBS. */
export type TpEnteGov = 1 | 2 | 3 | 4 | 5 | 6;
/** Enum numérico `TipoOperacaoGovernamental` (1..5). */
export type TpOperGov = 1 | 2 | 3 | 4 | 5;

export interface CompraGovernamentalInput {
  tpEnteGov: TpEnteGov;
  tpOperGov?: TpOperGov | null;
}

export interface ImpostoSeletivoInput {
  cst: string;
  cClassTrib: string;
  baseCalculo: JsonDecimal;
  quantidade?: JsonDecimal | null;
  unidade?: string | null;
  impostoInformado?: JsonDecimal | null;
}

export interface TributacaoRegularInput {
  cst: string;
  cClassTrib: string;
}

export interface AliquotasNominaisImpostoSeletivo {
  adValorem?: JsonDecimal | null;
  adRem?: JsonDecimal | null;
}

export interface AliquotasNominaisInput {
  cbs?: JsonDecimal | null;
  ibsEstadual?: JsonDecimal | null;
  ibsMunicipal?: JsonDecimal | null;
  impostoSeletivo?: AliquotasNominaisImpostoSeletivo | null;
}

/** ComponentesBaseCalculoInput (grupo gComponentesBC). Não validado localmente (ver unsupported.ts). */
export interface ComponentesBaseCalculoInput {
  vProd?: JsonDecimal | null;
  vFrete?: JsonDecimal | null;
  vSeg?: JsonDecimal | null;
  vOutro?: JsonDecimal | null;
  vII?: JsonDecimal | null;
  vIS?: JsonDecimal | null;
  vDesc?: JsonDecimal | null;
  vPIS?: JsonDecimal | null;
  vCOFINS?: JsonDecimal | null;
  vICMS?: JsonDecimal | null;
  vICMSUFDest?: JsonDecimal | null;
  vFCP?: JsonDecimal | null;
  vFCPUFDest?: JsonDecimal | null;
  vICMSMono?: JsonDecimal | null;
  vISSQN?: JsonDecimal | null;
}

export interface ItemOperacaoInput {
  numero: number;
  ncm?: string | null;
  nbs?: string | null;
  cst: string;
  cClassTrib: string;
  baseCalculo?: JsonDecimal | null;
  quantidade?: JsonDecimal | null;
  unidade?: string | null;
  impostoSeletivo?: ImpostoSeletivoInput | null;
  tributacaoRegular?: TributacaoRegularInput | null;
  gComponentesBC?: ComponentesBaseCalculoInput | null;
  aliquotasNominais?: AliquotasNominaisInput | null;
}

export interface OperacaoInput {
  id: string;
  versao: string;
  /** ISO 8601 com offset ou Z: `yyyy-MM-dd'T'HH:mm:ssXXX`. Preferido. */
  dhFatoGerador?: string | null;
  /** @deprecated campo oficial obsoleto; usado quando dhFatoGerador ausente. */
  dataHoraEmissao?: string | null;
  /** Código IBGE do município, 0..9999999. */
  municipio: number;
  /** Sigla da UF (2 letras). Opcional: derivada do município quando ausente. */
  uf?: string | null;
  /** Tipo do DFe (1..999), ex. 55 = NF-e, 65 = NFC-e. */
  tpDoc?: number | null;
  gCompraGov?: CompraGovernamentalInput | null;
  itens: ItemOperacaoInput[];
}

// ───────────────────────────── Saída ─────────────────────────────

export type EstadoItem =
  | "CALCULADO"
  | "NAO_IMPLEMENTADO"
  | "INCONSISTENCIA_ENTRADA"
  | "FALHA_TECNICA"
  | "CALCULO_SIMULADO";

/** ErroDetalhe (record Java): RFC 9457 por item/operação. */
export interface ErroDetalhe {
  type: string;
  title: string;
  code: string;
  pointer: string;
  detail: string;
}

export interface DiferimentoDomain {
  pDif: string;
  vDif: string;
}
export interface ReducaoAliquotaDomain {
  pRedAliq?: string;
  pAliqEfet?: string;
}
export interface CBSDomain {
  pCBS: string;
  gDif?: DiferimentoDomain;
  gRed?: ReducaoAliquotaDomain;
  vCBS: string;
}
export interface IBSUFDomain {
  pIBSUF: string;
  gDif?: DiferimentoDomain;
  gRed?: ReducaoAliquotaDomain;
  vIBSUF: string;
}
export interface IBSMunDomain {
  pIBSMun: string;
  gDif?: DiferimentoDomain;
  gRed?: ReducaoAliquotaDomain;
  vIBSMun: string;
}
export interface TributacaoRegularDomain {
  CSTReg?: string;
  cClassTribReg?: string;
  pAliqEfetRegIBSUF: string;
  vTribRegIBSUF: string;
  pAliqEfetRegIBSMun: string;
  vTribRegIBSMun: string;
  pAliqEfetRegCBS: string;
  vTribRegCBS: string;
}
export interface TributacaoCompraGovernamentalDomain {
  pAliqIBSUF: string;
  vTribIBSUF: string;
  pAliqIBSMun: string;
  vTribIBSMun: string;
  pAliqCBS: string;
  vTribCBS: string;
}
export interface GrupoIBSCBSDomain {
  vBC?: string;
  gIBSUF?: IBSUFDomain;
  gIBSMun?: IBSMunDomain;
  vIBS?: string;
  gCBS?: CBSDomain;
  gTribRegular?: TributacaoRegularDomain;
  gTribCompraGov?: TributacaoCompraGovernamentalDomain;
}
export interface MemoriaCalculoDomain {
  cbs?: string | null;
  ibsUF?: string | null;
  ibsMun?: string | null;
}
export interface IBSCBSDomain {
  CST: string;
  cClassTrib: string;
  gIBSCBS?: GrupoIBSCBSDomain;
  memoriaCalculo?: MemoriaCalculoDomain;
}
export interface ImpostoSeletivoDomain {
  CSTIS: string;
  cClassTribIS: string;
  vBCIS: string;
  pIS?: string;
  pISEspec?: string;
  adRemIS?: string;
  uTrib?: string;
  qTrib?: string;
  vIS?: string;
  memoriaCalculo?: string;
}
export interface TributosDomain {
  IS?: ImpostoSeletivoDomain;
  IBSCBS: IBSCBSDomain;
}

export interface ImpostoSeletivoTotalDomain {
  vIS: string;
}
export interface IBSUFTotalDomain {
  vDif: string;
  vDevTrib: string;
  vIBSUF: string;
}
export interface IBSMunTotalDomain {
  vDif: string;
  vDevTrib: string;
  vIBSMun: string;
}
export interface IBSTotalDomain {
  gIBSUF: IBSUFTotalDomain;
  gIBSMun: IBSMunTotalDomain;
  vIBS: string;
  vCredPres: string;
  vCredPresCondSus: string;
}
export interface CBSTotalDomain {
  vDif: string;
  vDevTrib: string;
  vCBS: string;
  vCredPres: string;
  vCredPresCondSus: string;
}
export interface MonofasiaTotalDomain {
  vIBSMono: string;
  vCBSMono: string;
  vIBSMonoReten: string;
  vCBSMonoReten: string;
  vIBSMonoRet: string;
  vCBSMonoRet: string;
}
export interface IBSCBSTotalDomain {
  vBCIBSCBS: string;
  gIBS: IBSTotalDomain;
  gCBS: CBSTotalDomain;
  gMono: MonofasiaTotalDomain;
}
export interface ValoresTotaisDomain {
  tribCalc: {
    ISTot?: ImpostoSeletivoTotalDomain;
    IBSCBSTot?: IBSCBSTotalDomain;
  };
}

export interface CompraGovernamentalDomain {
  tpEnteGov: TpEnteGov;
  pRedutor: string;
  tpOperGov?: TpOperGov;
}
export interface OperacaoConsumoDomain {
  gCompraGov?: CompraGovernamentalDomain;
}

/** Item de `/observabilidade/regime-geral` (ObservabilidadeItemDomain). */
export interface ObservabilidadeItemDomain {
  nObj: number;
  estadoItem: EstadoItem;
  tribCalc?: TributosDomain;
  erros?: ErroDetalhe[];
}
/** Corpo 200 de `POST /calculadora/observabilidade/regime-geral` (ObservabilidadeROCDomain). */
export interface ObservabilidadeROCDomain {
  oper?: OperacaoConsumoDomain;
  objetos: ObservabilidadeItemDomain[];
  total?: ValoresTotaisDomain;
}

/** Item de `/regime-geral` (ObjetoDomain). `calculoSimulado` só aparece quando true (boolean primitivo = sempre presente). */
export interface ObjetoDomain {
  nObj: number;
  tribCalc?: TributosDomain;
  calculoSimulado: boolean;
}
/** Corpo 200 de `POST /calculadora/regime-geral` (ROCDomain). */
export interface ROCDomain {
  oper?: OperacaoConsumoDomain;
  objetos: ObjetoDomain[];
  total?: ValoresTotaisDomain;
}

/** ProblemDetail (RFC 9457) devolvido pelo Spring nos erros HTTP 400/404/422. */
export interface ProblemDetailBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  timestamp: string;
  /** Presente somente em 422 de `ErrosCalculoException` (observabilidade). */
  errors?: ErroDetalhe[];
}

export type RtcResponseBody = ObservabilidadeROCDomain | ROCDomain | ProblemDetailBody;

/** Resposta idêntica à da API: objeto JSON + status HTTP + headers relevantes (nomes em minúsculas). */
export interface RtcHttpResponse<T = RtcResponseBody> {
  status: number;
  body: T;
  headers: RtcResponseHeaders;
}

export interface RtcResponseHeaders {
  /** Presente somente nas respostas 200 (VersaoAplicacaoService). */
  "x-calc-app-version"?: string;
  "x-calc-db-version"?: string;
  /** Aviso de dados simulados (AvisoDadosSimuladosService): "1".."6". */
  "x-warning-dados-simulados"?: string;
}
