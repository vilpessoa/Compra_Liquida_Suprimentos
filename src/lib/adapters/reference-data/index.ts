import type { ReferenceDataPort } from "@/lib/ports/reference-data";
import { envChoice } from "../env";
import { RfbHttpReferenceData } from "./rfb-http-reference-data";
import { SnapshotReferenceData } from "./snapshot-reference-data";

export { SnapshotReferenceData } from "./snapshot-reference-data";
export { RfbHttpReferenceData, ReferenceDataRfbHttpNaoImplementadoError } from "./rfb-http-reference-data";

export type ReferenceDataKind = "snapshot" | "rfb-http";

/**
 * REFERENCE_DATA: "snapshot" (padrão; tabelas oficiais em src/data/rtc) | "rfb-http" (stub; exige RTC_API_URL).
 */
export function createReferenceData(): ReferenceDataPort {
  const escolha = envChoice<ReferenceDataKind>("REFERENCE_DATA", ["snapshot", "rfb-http"], "snapshot");
  if (escolha === "snapshot") return new SnapshotReferenceData();
  const apiUrl = process.env.RTC_API_URL;
  if (!apiUrl) throw new Error("RTC_API_URL é obrigatória quando REFERENCE_DATA=rfb-http (ex.: http://localhost:8080/api).");
  return new RfbHttpReferenceData(apiUrl);
}
