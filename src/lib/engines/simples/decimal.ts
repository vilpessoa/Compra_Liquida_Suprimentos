import Decimal from "decimal.js";

/**
 * Port de `shared/util/ArredondamentoUtils` (motor oficial): aritmética EXATA (BigDecimal), modo
 * HALF_EVEN, um arredondamento por número publicado. A precisão do decimal.js é alta o bastante para
 * que nenhuma soma/multiplicação do cálculo seja arredondada implicitamente (entradas têm no máximo
 * 3+34 dígitos; os produtos têm < 150 dígitos significativos).
 */
export const D = Decimal.clone({
  precision: 600,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -9e15,
  toExpPos: 9e15,
});
export type Dec = InstanceType<typeof D>;

export const ZERO: Dec = new D(0);
export const UM: Dec = new D(1);
const HALF_EVEN = D.ROUND_HALF_EVEN;

/** `BigDecimal.setScale(2, HALF_EVEN)` (valor fiscal, tipo 13v2). */
export function arredondarValorFiscal(v: Dec): Dec {
  return v.toDecimalPlaces(2, HALF_EVEN);
}

/** `BigDecimal.setScale(casas, HALF_EVEN)`; `casas` nulo = precisão integral. */
export function arredondarAliquota(v: Dec | null, casas: number | null): Dec | null {
  return v == null || casas == null ? v : v.toDecimalPlaces(casas, HALF_EVEN);
}

/** `ArredondamentoUtils.percentualParaFracao` (movePointLeft(2), exato). */
export function percentualParaFracao(p: Dec): Dec {
  return p.div(100);
}

/** `ArredondamentoUtils.totalizar` (soma exata). */
export function totalizar(valores: Dec[]): Dec {
  return valores.reduce((acc, v) => acc.plus(v), ZERO);
}

/** `ArredondamentoUtils.formatarMoeda`: exatamente 2 casas (TDec1302). */
export function formatarMoeda(v: Dec): string {
  return v.toDecimalPlaces(2, HALF_EVEN).toFixed(2);
}

/** `ArredondamentoUtils.formatarAliquota`: 4 casas HALF_EVEN, sem zeros à direita, mínimo 2 casas (TDec0302_04). */
export function formatarAliquota(v: Dec): string {
  const [i, f0 = ""] = v.toDecimalPlaces(4, HALF_EVEN).toFixed().split(".");
  return `${i}.${f0.padEnd(2, "0")}`;
}

function agrupar(inteiro: string): string {
  return inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** `DecimalFormat("#,##0.00")` pt-BR, HALF_EVEN (memória de cálculo). */
export function moedaPtBr(v: Dec | null): string {
  const [i, f] = (v ?? ZERO).toDecimalPlaces(2, HALF_EVEN).toFixed(2).split(".");
  return `${agrupar(i)},${f}`;
}

/** `DecimalFormat("#,##0.00##")` pt-BR, HALF_EVEN (memória de cálculo). */
export function percentualPtBr(v: Dec | null): string {
  const [i, f0 = ""] = (v ?? ZERO).toDecimalPlaces(4, HALF_EVEN).toFixed().split(".");
  return `${agrupar(i)},${f0.padEnd(2, "0")}`;
}

/**
 * Alíquota de entrada (pontos percentuais) com a grafia de `BigDecimal.toPlainString()`:
 * a escala do texto original é preservada ("1.10" continua "1.10") e zeros à esquerda somem.
 */
export interface AliquotaDecimal {
  d: Dec;
  plain: string;
}

export function aliquotaDeTexto(texto: string): AliquotaDecimal {
  return { d: new D(texto), plain: texto.replace(/^0+(?=\d)/, "") };
}

export const ALIQUOTA_ZERO: AliquotaDecimal = { d: ZERO, plain: "0" };
