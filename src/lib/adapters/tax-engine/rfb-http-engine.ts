import type { TaxEnginePort } from "@/lib/ports/tax-engine";
import type { OperacaoInput, RtcHttpResponse, RtcResponseBody, RtcResponseHeaders } from "@/lib/ports/rtc-dto";

const HEADERS_RELEVANTES = ["x-calc-app-version", "x-calc-db-version", "x-warning-dados-simulados"] as const;

/**
 * Adapter do motor OFICIAL da RFB hospedado em HTTP (repasse 1:1).
 *
 * `baseUrl` é o `RTC_API_URL` incluindo o context-path da API (ex.: `http://localhost:8080/api`, como nos
 * application-*.yml oficiais). Chamadas:
 *   POST `${RTC_API_URL}/calculadora/observabilidade/regime-geral`  (calcularObservabilidade)
 *   POST `${RTC_API_URL}/calculadora/regime-geral`                  (calcularRegimeGeral)
 * A resposta é devolvida como veio: status HTTP, corpo JSON (200, 400, 404 ou 422) e headers x-calc-* /
 * x-warning-dados-simulados. Apenas falhas de transporte/corpo não-JSON viram exceção.
 */
export class RfbRtcHttpEngine implements TaxEnginePort {
  readonly id = "rfb-http";
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly opcoes: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  calcularObservabilidade(operacao: OperacaoInput): Promise<RtcHttpResponse> {
    return this.post("/calculadora/observabilidade/regime-geral", operacao);
  }

  calcularRegimeGeral(operacao: OperacaoInput): Promise<RtcHttpResponse> {
    return this.post("/calculadora/regime-geral", operacao);
  }

  private async post(caminho: string, operacao: OperacaoInput): Promise<RtcHttpResponse> {
    const fetchImpl = this.opcoes.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opcoes.timeoutMs ?? 30_000);
    try {
      const resp = await fetchImpl(`${this.baseUrl}${caminho}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(operacao),
        signal: controller.signal,
      });
      const texto = await resp.text();
      let body: RtcResponseBody;
      try {
        body = JSON.parse(texto) as RtcResponseBody;
      } catch {
        throw new Error(`Resposta não-JSON do motor RTC (HTTP ${resp.status}): ${texto.slice(0, 200)}`);
      }
      const headers: RtcResponseHeaders = {};
      for (const h of HEADERS_RELEVANTES) {
        const v = resp.headers.get(h);
        if (v !== null) headers[h] = v;
      }
      return { status: resp.status, body, headers };
    } finally {
      clearTimeout(timer);
    }
  }
}
