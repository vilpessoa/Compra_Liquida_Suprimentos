/**
 * Motor local do regime regular (port TypeScript do motor oficial da RFB).
 * Ver official-types.ts (contratos), engine.ts (endpoints), data.ts (dados oficiais, carga lazy).
 */
import { loadRtcData, RtcRepos } from "./data";

export * from "./official-types";
export { processarObservabilidade, calcularRegimeGeral, RTC_APP_VERSION } from "./engine";
export type { EngineOptions } from "./engine";
export { MotorLocalNaoValidadoError, RtcException } from "./errors";
export { loadRtcData, RtcRepos } from "./data";
export { COMBINACOES_NAO_VALIDADAS } from "./unsupported";

let repos: Promise<RtcRepos> | null = null;
/** Repositório de consultas sobre o snapshot oficial (carregado uma vez por processo). */
export function getRtcRepos(): Promise<RtcRepos> {
  if (!repos) repos = loadRtcData().then((d) => new RtcRepos(d));
  return repos;
}
