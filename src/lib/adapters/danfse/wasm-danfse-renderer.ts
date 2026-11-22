import type { DanfseRendererPort } from "@/lib/ports/danfse-renderer";

/**
 * Renderer DANFSe que roda o motor oficial RFB (Go -> WebAssembly) no navegador.
 *
 * Contrato do WASM (cmd/danfse-wasm/main.go, fonte oficial):
 * - Global `danfseWasm = { ready: boolean, error: string, gerarPdf(jsonString) }`.
 *   `ready === true` quando inicializado; `ready === false` com `error` preenchido em falha.
 * - `gerarPdf` recebe UMA string JSON `{"xml": string, "stc": number, "canhoto": boolean}`
 *   (`stc`: 0=Válida, 1=Substituída, 2=Cancelada; `canhoto` ausente = true).
 * - Retorna um objeto JS: sucesso `{ pdf: string (base64), size: number }`,
 *   falha `{ error: string }`.
 *
 * Só deve ser importado no cliente (o WASM e o wasm_exec.js vivem em /wasm/).
 * A classe não depende de DOM diretamente: o carregamento fica no `DanfseWasmLoader`,
 * o que permite rodar o mesmo código no Node em testes.
 */

/** Formato de resposta de `gerarPdf` conforme main.go. */
interface RespostaGerarPdf {
  pdf?: string;
  size?: number;
  error?: string;
}

/** Forma do global `danfseWasm` exposto pelo main.go. */
interface DanfseWasmGlobal {
  ready?: boolean;
  error?: string;
  gerarPdf?: (jsonString: string) => RespostaGerarPdf;
}

/** Runtime `Go` definido pelo wasm_exec.js. */
interface GoRuntime {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}

/** Abstrai como o wasm_exec.js e o .wasm são carregados (navegador ou Node). */
export interface DanfseWasmLoader {
  /** Garante que `globalThis.Go` esteja definido (wasm_exec.js carregado). */
  carregarWasmExec(): Promise<void>;
  /** Instancia o módulo `danfse.wasm` com o importObject do Go. */
  instanciar(importObject: WebAssembly.Imports): Promise<WebAssembly.Instance>;
}

export const WASM_EXEC_URL = "/wasm/wasm_exec.js";
export const DANFSE_WASM_URL = "/wasm/danfse.wasm";

const TIMEOUT_INICIALIZACAO_MS = 30_000;

/** Loader de navegador: script tag + instantiateStreaming (fallback arrayBuffer). */
export function criarLoaderNavegador(
  urls: { wasmExec?: string; wasm?: string } = {},
): DanfseWasmLoader {
  const wasmExecUrl = urls.wasmExec ?? WASM_EXEC_URL;
  const wasmUrl = urls.wasm ?? DANFSE_WASM_URL;
  let scriptCarregado: Promise<void> | undefined;

  return {
    carregarWasmExec() {
      if (typeof window === "undefined") {
        return Promise.reject(new Error("DANFSe WASM só pode ser carregado no navegador."));
      }
      if ((globalThis as { Go?: unknown }).Go) return Promise.resolve();
      scriptCarregado ??= new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = wasmExecUrl;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => {
          scriptCarregado = undefined;
          reject(new Error(`Falha ao carregar ${wasmExecUrl}`));
        };
        document.head.appendChild(script);
      });
      return scriptCarregado;
    },

    async instanciar(importObject) {
      const resposta = await fetch(wasmUrl);
      if (!resposta.ok) {
        throw new Error(`Falha ao carregar ${wasmUrl} (HTTP ${resposta.status})`);
      }
      try {
        const { instance } = await WebAssembly.instantiateStreaming(resposta.clone(), importObject);
        return instance;
      } catch {
        // Ex.: servidor sem Content-Type application/wasm.
        const bytes = await resposta.arrayBuffer();
        const { instance } = await WebAssembly.instantiate(bytes, importObject);
        return instance;
      }
    },
  };
}

// Runtime Go é único por página: o main.go registra globais e nunca retorna.
let runtimeCarregado: Promise<DanfseWasmGlobal> | undefined;

function esperarDanfseWasm(): Promise<DanfseWasmGlobal> {
  return new Promise((resolve, reject) => {
    const inicio = Date.now();
    const verificar = () => {
      const w = (globalThis as { danfseWasm?: DanfseWasmGlobal }).danfseWasm;
      if (w?.ready === true && typeof w.gerarPdf === "function") {
        resolve(w);
        return;
      }
      if (w?.ready === false) {
        reject(new Error(w.error || "DANFSe WASM não inicializou."));
        return;
      }
      if (Date.now() - inicio > TIMEOUT_INICIALIZACAO_MS) {
        reject(new Error("Tempo esgotado aguardando o DANFSe WASM inicializar."));
        return;
      }
      setTimeout(verificar, 10);
    };
    verificar();
  });
}

async function carregarRuntime(loader: DanfseWasmLoader): Promise<DanfseWasmGlobal> {
  await loader.carregarWasmExec();
  const Go = (globalThis as { Go?: new () => GoRuntime }).Go;
  if (!Go) throw new Error("wasm_exec.js carregado, mas `Go` não está definido.");

  const go = new Go();
  const instance = await loader.instanciar(go.importObject);
  // go.run não resolve enquanto o programa Go estiver vivo (main faz select{}).
  go.run(instance).catch((err: unknown) => {
    runtimeCarregado = undefined;
    console.error("DANFSe WASM encerrou inesperadamente:", err);
  });
  return esperarDanfseWasm();
}

function base64ParaBytes(base64: string): Uint8Array {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

export class WasmDanfseRenderer implements DanfseRendererPort {
  readonly id = "rfb-wasm";
  private readonly loader: DanfseWasmLoader;

  constructor(loader: DanfseWasmLoader = criarLoaderNavegador()) {
    this.loader = loader;
  }

  private obterRuntime(): Promise<DanfseWasmGlobal> {
    runtimeCarregado ??= carregarRuntime(this.loader).catch((err: unknown) => {
      runtimeCarregado = undefined; // permite nova tentativa
      throw err;
    });
    return runtimeCarregado;
  }

  async gerarPdf(xml: string, opcoes?: { canhoto?: boolean }): Promise<Uint8Array> {
    const runtime = await this.obterRuntime();
    // stc omitido aqui = 0 (Válida), o padrão da porta.
    const requisicao = JSON.stringify({ xml, stc: 0, canhoto: opcoes?.canhoto ?? true });
    const resposta = runtime.gerarPdf!(requisicao);

    if (resposta.error) throw new Error(resposta.error);
    if (!resposta.pdf) throw new Error("DANFSe WASM não retornou PDF.");
    return base64ParaBytes(resposta.pdf);
  }
}
