import { SimplesNacionalLocalEngine, type OpcoesMotorLocal } from "@/lib/engines/simples/engine";
import type {
  ConsultaAtividades,
  OperacaoSimplesInput,
  OperacaoSimplesNaoAssistidaInput,
  RespostaAtividade,
  RespostaAtividades,
  RespostaObservabilidade,
} from "@/lib/engines/simples/official-types";
import type { SimplesEnginePort } from "@/lib/ports/simples-engine";

/**
 * Adapter do motor LOCAL (port TS do motor oficial). Roda em API Route Node (lê `src/data/rtc` sob demanda).
 * Lança `MotorLocalNaoValidadoError` quando não consegue garantir fidelidade ao motor oficial.
 */
export class LocalSimplesEngine implements SimplesEnginePort {
  readonly id = "local";
  private readonly motor: SimplesNacionalLocalEngine;

  constructor(opcoes?: OpcoesMotorLocal) {
    this.motor = new SimplesNacionalLocalEngine(opcoes);
  }

  calcularClassico(op: OperacaoSimplesInput): Promise<RespostaObservabilidade> {
    return this.motor.observabilidadeClassica(op);
  }

  calcularNaoAssistido(op: OperacaoSimplesNaoAssistidaInput): Promise<RespostaObservabilidade> {
    return this.motor.observabilidadeNaoAssistida(op);
  }

  listarAtividades(consulta: ConsultaAtividades): Promise<RespostaAtividades> {
    return this.motor.listarAtividades(consulta);
  }

  buscarAtividade(codigo: string, consulta: Omit<ConsultaAtividades, "anexos">): Promise<RespostaAtividade> {
    return this.motor.buscarAtividade(codigo, consulta);
  }
}
