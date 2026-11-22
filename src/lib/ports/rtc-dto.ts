/**
 * DTOs espelhando os contratos JSON oficiais da API
 * ReceitaFederal/calculadora-rtc-regime-regular (POST /api/calculadora/regime-geral).
 * Fonte: src/main/java/br/gov/serpro/rtc/api/model/input/{OperacaoInput,ItemOperacaoInput,...}.java
 * Mantê-los 1:1 permite trocar o motor local pelo motor oficial apenas mudando o adapter.
 * Valores monetários e percentuais trafegam como string decimal para não perder precisão.
 */
export type DecimalString = string;

export interface ImpostoSeletivoInput {
  cst: string;
  cClassTrib: string;
  baseCalculo?: DecimalString;
  quantidade?: DecimalString;
  unidade?: string;
  impostoInformado?: DecimalString;
}

export interface TributacaoRegularInput {
  cst: string;
  cClassTrib: string;
}

export interface ItemOperacaoInput {
  numero: number;
  ncm?: string;
  nbs?: string;
  cst: string;
  cClassTrib: string;
  baseCalculo?: DecimalString;
  quantidade?: DecimalString;
  unidade?: string;
  impostoSeletivo?: ImpostoSeletivoInput;
  tributacaoRegular?: TributacaoRegularInput;
}

export interface OperacaoInput {
  id?: string;
  versao?: string;
  /** ISO 8601 com offset, ex.: 2027-03-10T10:00:00-03:00 */
  dhFatoGerador: string;
  /** Código IBGE do município (7 dígitos). */
  municipio: number;
  uf: string;
  tpDoc?: number;
  itens: ItemOperacaoInput[];
}

/** Grupo de um tributo calculado (CBS, IBS UF ou IBS Município). */
export interface TributoCalculado {
  tributo: "CBS" | "IBS_UF" | "IBS_MUN";
  vBC: DecimalString;
  pAliq: DecimalString;
  pRedAliq?: DecimalString;
  pAliqEfet: DecimalString;
  vTrib: DecimalString;
  pDif?: DecimalString;
  vDif?: DecimalString;
  vDevTrib?: DecimalString;
  memoriaCalculo?: string;
}

export interface ImpostoSeletivoCalculado {
  vBCIS: DecimalString;
  pIS?: DecimalString;
  pISEspec?: DecimalString;
  vIS: DecimalString;
  memoriaCalculo?: string;
}

export interface ItemCalculado {
  numero: number;
  cst: string;
  cClassTrib: string;
  tributos: TributoCalculado[];
  impostoSeletivo?: ImpostoSeletivoCalculado;
  /** Fundamentação legal oficial vinculada à cClassTrib (texto da tabela da RFB). */
  fundamentacaoLegal?: string[];
}
