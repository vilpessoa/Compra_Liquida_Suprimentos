import type { TaxEnginePort } from "@/lib/ports/tax-engine";
import { envChoice } from "../env";
import { LocalRtcEngine } from "./local-rtc-engine";
import { RfbRtcHttpEngine } from "./rfb-http-engine";

export { LocalRtcEngine } from "./local-rtc-engine";
export { RfbRtcHttpEngine } from "./rfb-http-engine";
export { MotorLocalNaoValidadoError } from "@/lib/engines/rtc/errors";

export type TaxEngineKind = "local" | "rfb-http";

/**
 * Escolhe o motor do regime regular por variáveis de ambiente (somente servidor):
 *  - TAX_ENGINE: "local" (padrão) | "rfb-http"
 *  - RTC_API_URL: obrigatória para "rfb-http" (ex.: http://rtc.interno:8080/api — com o context-path da API oficial)
 */
export function createTaxEngine(): TaxEnginePort {
  const escolha = envChoice<TaxEngineKind>("TAX_ENGINE", ["local", "rfb-http"], "local");
  if (escolha === "local") return new LocalRtcEngine();
  const apiUrl = process.env.RTC_API_URL;
  if (!apiUrl) throw new Error("RTC_API_URL é obrigatória quando TAX_ENGINE=rfb-http (ex.: http://localhost:8080/api).");
  return new RfbRtcHttpEngine(apiUrl);
}
