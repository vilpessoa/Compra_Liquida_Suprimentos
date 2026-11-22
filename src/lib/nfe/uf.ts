/**
 * Mapeamento cUF (código IBGE da UF, 2 dígitos) -> sigla, a partir da tabela oficial de UFs
 * gerada em src/data/rtc/localidades.json (seção UF, UF_CD/UF_SIGLA; inclui EX = 99).
 * A origem da tabela está em src/data/rtc/meta.json (SHA do repositório oficial).
 */
import localidades from "@/data/rtc/localidades.json";

const SIGLA_POR_CODIGO = new Map<number, string>(
  localidades.UF.rows.map((r): [number, string] => [r.UF_CD, r.UF_SIGLA]),
);

/** Devolve a sigla da UF, ou undefined se o código não estiver na tabela oficial. */
export function siglaUfPorCodigo(cUF: string): string | undefined {
  const n = Number(cUF);
  if (!Number.isInteger(n)) return undefined;
  return SIGLA_POR_CODIGO.get(n);
}
