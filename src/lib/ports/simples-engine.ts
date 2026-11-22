import type { Resultado } from "./common";
import type { DecimalString } from "./rtc-dto";

/** Entrada mínima do cálculo do Simples Nacional. Campos exatos definidos no WP4 a partir de
 *  OperacaoSimplesInput/ItemSimplesInput oficiais; nenhum campo pode ser presumido pela UI. */
export interface OperacaoSimplesInput {
  dhFatoGerador: string;
  municipio: number;
  uf: string;
  itens: Array<Record<string, unknown> & { numero: number; baseCalculo: DecimalString }>;
}

export interface ItemSimplesCalculado {
  numero: number;
  cbs: { pAliq: DecimalString; vTrib: DecimalString };
  ibsUf: { pAliq: DecimalString; vTrib: DecimalString };
  ibsMun: { pAliq: DecimalString; vTrib: DecimalString };
  memoriaCalculo?: string;
}

export interface SimplesEnginePort {
  readonly id: string;
  calcular(op: OperacaoSimplesInput): Promise<Array<Resultado<{ item: ItemSimplesCalculado }>>>;
}
