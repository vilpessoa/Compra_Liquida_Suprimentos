import type { NfeConsultaPort } from "@/lib/ports/nfe-consulta";
import { GenericRestNfeConsulta } from "./generic-rest";
import { NotConfiguredNfeConsulta } from "./not-configured";

export { GenericRestNfeConsulta, type GenericRestOpcoes } from "./generic-rest";
export { NotConfiguredNfeConsulta } from "./not-configured";

/**
 * Escolhe o adapter pelas variáveis de ambiente:
 *   NFE_API_URL e NFE_API_KEY definidas  -> GenericRestNfeConsulta
 *   caso contrário                        -> NotConfiguredNfeConsulta
 * URL inválida lança erro (falha rápida na inicialização).
 */
export function createNfeConsulta(
  env: Partial<Record<string, string | undefined>> = process.env,
): NfeConsultaPort {
  const url = env.NFE_API_URL?.trim();
  const chave = env.NFE_API_KEY?.trim();
  if (!url || !chave) return new NotConfiguredNfeConsulta();
  try {
    new URL(url);
  } catch {
    throw new Error("NFE_API_URL inválida: informe uma URL absoluta (ex.: https://provedor.exemplo).");
  }
  return new GenericRestNfeConsulta({ baseUrl: url, apiKey: chave });
}
