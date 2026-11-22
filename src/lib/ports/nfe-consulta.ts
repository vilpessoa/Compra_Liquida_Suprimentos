import type { Indeterminado } from "./common";
/** Consulta de NF-e por chave de acesso em serviço externo (SEFAZ/provedor). */
export interface NfeConsultaPort {
  readonly id: string;
  configurado(): boolean;
  consultarXml(chave: string): Promise<{ status: "OK"; xml: string } | Indeterminado>;
}
