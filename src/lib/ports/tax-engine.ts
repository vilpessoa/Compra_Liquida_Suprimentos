import type { Resultado } from "./common";
import type { ItemCalculado, OperacaoInput } from "./rtc-dto";

/** Motor de cálculo CBS/IBS/IS do regime regular. */
export interface TaxEnginePort {
  readonly id: string;
  calcular(operacao: OperacaoInput): Promise<Array<Resultado<{ item: ItemCalculado }>>>;
}
