/** Geração do DANFSe (PDF) a partir do XML da NFS-e, conforme NT 008 SE/CGNFSe. */
export interface DanfseRendererPort {
  readonly id: string;
  gerarPdf(xml: string, opcoes?: { canhoto?: boolean }): Promise<Uint8Array>;
}
