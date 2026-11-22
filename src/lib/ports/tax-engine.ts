/**
 * Port do motor de cálculo CBS/IBS/IS do regime regular.
 *
 * ALTERAÇÃO (WP3): o contrato anterior (`calcular(): Promise<Array<Resultado<{ item: ItemCalculado }>>>`, DTO
 * simplificado) foi substituído pelo contrato OFICIAL da API da RFB: o port recebe o `OperacaoInput` oficial e
 * devolve o `RtcHttpResponse` (corpo JSON idêntico ao da API + status HTTP + headers `x-calc-*` e
 * `x-warning-dados-simulados`). O adapter HTTP é um repasse 1:1; o adapter local reproduz o motor oficial.
 *
 * Erros de negócio (422/404/400) NÃO são exceções: voltam na resposta, como na API. Exceções ficam para falhas de
 * transporte e para `MotorLocalNaoValidadoError` (o motor local recusa combinações não validadas contra o corpus
 * oficial; a camada superior deve bloquear a decisão ou encaminhar ao adapter `rfb-http`).
 */
import type { OperacaoInput, RtcHttpResponse } from "./rtc-dto";

export interface TaxEngineCallOptions {
  /**
   * `scheme://host` usado nas URLs `type` dos erros (o motor oficial deriva do Host da requisição).
   * Só afeta o adapter local; o padrão é `http://localhost`.
   */
  baseUrl?: string;
}

export interface TaxEnginePort {
  /** Identificador do adapter: "local-rtc" | "rfb-http". */
  readonly id: string;
  /** POST /calculadora/observabilidade/regime-geral (prioritário: erros por item, HTTP 200). */
  calcularObservabilidade(operacao: OperacaoInput, opts?: TaxEngineCallOptions): Promise<RtcHttpResponse>;
  /** POST /calculadora/regime-geral (primeiro erro falha a requisição inteira). */
  calcularRegimeGeral(operacao: OperacaoInput, opts?: TaxEngineCallOptions): Promise<RtcHttpResponse>;
}
