import { buscarAtividade, listarAtividades } from "./atividades";
import { ErrosCalculoException } from "./errors";
import { lerOperacaoClassica, lerOperacaoNaoAssistida } from "./entrada";
import { problema422, type ContextoHttp } from "./http";
import type {
  ConsultaAtividades,
  RespostaAtividade,
  RespostaAtividades,
  RespostaObservabilidade,
} from "./official-types";
import { processarOperacaoClassica, processarOperacaoNaoAssistida } from "./operacao";

export interface OpcoesMotorLocal {
  /** Esquema+host que o serviço oficial deriva do Host da requisição (padrão `http://localhost`). */
  baseURL?: string;
  /** Context-path do serviço oficial (padrão `/api`), prefixo de `instance` nos erros. */
  contextPath?: string;
}

/**
 * Motor local do Simples Nacional: port fiel de `calculadora-rtc-simples-nacional` (RFB). Cada método
 * devolve exatamente o par (status HTTP, corpo JSON) do endpoint oficial equivalente.
 *
 * Entradas fora do que o desserializador oficial aceita lançam `MotorLocalNaoValidadoError`.
 * Dados: `src/data/rtc/*.json`, carregados sob demanda e cacheados (rota Node).
 */
export class SimplesNacionalLocalEngine {
  private readonly http: ContextoHttp;

  constructor(opcoes: OpcoesMotorLocal = {}) {
    this.http = { baseURL: opcoes.baseURL ?? "http://localhost", contextPath: opcoes.contextPath ?? "/api" };
  }

  /** `POST /calculadora/observabilidade/simples-nacional` (contrato clássico). */
  async observabilidadeClassica(corpo: unknown): Promise<RespostaObservabilidade> {
    const instance = `${this.http.contextPath}/calculadora/observabilidade/simples-nacional`;
    const op = lerOperacaoClassica(corpo);
    try {
      return { status: 200, body: await processarOperacaoClassica(op, this.http.baseURL) };
    } catch (e) {
      if (e instanceof ErrosCalculoException) return { status: 422, body: problema422(e.erros, instance) };
      throw e;
    }
  }

  /** `POST /calculadora/observabilidade/simples-nacional/nao-assistido`. */
  async observabilidadeNaoAssistida(corpo: unknown): Promise<RespostaObservabilidade> {
    const instance = `${this.http.contextPath}/calculadora/observabilidade/simples-nacional/nao-assistido`;
    const op = lerOperacaoNaoAssistida(corpo);
    try {
      return { status: 200, body: await processarOperacaoNaoAssistida(op, this.http.baseURL) };
    } catch (e) {
      if (e instanceof ErrosCalculoException) return { status: 422, body: problema422(e.erros, instance) };
      throw e;
    }
  }

  /** `GET /calculadora/simples-nacional/atividades`. */
  listarAtividades(consulta: ConsultaAtividades): Promise<RespostaAtividades> {
    return listarAtividades(consulta, this.http);
  }

  /** `GET /calculadora/simples-nacional/atividades/{codigo}`. */
  buscarAtividade(codigo: string, consulta: Omit<ConsultaAtividades, "anexos">): Promise<RespostaAtividade> {
    return buscarAtividade(codigo, consulta, this.http);
  }
}
