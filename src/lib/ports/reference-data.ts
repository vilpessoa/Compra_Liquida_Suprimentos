import type { Proveniencia } from "./common";

export interface NcmNbs { codigo: string; descricao: string; tipo: "NCM" | "NBS"; inicioVigencia?: string; fimVigencia?: string }
export interface ClassificacaoTributaria {
  cClassTrib: string; cst: string; descricao: string;
  pRedCBS?: string; pRedIBS?: string;
  fundamentacaoLegal?: string[];
  inicioVigencia?: string; fimVigencia?: string;
}

/** Consulta às tabelas oficiais (NCM, NBS, cClassTrib, fundamentações). */
export interface ReferenceDataPort {
  readonly id: string;
  proveniencia(): Proveniencia;
  buscarNcmNbs(termo: string, data: string, limite?: number): Promise<NcmNbs[]>;
  obterNcmNbs(codigo: string, data: string): Promise<NcmNbs | null>;
  /** cClassTrib vigentes vinculadas ao NCM/NBS na data. Lista vazia = bloqueio na UI. */
  classificacoesPorNcmNbs(codigo: string, data: string): Promise<ClassificacaoTributaria[]>;
}
