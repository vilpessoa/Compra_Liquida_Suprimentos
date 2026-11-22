/**
 * Chave de acesso de NF-e / NFC-e (44 dígitos).
 *
 * Layout e DV conforme Manual de Orientação do Contribuinte (MOC) da NF-e:
 *   cUF(2) AAMM(4) CNPJ/CPF(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1)
 *
 * DV: módulo 11 sobre os 43 primeiros dígitos, pesos 2..9 aplicados da direita para a
 * esquerda (ciclando). Resto 0 ou 1 gera DV 0; caso contrário DV = 11 - resto.
 *
 * TODO(UF): a sigla da UF não é mapeada aqui. O código numérico (cUF) é devolvido como
 * está. O mapeamento cUF -> sigla só deve ser feito quando a tabela oficial de UFs existir
 * em src/data/rtc. Não deduzir a sigla a partir do código.
 */

export const TAMANHO_CHAVE_ACESSO = 44;

export interface ChaveAcessoDecomposta {
  /** Chave normalizada, 44 dígitos. */
  chave: string;
  /** Código numérico da UF do emitente. Sigla: TODO (ver cabeçalho). */
  cUF: string;
  /** Ano e mês de emissão, AAMM. */
  AAMM: string;
  /** CNPJ do emitente (14 dígitos). Um CPF aparece completado com zeros à esquerda. */
  cnpjCpfEmitente: string;
  mod: string;
  serie: string;
  nNF: string;
  tpEmis: string;
  cNF: string;
  cDV: string;
}

export type AnaliseChaveAcesso =
  | { chave: string; tamanhoValido: false }
  | {
      chave: string;
      tamanhoValido: true;
      /** Verdadeiro quando o DV informado (último dígito) bate com o calculado. */
      dvValido: boolean;
      dvCalculado: string;
      /** Decomposição feita mesmo com DV divergente, para diagnóstico. */
      decomposta: ChaveAcessoDecomposta;
    };

export class ErroChaveAcesso extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroChaveAcesso";
  }
}

/** Remove tudo que não for dígito (espaços, pontos, o prefixo "NFe" etc.). */
export function normalizarChaveAcesso(entrada: string): string {
  return entrada.replace(/\D/g, "");
}

/** Calcula o DV módulo 11 sobre a base de 43 dígitos. */
export function calcularDvChaveAcesso(base43: string): number {
  if (!/^\d{43}$/.test(base43)) {
    throw new ErroChaveAcesso(`base do DV deve ter 43 dígitos, recebeu ${base43.length}`);
  }
  let soma = 0;
  let peso = 2;
  for (let i = base43.length - 1; i >= 0; i--) {
    soma += Number(base43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto === 0 || resto === 1 ? 0 : 11 - resto;
}

function decompor(chave: string): ChaveAcessoDecomposta {
  return {
    chave,
    cUF: chave.slice(0, 2),
    AAMM: chave.slice(2, 6),
    cnpjCpfEmitente: chave.slice(6, 20),
    mod: chave.slice(20, 22),
    serie: chave.slice(22, 25),
    nNF: chave.slice(25, 34),
    tpEmis: chave.slice(34, 35),
    cNF: chave.slice(35, 43),
    cDV: chave.slice(43, 44),
  };
}

/**
 * Analisa uma chave sem lançar erro. Útil para diagnóstico: informa tamanho, DV
 * calculado e a decomposição quando o tamanho é válido.
 */
export function analisarChaveAcesso(entrada: string): AnaliseChaveAcesso {
  const chave = normalizarChaveAcesso(entrada);
  if (chave.length !== TAMANHO_CHAVE_ACESSO) {
    return { chave, tamanhoValido: false };
  }
  const dvCalculado = calcularDvChaveAcesso(chave.slice(0, 43));
  return {
    chave,
    tamanhoValido: true,
    dvValido: dvCalculado === Number(chave[43]),
    dvCalculado: String(dvCalculado),
    decomposta: decompor(chave),
  };
}

/** Valida tamanho e DV e devolve a decomposição. Lança ErroChaveAcesso se inválida. */
export function validarChaveAcesso(entrada: string): ChaveAcessoDecomposta {
  const analise = analisarChaveAcesso(entrada);
  if (!analise.tamanhoValido) {
    throw new ErroChaveAcesso(
      `chave de acesso deve ter ${TAMANHO_CHAVE_ACESSO} dígitos, recebeu ${analise.chave.length}`,
    );
  }
  if (!analise.dvValido) {
    throw new ErroChaveAcesso(
      `DV da chave inválido: informado ${analise.chave[43]}, calculado ${analise.dvCalculado}`,
    );
  }
  return analise.decomposta;
}
