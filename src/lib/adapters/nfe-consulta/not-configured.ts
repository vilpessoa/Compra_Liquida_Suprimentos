import type { Indeterminado } from "@/lib/ports/common";
import type { NfeConsultaPort } from "@/lib/ports/nfe-consulta";

/** Adapter padrão quando NFE_API_URL / NFE_API_KEY não estão definidas. Nunca consulta nada. */
export class NotConfiguredNfeConsulta implements NfeConsultaPort {
  readonly id = "nfe-consulta-nao-configurada";

  configurado(): boolean {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async consultarXml(_chave: string): Promise<{ status: "OK"; xml: string } | Indeterminado> {
    return {
      status: "INDETERMINADO",
      codigo: "CONSULTA_NAO_CONFIGURADA",
      mensagem:
        "Consulta de NF-e não configurada. Defina as variáveis de ambiente NFE_API_URL e NFE_API_KEY para consultar o XML pela chave de acesso.",
      acao: "Configurar NFE_API_URL e NFE_API_KEY no servidor, ou anexar o XML da NF-e manualmente.",
    };
  }
}
