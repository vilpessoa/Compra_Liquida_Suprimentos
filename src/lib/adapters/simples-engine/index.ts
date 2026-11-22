import { envChoice } from "@/lib/adapters/registry";
import type { SimplesEnginePort } from "@/lib/ports/simples-engine";
import { LocalSimplesEngine } from "./local-simples-engine";
import { RfbHttpSimplesEngine } from "./rfb-http-simples-engine";

export { LocalSimplesEngine } from "./local-simples-engine";
export { RfbHttpSimplesEngine } from "./rfb-http-simples-engine";

export type SimplesEngineKind = "local" | "rfb-http";

/**
 * Escolhe o motor do Simples Nacional por variáveis de ambiente (somente servidor, rota Node):
 * - `SIMPLES_ENGINE`: "local" (padrão) | "rfb-http"
 * - `RTC_SIMPLES_API_URL`: obrigatória para "rfb-http" (ex.: http://simples.interno:8082/api)
 */
export function createSimplesEngine(): SimplesEnginePort {
  const escolha = envChoice<SimplesEngineKind>("SIMPLES_ENGINE", ["local", "rfb-http"], "local");
  if (escolha === "local") return new LocalSimplesEngine();

  const apiUrl = process.env.RTC_SIMPLES_API_URL;
  if (!apiUrl) {
    throw new Error("RTC_SIMPLES_API_URL é obrigatória quando SIMPLES_ENGINE=rfb-http.");
  }
  return new RfbHttpSimplesEngine(apiUrl);
}
