/**
 * Aritmética decimal com a mesma semântica de java.math.BigDecimal usada pelo motor oficial.
 *
 * Política numérica oficial (shared/util/ArredondamentoUtils.java, idêntica nas duas APIs):
 *  - soma, subtração, multiplicação e conversões percentual<->fração são EXATAS (aqui: precisão de 1000
 *    dígitos significativos, muito acima de qualquer produto possível nas entradas oficiais: <= 17 dígitos);
 *  - divisão usa MathContext(34 dígitos significativos, HALF_EVEN)  [ArredondamentoUtils.CONTEXTO_DIVISAO];
 *  - valor fiscal: setScale(2, HALF_EVEN); alíquota publicada: setScale(4, HALF_EVEN)  [MODO = HALF_EVEN].
 */
import Decimal from "decimal.js";

/** Decimal "exato" (ROUND_HALF_EVEN = RoundingMode.HALF_EVEN). */
export const D = Decimal.clone({
  precision: 1000,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -9e15,
  toExpPos: 9e15,
});
export type Dec = Decimal;

/** Contexto só para divisão: MathContext(34, HALF_EVEN) (ArredondamentoUtils.java:CONTEXTO_DIVISAO). */
const D34 = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_EVEN, toExpNeg: -9e15, toExpPos: 9e15 });

const HALF_EVEN = Decimal.ROUND_HALF_EVEN;

export const ZERO: Dec = new D(0);
export const ONE: Dec = new D(1);
const CENTESIMO = new D("0.01");
const CEM = new D(100);

export const dec = (v: string | number): Dec => new D(v);

/** BigDecimal.divide(divisor, CONTEXTO_DIVISAO). */
export function dividir(a: Dec, b: Dec): Dec {
  return new D(new D34(a).div(new D34(b)));
}

/** Pontos percentuais -> fração (movePointLeft(2)), exata. */
export function percentualParaFracao(p: Dec | null): Dec | null {
  return p === null ? null : p.mul(CENTESIMO);
}
/** Fração -> pontos percentuais (movePointRight(2)), exata. */
export function fracaoParaPercentual(f: Dec | null): Dec | null {
  return f === null ? null : f.mul(CEM);
}
export const movePointRight2 = (v: Dec): Dec => v.mul(CEM);

/** arredondarValorFiscal: setScale(2, HALF_EVEN). */
export function arredondarValorFiscal(v: Dec): Dec;
export function arredondarValorFiscal(v: null): null;
export function arredondarValorFiscal(v: Dec | null): Dec | null;
export function arredondarValorFiscal(v: Dec | null): Dec | null {
  return v === null ? null : v.toDecimalPlaces(2, HALF_EVEN);
}
/** arredondarAliquotaPublicada: setScale(4, HALF_EVEN). */
export function arredondarAliquotaPublicada(v: Dec): Dec;
export function arredondarAliquotaPublicada(v: null): null;
export function arredondarAliquotaPublicada(v: Dec | null): Dec | null;
export function arredondarAliquotaPublicada(v: Dec | null): Dec | null {
  return v === null ? null : v.toDecimalPlaces(4, HALF_EVEN);
}

// ───────────────────────── Formatação de saída (serializers) ─────────────────────────

/** BigDecimalTDec1302Serializer -> formatarMoeda: setScale(2, HALF_EVEN).toPlainString(). */
export function formatarMoeda(v: Dec): string {
  return v.toDecimalPlaces(2, HALF_EVEN).toFixed(2);
}
/** BigDecimalTDec0302_04Serializer -> formatarAliquota: 4 casas HALF_EVEN, sem zeros à direita, mínimo 2 casas. */
export function formatarAliquota(v: Dec): string {
  const s = v.toDecimalPlaces(4, HALF_EVEN);
  return s.toFixed(Math.max(2, s.decimalPlaces()));
}
/** BigDecimalTDec1104OpRTCSerializer -> formatarQuantidade: inteiro, senão 4 casas HALF_EVEN. */
export function formatarQuantidade(v: Dec): string {
  if (v.isInteger()) return v.toFixed(0);
  return v.toDecimalPlaces(4, HALF_EVEN).toFixed(4);
}

