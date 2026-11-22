import type { DanfseRendererPort } from "@/lib/ports/danfse-renderer";

/**
 * Renderer DANFSe que chama o serviço Go oficial da RFB (calculadora-rtc-gerador-danfse).
 *
 * Contrato (internal/controller/router.go, danfse.go, api/swagger/swagger.yaml):
 * - `POST {baseUrl}/api/danfse`
 * - Corpo: XML bruto da NFS-e, `Content-Type: application/xml`.
 * - Query: `canhoto=true|false` (padrão true), `stc=0|1|2` (padrão 0 = Válida).
 * - 200: `application/pdf` (bytes do PDF).
 * - Erro: JSON `{ sucesso: false, mensagem: string, content? }` (ex.: 400 com a mensagem do motor).
 */
export class HttpDanfseRenderer implements DanfseRendererPort {
  readonly id = "rfb-http";
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = (...args) => fetch(...args)) {
    const base = baseUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(base)) {
      throw new Error(`URL do serviço DANFSe inválida: "${baseUrl}"`);
    }
    this.endpoint = `${base}/api/danfse`;
    this.fetchImpl = fetchImpl;
  }

  async gerarPdf(xml: string, opcoes?: { canhoto?: boolean }): Promise<Uint8Array> {
    const canhoto = opcoes?.canhoto ?? true;
    const url = `${this.endpoint}?${new URLSearchParams({ canhoto: String(canhoto) })}`;

    const resposta = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/xml" },
      body: xml,
    });

    if (!resposta.ok) {
      throw new Error(await mensagemDeErro(resposta));
    }
    return new Uint8Array(await resposta.arrayBuffer());
  }
}

async function mensagemDeErro(resposta: Response): Promise<string> {
  const texto = await resposta.text().catch(() => "");
  try {
    const json = JSON.parse(texto) as { mensagem?: unknown };
    if (typeof json.mensagem === "string" && json.mensagem) return json.mensagem;
  } catch {
    // corpo não é JSON
  }
  return texto || `Serviço DANFSe respondeu HTTP ${resposta.status}`;
}
