import type { DanfseRendererPort } from "@/lib/ports/danfse-renderer";
import { WasmDanfseRenderer } from "./wasm-danfse-renderer";
import { HttpDanfseRenderer } from "./http-danfse-renderer";

export { WasmDanfseRenderer } from "./wasm-danfse-renderer";
export { HttpDanfseRenderer } from "./http-danfse-renderer";

export type DanfseRendererKind = "wasm" | "rfb-http";

/**
 * Escolhe o renderer DANFSe por variáveis de ambiente públicas:
 * - NEXT_PUBLIC_DANFSE_RENDERER: "wasm" (padrão) | "rfb-http"
 * - NEXT_PUBLIC_DANFSE_API_URL: obrigatória para "rfb-http" (ex.: http://danfse.interno:8080)
 *
 * Os nomes são acessados literalmente para que o Next.js os injete no bundle do cliente.
 */
export function createDanfseRenderer(): DanfseRendererPort {
  const escolha = process.env.NEXT_PUBLIC_DANFSE_RENDERER || "wasm";

  if (escolha === "wasm") return new WasmDanfseRenderer();

  if (escolha === "rfb-http") {
    const apiUrl = process.env.NEXT_PUBLIC_DANFSE_API_URL;
    if (!apiUrl) {
      throw new Error("NEXT_PUBLIC_DANFSE_API_URL é obrigatória quando NEXT_PUBLIC_DANFSE_RENDERER=rfb-http.");
    }
    return new HttpDanfseRenderer(apiUrl);
  }

  throw new Error(
    `Valor inválido para NEXT_PUBLIC_DANFSE_RENDERER: "${escolha}". Permitidos: wasm, rfb-http.`,
  );
}
