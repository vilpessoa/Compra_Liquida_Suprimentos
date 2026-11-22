import type { Indeterminado } from "@/lib/ports/common";
import type { NfeConsultaPort } from "@/lib/ports/nfe-consulta";
import { normalizarChaveAcesso, TAMANHO_CHAVE_ACESSO } from "@/lib/nfe/chave-acesso";

/**
 * Consulta genérica de XML de NF-e por chave, via API REST de um provedor.
 *
 * CONTRATO ESPERADO DO PROVEDOR (documentado aqui, não validado além do descrito):
 *   Requisição:  GET {baseUrl}{caminho}, com {caminho} = "/nfe/{chave}" por padrão.
 *                Cabeçalho: "<cabecalhoAuth>: <prefixoAuth><apiKey>"
 *                (padrão: "Authorization: Bearer <NFE_API_KEY>").
 *                Accept: application/xml, text/xml.
 *   Resposta 200: corpo = XML da NF-e (raiz nfeProc ou NFe), Content-Type application/xml ou
 *                 text/xml. O corpo é devolvido como texto, sem parse.
 *   404 -> NFE_NAO_ENCONTRADA
 *   401/403 -> CONSULTA_NAO_AUTORIZADA
 *   Outro status, falha de rede ou timeout -> CONSULTA_FALHOU / CONSULTA_INDISPONIVEL
 *   200 sem corpo XML -> RESPOSTA_INVALIDA
 *
 * A chave é validada no formato (44 dígitos) antes da requisição. O DV não é verificado aqui.
 */
export interface GenericRestOpcoes {
  /** Base da API, ex.: a variável NFE_API_URL. */
  baseUrl: string;
  /** Chave da API, ex.: a variável NFE_API_KEY. Nunca é escrita em mensagens de erro. */
  apiKey: string;
  /** Template do caminho; {chave} é substituído pela chave de 44 dígitos. Padrão: "/nfe/{chave}". */
  caminho?: string;
  /** Nome do cabeçalho de autenticação. Padrão: "Authorization". */
  cabecalhoAuth?: string;
  /** Prefixo antes da chave, incluindo o espaço. Padrão: "Bearer ". */
  prefixoAuth?: string;
  /** Tempo máximo da requisição em ms. Padrão: 15000. */
  timeoutMs?: number;
  /** Injeção de fetch (testes). Padrão: fetch global. */
  fetchImpl?: typeof fetch;
  /** Identificação do adapter. Padrão: "nfe-consulta-rest". */
  id?: string;
}

const CAMINHO_PADRAO = "/nfe/{chave}";

export class GenericRestNfeConsulta implements NfeConsultaPort {
  readonly id: string;
  private readonly base: string;
  private readonly apiKey: string;
  private readonly caminho: string;
  private readonly cabecalhoAuth: string;
  private readonly prefixoAuth: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opcoes: GenericRestOpcoes) {
    this.id = opcoes.id ?? "nfe-consulta-rest";
    this.base = opcoes.baseUrl.replace(/\/+$/, "");
    this.apiKey = opcoes.apiKey;
    this.caminho = opcoes.caminho ?? CAMINHO_PADRAO;
    this.cabecalhoAuth = opcoes.cabecalhoAuth ?? "Authorization";
    this.prefixoAuth = opcoes.prefixoAuth ?? "Bearer ";
    this.timeoutMs = opcoes.timeoutMs ?? 15000;
    this.fetchImpl = opcoes.fetchImpl ?? fetch;
  }

  configurado(): boolean {
    return true;
  }

  async consultarXml(chaveEntrada: string): Promise<{ status: "OK"; xml: string } | Indeterminado> {
    const chave = normalizarChaveAcesso(chaveEntrada);
    if (chave.length !== TAMANHO_CHAVE_ACESSO) {
      return indeterminado("CHAVE_INVALIDA", `Chave de acesso deve ter ${TAMANHO_CHAVE_ACESSO} dígitos.`);
    }

    const url = this.base + this.caminho.replace("{chave}", chave);
    let resp: Response;
    try {
      resp = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/xml, text/xml",
          [this.cabecalhoAuth]: `${this.prefixoAuth}${this.apiKey}`,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return indeterminado(
        "CONSULTA_INDISPONIVEL",
        "Não foi possível consultar o provedor de NF-e (rede ou tempo esgotado).",
        "Tentar novamente mais tarde ou anexar o XML manualmente.",
      );
    }

    if (resp.status === 404) {
      return indeterminado("NFE_NAO_ENCONTRADA", "O provedor não encontrou a NF-e para esta chave.");
    }
    if (resp.status === 401 || resp.status === 403) {
      return indeterminado(
        "CONSULTA_NAO_AUTORIZADA",
        `O provedor recusou a consulta (HTTP ${resp.status}).`,
        "Verificar NFE_API_KEY.",
      );
    }
    if (!resp.ok) {
      return indeterminado("CONSULTA_FALHOU", `O provedor respondeu HTTP ${resp.status}.`);
    }

    const corpo = await resp.text();
    if (!corpo.trimStart().startsWith("<")) {
      return indeterminado("RESPOSTA_INVALIDA", "A resposta do provedor não contém XML.");
    }
    return { status: "OK", xml: corpo };
  }
}

function indeterminado(codigo: string, mensagem: string, acao?: string): Indeterminado {
  return { status: "INDETERMINADO", codigo, mensagem, ...(acao ? { acao } : {}) };
}
