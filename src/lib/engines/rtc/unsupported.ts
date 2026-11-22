/**
 * Combinações (cst, cClassTrib, condição) que o motor local NÃO consegue garantir idênticas ao motor oficial.
 * O LocalRtcEngine lança `MotorLocalNaoValidadoError` para elas (a camada superior bloqueia a decisão ou
 * encaminha ao adapter rfb-http). Também aparecem em conformance/RELATORIO-regime-regular.md.
 *
 * Situação atual: o corpus golden master (698 requisições dos endpoints portados) é reproduzido integralmente,
 * então NÃO há combinação (cst, cClassTrib) reprovada. Ficam catalogadas somente condições que o corpus não
 * cobre e que o port se recusa a calcular em vez de supor.
 */
export interface CombinacaoNaoValidada {
  /** Restringe a um CST (omitido = qualquer). */
  cst?: string;
  /** Restringe a um cClassTrib (omitido = qualquer). */
  cClassTrib?: string;
  /** Descrição da condição. */
  condicao: string;
  /** Predicado opcional sobre o item/operação de entrada oficial. */
  aplica?: (item: Record<string, unknown>, operacao: Record<string, unknown>) => boolean;
}

const temComponentes = (item: Record<string, unknown>) => {
  const g = item.gComponentesBC;
  return typeof g === "object" && g !== null && Object.values(g as Record<string, unknown>).some((v) => v !== null && v !== undefined);
};

export const COMBINACOES_NAO_VALIDADAS: readonly CombinacaoNaoValidada[] = [
  {
    condicao:
      "grupo gComponentesBC (base de cálculo por componentes: BaseCalculoUnificadaService) informado no item — não coberto pelo corpus",
    aplica: temComponentes,
  },
];
