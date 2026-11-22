import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { WasmDanfseRenderer, type DanfseWasmLoader } from "./wasm-danfse-renderer";

/**
 * Verificação do motor oficial DANFSe (WASM) em Node, usando os artefatos reais de public/wasm/
 * e NFS-e oficiais de teste em __fixtures__/.
 */

const WASM_DIR = fileURLToPath(new URL("../../../../public/wasm/", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./__fixtures__/", import.meta.url));

/** Loader de Node: avalia o wasm_exec.js oficial e instancia o .wasm do disco. */
const loaderNode: DanfseWasmLoader = {
  async carregarWasmExec() {
    if ((globalThis as { Go?: unknown }).Go) return;
    const codigo = await readFile(`${WASM_DIR}wasm_exec.js`, "utf8");
    vm.runInThisContext(codigo, { filename: "wasm_exec.js" });
  },
  async instanciar(importObject) {
    const bytes = await readFile(`${WASM_DIR}danfse.wasm`);
    const { instance } = await WebAssembly.instantiate(bytes, importObject);
    return instance;
  },
};

const renderer = new WasmDanfseRenderer(loaderNode);

async function lerFixture(nome: string): Promise<string> {
  return readFile(`${FIXTURES}${nome}`, "utf8");
}

describe("WasmDanfseRenderer (motor oficial RFB em WASM, Node)", () => {
  it("gera PDF a partir da NFS-e sem IBSCBS (oficial)", async () => {
    const xml = await lerFixture("nfse_valido_sem_IBSCBS.xml");
    const pdf = await renderer.gerarPdf(xml);

    expect(pdf).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(pdf.subarray(0, 5)).toString("ascii")).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  }, 60_000);

  it("gera PDF a partir da NFS-e com IBSCBS (oficial)", async () => {
    const xml = await lerFixture("nfse_valido_com_IBSCBS.xml");
    const pdf = await renderer.gerarPdf(xml, { canhoto: false });

    expect(Buffer.from(pdf.subarray(0, 5)).toString("ascii")).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  }, 60_000);

  it("propaga a mensagem original do WASM quando o XML é inválido", async () => {
    await expect(renderer.gerarPdf("<NFSe")).rejects.toThrow(/\S/);
  }, 60_000);
});
