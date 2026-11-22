import type { ErroDetalhe, ProblemDetail } from "./official-types";

/**
 * Respostas de erro HTTP do `ApiExceptionHandler` oficial (ProblemDetail, RFC 9457).
 * O `instance` é o URI da requisição (inclui o context-path `/api` do serviço oficial) e `type` das
 * exceções genéricas deriva do Host da requisição (`{baseURL}/errors/{path}`).
 */

export interface ContextoHttp {
  /** Esquema+host da requisição (ex.: `http://localhost`), usado em `type` dos erros. */
  baseURL: string;
  /** Context-path do serviço oficial (`/api`), prefixo de `instance`. */
  contextPath: string;
}

const agora = () => new Date().toISOString();

/** `handleErrosCalculoException`: HTTP 422 com `errors[]` (erros globais VSN-*). */
export function problema422(erros: ErroDetalhe[], instance: string): ProblemDetail {
  return {
    type: "about:blank",
    title: "Erros no processamento do cálculo do Simples Nacional",
    status: 422,
    detail: `O cálculo contém ${erros.length} erro(s).`,
    instance,
    timestamp: agora(),
    errors: erros,
  };
}

/** `handleMissingServletRequestParameter`: parâmetro obrigatório ausente. */
export function problemaParametroAusente(ctx: ContextoHttp, nome: string, tipo: string, instance: string): ProblemDetail {
  const detail = `O parâmetro obrigatório '${nome}' (${tipo}) não foi informado.`;
  return {
    type: `${ctx.baseURL}/errors/parametro-obrigatorio-ausente`,
    title: "Parâmetro obrigatório ausente",
    status: 400,
    detail,
    instance,
    timestamp: agora(),
    errors: [{ title: "Parâmetro obrigatório ausente", pointer: `#/${nome}`, detail }],
  };
}

/** `handleMethodArgumentTypeMismatchException`: valor de query param mal formado. */
export function problemaTipoArgumento(ctx: ContextoHttp, nome: string, valor: string, instance: string): ProblemDetail {
  const detail = `Parâmetro inválido [${nome}: ${valor}] `;
  return {
    type: `${ctx.baseURL}/errors/tipo-argumento-invalido`,
    title: "Tipo de argumento inválido",
    status: 400,
    detail,
    instance,
    timestamp: agora(),
    errors: [{ title: "Tipo de argumento inválido", pointer: `#/${nome}`, detail: detail.trim() }],
  };
}

/** `ResponseStatusException(BAD_REQUEST, motivo)`: corpo padrão do Spring (sem `timestamp`). */
export function problemaBadRequest(motivo: string, instance: string): ProblemDetail {
  return { type: "about:blank", title: "Bad Request", status: 400, detail: motivo, instance };
}
