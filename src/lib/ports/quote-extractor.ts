/**
 * Extração estruturada de propostas comerciais.
 * REGRA: o extrator nunca infere valores. Campo ausente no texto => null.
 * Todo campo preenchido carrega o trecho literal de origem para conferência do comprador.
 */
export interface CampoExtraido<T> { valor: T | null; trecho: string | null }
export interface ItemPropostaExtraido {
  descricao: CampoExtraido<string>;
  ncm: CampoExtraido<string>;
  nbs: CampoExtraido<string>;
  quantidade: CampoExtraido<string>;
  unidade: CampoExtraido<string>;
  valorUnitario: CampoExtraido<string>;
}
export interface PropostaExtraida {
  fornecedor: CampoExtraido<string>;
  cnpj: CampoExtraido<string>;
  uf: CampoExtraido<string>;
  regimeTributario: CampoExtraido<"REGULAR" | "SIMPLES_NACIONAL">;
  itens: ItemPropostaExtraido[];
  avisos: string[];
}
export interface QuoteExtractorPort {
  readonly id: string;
  extrair(texto: string): Promise<PropostaExtraida>;
}
export interface FileTextExtractorPort {
  readonly id: string;
  suporta(mime: string, nome: string): boolean;
  extrairTexto(arquivo: { nome: string; mime: string; bytes: Uint8Array }): Promise<string>;
}
