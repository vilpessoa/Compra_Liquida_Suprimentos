/**
 * Combinações (cst, cClassTrib, condição) que o motor local NÃO consegue garantir idênticas ao motor oficial.
 * Preenchido a partir do relatório de conformidade (conformance/RELATORIO-regime-regular.md); vazio = o corpus
 * inteiro foi reproduzido. O LocalRtcEngine lança MotorLocalNaoValidadoError para estas combinações.
 */
export interface CombinacaoNaoValidada {
  cst?: string;
  cClassTrib?: string;
  condicao: string;
}
export const COMBINACOES_NAO_VALIDADAS: readonly CombinacaoNaoValidada[] = [];
