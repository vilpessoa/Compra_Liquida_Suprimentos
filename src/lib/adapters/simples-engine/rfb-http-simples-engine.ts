import type {
  ConsultaAtividades,
  OperacaoSimplesInput,
  OperacaoSimplesNaoAssistidaInput,
  RespostaAtividade,
  RespostaAtividades,
  RespostaObservabilidade,
  SimplesHttpResponse,
} from "@/lib/engines/simples/official-types";
import type { SimplesEnginePort } from "@/lib/ports/simples-engine";

/**
 * Adapter que repassa 1:1 ao serviço OFICIAL da RFB (`calculadora-rtc-simples-nacional`, Spring Boot).
 * `RTC_SIMPLES_API_URL` inclui o context-path, ex.: `http://localhost:8082/api` (ver conformance/README.md).
 * Status HTTP e corpo JSON são devolvidos tal como vieram (inclusive 400/404/422); corpo vazio => `""`.
 * Falha de rede propaga como exceção (nunca vira resultado "aproximado").
 */
export class RfbHttpSimplesEngine implements SimplesEnginePort {
  readonly id = "rfb-http";
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = (...args) => fetch(...args)) {
    const base = baseUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(base)) {
      throw new Error(`URL do serviço do Simples Nacional inválida: "${baseUrl}"`);
    }
    this.base = base;
    this.fetchImpl = fetchImpl;
  }

  calcularClassico(op: OperacaoSimplesInput): Promise<RespostaObservabilidade> {
    return this.post("/calculadora/observabilidade/simples-nacional", op);
  }

  calcularNaoAssistido(op: OperacaoSimplesNaoAssistidaInput): Promise<RespostaObservabilidade> {
    return this.post("/calculadora/observabilidade/simples-nacional/nao-assistido", op);
  }

  listarAtividades(consulta: ConsultaAtividades): Promise<RespostaAtividades> {
    return this.get("/calculadora/simples-nacional/atividades", consulta) as Promise<RespostaAtividades>;
  }

  buscarAtividade(codigo: string, consulta: Omit<ConsultaAtividades, "anexos">): Promise<RespostaAtividade> {
    return this.get(
      `/calculadora/simples-nacional/atividades/${encodeURIComponent(codigo)}`,
      consulta,
    ) as Promise<RespostaAtividade>;
  }

  private async post(caminho: string, corpo: unknown): Promise<RespostaObservabilidade> {
    const resposta = await this.fetchImpl(`${this.base}${caminho}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(corpo),
    });
    return (await converter(resposta)) as RespostaObservabilidade;
  }

  private async get(caminho: string, consulta: ConsultaAtividades): Promise<SimplesHttpResponse<unknown>> {
    const q = new URLSearchParams();
    if (consulta.data != null) q.set("data", consulta.data);
    for (const a of consulta.anexos ?? []) q.append("anexos", a);
    if (consulta.tpDoc != null) q.set("tpDoc", consulta.tpDoc);
    if (consulta.cClassTrib != null) q.set("cClassTrib", consulta.cClassTrib);
    const qs = q.toString();
    const resposta = await this.fetchImpl(`${this.base}${caminho}${qs ? `?${qs}` : ""}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    return converter(resposta);
  }
}

async function converter(resposta: Response): Promise<SimplesHttpResponse<unknown>> {
  const texto = await resposta.text();
  let body: unknown = "";
  if (texto.length > 0) {
    try {
      body = JSON.parse(texto);
    } catch {
      throw new Error(`Serviço do Simples Nacional respondeu HTTP ${resposta.status} com corpo não JSON.`);
    }
  }
  const headers: Record<string, string> = {};
  resposta.headers.forEach((valor, nome) => {
    if (nome.toLowerCase().startsWith("x-calc-")) headers[nome.toUpperCase()] = valor;
  });
  return { status: resposta.status, body, ...(Object.keys(headers).length ? { headers } : {}) };
}
