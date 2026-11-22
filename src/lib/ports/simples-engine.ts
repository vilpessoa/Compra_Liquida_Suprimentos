import type {
  ConsultaAtividades,
  OperacaoSimplesInput,
  OperacaoSimplesNaoAssistidaInput,
  RespostaAtividade,
  RespostaAtividades,
  RespostaObservabilidade,
} from "@/lib/engines/simples/official-types";

export type {
  AliquotasEfetivasInput,
  AtividadeSimplesDomain,
  ConsultaAtividades,
  ItemSimplesInput,
  ItemSimplesUnificadoInput,
  ObservabilidadeSimplesDomain,
  OperacaoSimplesInput,
  OperacaoSimplesNaoAssistidaInput,
  ProblemDetail,
  RespostaAtividade,
  RespostaAtividades,
  RespostaObservabilidade,
  SimplesHttpResponse,
} from "@/lib/engines/simples/official-types";

/**
 * Port do motor do Simples Nacional. Contrato = o do motor oficial da RFB
 * (`ReceitaFederal/calculadora-rtc-simples-nacional`): recebe a ENTRADA OFICIAL e devolve a RESPOSTA OFICIAL
 * (corpo JSON idêntico + status HTTP). Nenhum campo é presumido pela UI.
 *
 * Decisão de produto (ADR-005): a base oficial não tem Anexos I–V/faixas/Fator R; o comprador informa as
 * alíquotas efetivas de CBS/IBS declaradas pelo fornecedor (`aliquotasEfetivas`). Sem elas o motor oficial
 * devolve VSN-039 (422), exceto no regime SOMENTE_RECEITA — e o motor local reproduz isso.
 *
 * Implementações: `local` (port TS fiel, `MotorLocalNaoValidadoError` quando não garante fidelidade) e
 * `rfb-http` (repasse 1:1 ao serviço oficial). Seleção em `createSimplesEngine()` (SIMPLES_ENGINE).
 */
export interface SimplesEnginePort {
  readonly id: string;

  /** `POST /calculadora/observabilidade/simples-nacional` (contrato clássico, alíquotas por item). */
  calcularClassico(op: OperacaoSimplesInput): Promise<RespostaObservabilidade>;

  /** `POST /calculadora/observabilidade/simples-nacional/nao-assistido` (linha `aliquotasEfetivas`). */
  calcularNaoAssistido(op: OperacaoSimplesNaoAssistidaInput): Promise<RespostaObservabilidade>;

  /** `GET /calculadora/simples-nacional/atividades`. */
  listarAtividades(consulta: ConsultaAtividades): Promise<RespostaAtividades>;

  /** `GET /calculadora/simples-nacional/atividades/{codigo}` (404 => corpo `""`). */
  buscarAtividade(codigo: string, consulta: Omit<ConsultaAtividades, "anexos">): Promise<RespostaAtividade>;
}
