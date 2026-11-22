/**
 * O motor local do Simples Nacional recusa-se a produzir um resultado quando não consegue garantir
 * fidelidade ao motor oficial (RFB) para a entrada recebida. Nunca devolve um valor "aproximado":
 * quem chama deve tratar o caso (ex.: usar o motor oficial via SIMPLES_ENGINE=rfb-http) ou bloquear
 * a decisão de compra correspondente.
 */
export class MotorLocalNaoValidadoError extends Error {
  readonly codigo: string;

  constructor(codigo: string, mensagem: string) {
    super(`[${codigo}] ${mensagem}`);
    this.name = "MotorLocalNaoValidadoError";
    this.codigo = codigo;
  }
}

/** Erros globais da operação (HTTP 422), espelho de `ErrosCalculoException` do motor oficial. */
export class ErrosCalculoException extends Error {
  readonly erros: import("./official-types").ErroDetalhe[];

  constructor(erros: import("./official-types").ErroDetalhe[]) {
    super("Erros de cálculo encontrados");
    this.name = "ErrosCalculoException";
    this.erros = [...erros];
  }
}
