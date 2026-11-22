/**
 * Utilitários puros compartilhados (heurística + pós-validação das LLMs).
 * Nada aqui faz I/O nem rede.
 */

/** As 27 UFs (dado público geográfico). */
export const UFS_VALIDAS: ReadonlySet<string> = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]);

/** NFC + espaços (inclui tab/quebras/nbsp) colapsados em um único espaço + trim. */
export function normalizarEspacos(s: string): string {
  return s.normalize("NFC").replace(/[\s ]+/g, " ").trim();
}

export function soDigitos(s: string): string {
  return s.replace(/\D+/g, "");
}

export function semAcentos(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Valida os dois dígitos verificadores de um CNPJ (14 dígitos numéricos). */
export function cnpjValido(cnpj: string): boolean {
  const d = soDigitos(cnpj);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (base: string, pesos: number[]): number => {
    const soma = base.split("").reduce((acc, ch, i) => acc + Number(ch) * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calc(d.slice(0, 12), p1);
  const d2 = calc(d.slice(0, 12) + d1, p2);
  return d1 === Number(d[12]) && d2 === Number(d[13]);
}

export function formatarCnpj(d14: string): string {
  return d14.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

export interface NumeroBr {
  /** Forma canônica: ponto decimal, sem separador de milhar (ex.: "1234.56"). */
  canonico: string;
  /** true quando o texto é ambíguo (ex.: "1.234" pode ser mil duzentos e trinta e quatro ou 1,234). */
  ambiguo: boolean;
}

/**
 * Interpreta número em formato BR ("1.234,56", "R$ 12,5", "1.000", "12.5").
 * Retorna null se o texto não for um número bem formado. Não arredonda nem converte para float.
 */
export function parseNumeroBr(bruto: string): NumeroBr | null {
  const s = bruto.replace(/R\$/gi, "").replace(/[\s ]/g, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const virgulas = (s.match(/,/g) ?? []).length;
  const pontos = (s.match(/\./g) ?? []).length;
  let inteiro: string;
  let dec = "";
  let ambiguo = false;
  if (virgulas > 1) return null;
  if (virgulas === 1) {
    const [i, d] = s.split(",");
    if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(i) || !/^\d+$/.test(d)) return null;
    inteiro = i.replace(/\./g, "");
    dec = d;
  } else if (pontos >= 1) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      // padrão BR de milhar; com um único ponto e 3 dígitos pode ser decimal em notação US.
      inteiro = s.replace(/\./g, "");
      ambiguo = pontos === 1;
    } else if (pontos === 1 && /^\d+\.\d+$/.test(s)) {
      [inteiro, dec] = s.split(".");
    } else return null;
  } else {
    inteiro = s;
  }
  inteiro = inteiro.replace(/^0+(?=\d)/, "");
  dec = dec.replace(/0+$/, "");
  return { canonico: dec ? `${inteiro}.${dec}` : inteiro, ambiguo };
}

/** Todos os tokens numéricos de um trecho, já canonizados. */
export function numerosDoTrecho(trecho: string): string[] {
  const out: string[] = [];
  for (const m of trecho.matchAll(/\d[\d.,]*/g)) {
    const limpo = m[0].replace(/[.,]+$/, "");
    const n = parseNumeroBr(limpo);
    if (n) out.push(n.canonico);
  }
  return out;
}

/** Canoniza um número já em texto (aceita BR ou ponto decimal). */
export function canonizarNumero(valor: string): string | null {
  return parseNumeroBr(valor)?.canonico ?? null;
}