/** DecimalFormat pt-BR "#,##0.00" com RoundingMode.HALF_EVEN (MemoriaCalculoService.formatarMoeda). */
export function formatarMoedaPtBr(v: Dec | null): string {
  const x = (v ?? ZERO).toDecimalPlaces(2, HALF_EVEN);
  return agrupar(x.toFixed(2));
}
/** DecimalFormat pt-BR "#,##0.00##" com HALF_EVEN (MemoriaCalculoService.formatarPercentual). */
export function formatarPercentualPtBr(v: Dec | null): string {
  const x = (v ?? ZERO).toDecimalPlaces(4, HALF_EVEN);
  return agrupar(x.toFixed(Math.max(2, x.decimalPlaces())));
}
function agrupar(plain: string): string {
  const neg = plain.startsWith("-");
  const [int, frac] = (neg ? plain.slice(1) : plain).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "-" : ""}${grouped},${frac}`;
}

// ───────────────────── Entrada: BigDecimal com escala (toString fiel) ─────────────────────

/**
 * Representação de um BigDecimal Java (valor não escalado + escala), usada só para reproduzir
 * `BigDecimal.toString()`, `precision()` e `scale()` dos valores DE ENTRADA, que aparecem em mensagens de
 * erro (`recebido: '1.234'`, "informada 100.00 difere ...") e na memória de cálculo (quantidade).
 */
export class JBig {
  constructor(
    readonly unscaled: bigint,
    readonly scale: number,
  ) {}

  /** `new BigDecimal(String)`; null se não for numérico. */
  static parse(text: string): JBig | null {
    const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
    if (!m || (m[2] === "" && (m[3] === undefined || m[3] === ""))) return null;
    const frac = m[3] ?? "";
    const exp = m[4] ? parseInt(m[4], 10) : 0;
    let unscaled = BigInt((m[2] + frac) || "0");
    if (m[1] === "-") unscaled = -unscaled;
    return new JBig(unscaled, frac.length - exp);
  }

  precision(): number {
    const a = this.unscaled < BigInt(0) ? -this.unscaled : this.unscaled;
    return a === BigInt(0) ? 1 : a.toString().length;
  }

  toDec(): Dec {
    return new D(`${this.unscaled}e${-this.scale}`);
  }

  /** java.math.BigDecimal#toString (notação científica quando necessário). */
  toString(): string {
    if (this.scale === 0) return this.unscaled.toString();
    const neg = this.unscaled < BigInt(0);
    const coeff = (neg ? -this.unscaled : this.unscaled).toString();
    const adjusted = -this.scale + (coeff.length - 1);
    let out: string;
    if (this.scale >= 0 && adjusted >= -6) {
      if (coeff.length > this.scale) {
        out = coeff.slice(0, coeff.length - this.scale) + "." + coeff.slice(coeff.length - this.scale);
      } else {
        out = "0." + "0".repeat(this.scale - coeff.length) + coeff;
      }
    } else {
      out = coeff[0] + (coeff.length > 1 ? "." + coeff.slice(1) : "");
      if (adjusted !== 0) out += "E" + (adjusted > 0 ? "+" : "") + adjusted;
    }
    return (neg ? "-" : "") + out;
  }
}

const jbigMeta = new WeakMap<object, JBig>();

/** Cria um Dec de entrada lembrando o BigDecimal original (escala). */
export function decFromJBig(j: JBig): Dec {
  const d = j.toDec();
  jbigMeta.set(d, j);
  return d;
}
/** BigDecimal.toString() do valor (usa a escala de entrada quando conhecida). */
export function jstr(d: Dec): string {
  const j = jbigMeta.get(d);
  if (j) return j.toString();
  return JBig.parse(d.toFixed())?.toString() ?? d.toString();
}
export function jbigOf(d: Dec): JBig | undefined {
  return jbigMeta.get(d);
}
/** BigDecimal#toPlainString com a escala conhecida (ou o mínimo). */
export function jplain(d: Dec): string {
  const j = jbigMeta.get(d);
  if (!j) return d.toFixed();
  if (j.scale <= 0) return j.toDec().toFixed(0);
  return j.toDec().toFixed(j.scale);
}
