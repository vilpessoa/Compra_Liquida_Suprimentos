/**
 * Equivalentes fiéis de comportamentos do JDK usados pelo motor oficial (String.trim, isBlank,
 * Integer.valueOf, LocalDate.parse). Pequenas diferenças aqui mudariam códigos VSN-*.
 */

/** `String.isBlank()`: só caracteres que `Character.isWhitespace` aceita. */
const JAVA_BRANCO = new RegExp(
  "^[\\t\\n\\u000B\\f\\r\\u001C-\\u001F \\u1680\\u2000-\\u2006\\u2008-\\u200A\\u2028\\u2029\\u205F\\u3000]*$",
);

export function isBlank(v: string | null | undefined): boolean {
  return v == null || JAVA_BRANCO.test(v);
}

/** `String.trim()`: remove caracteres <= U+0020 das pontas. */
export function javaTrim(v: string): string {
  let i = 0;
  let j = v.length;
  while (i < j && v.charCodeAt(i) <= 0x20) i++;
  while (j > i && v.charCodeAt(j - 1) <= 0x20) j--;
  return v.slice(i, j);
}

/** `EscolhaParAliquotasService.inteiro`: Integer.valueOf(trim) tolerante (null se inválido/em branco). */
export function inteiroTolerante(v: string | null | undefined): number | null {
  if (v == null || isBlank(v)) return null;
  const t = javaTrim(v);
  if (!/^[+-]?\d+$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647) return null;
  return n;
}

/** `Integer.parseInt` estrito (lança se inválido), para valores já `trim`ados. */
export function parseIntJava(v: string): number {
  if (!/^[+-]?\d+$/.test(v)) throw new Error(`For input string: "${v}"`);
  const n = Number(v);
  if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647) throw new Error(`For input string: "${v}"`);
  return n;
}

function bissexto(a: number): boolean {
  return (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
}

/**
 * `LocalDate.parse` (ISO_LOCAL_DATE, resolução estrita): `yyyy-MM-dd` com data existente.
 * Devolve a própria string normalizada (ISO) ou `null` quando inválida.
 */
export function parseLocalDate(v: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const a = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1) return null;
  const dias = [31, bissexto(a) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1];
  if (dia > dias) return null;
  return v;
}

/** `Collator` natural de `Comparator.naturalOrder()` para inteiros. */
export function compararInteiros(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `String.format("%s", x)` para null/undefined (Java imprime "null"). */
export function fmtNull(v: unknown): string {
  return v == null ? "null" : String(v);
}
