/**
 * Port de domain/service/calculotributo/AvaliadorExpressaoAritmetica.java (JEXL com aritmética BigDecimal).
 *
 * Semântica reproduzida:
 *  - `evaluate`: se a expressão (trim) é exatamente o nome de uma variável, devolve o valor da variável;
 *  - caso geral: soma/subtração/multiplicação exatas; divisão com MathContext(34, HALF_EVEN) (ArredondamentoUtils);
 *  - divisor zero -> ArithmeticException("Division by zero");
 *  - variável inexistente -> erro (JEXL strict); literais numéricos viram BigDecimal pela grafia (Double.toString);
 *  - o resultado NÃO é arredondado: quem chama arredonda cada número publicado uma vez.
 * Gramática suportada (tudo o que ocorre em TRATAMENTO_TRIBUTARIO.TRTR_EXPRESSAO_*): números, identificadores,
 * `+ - * /`, parênteses e sinal unário.
 */
import { D, Dec, dividir } from "./jdecimal";

export class ArithmeticError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArithmeticException";
  }
}

type Token = { t: "num"; v: string } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new Error(`Expressão inválida: ${src}`);
      out.push({ t: "num", v: m[0] });
      i += m[0].length;
    } else if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
    } else if ("+-*/()".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
    } else {
      throw new Error(`Expressão inválida: ${src}`);
    }
  }
  return out;
}

export type Variaveis = Record<string, Dec>;

export function evaluate(expression: string, variables: Variaveis): Dec {
  const trimmed = expression.trim();
  if (Object.prototype.hasOwnProperty.call(variables, trimmed)) {
    return variables[trimmed];
  }
  const tokens = tokenize(expression);
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.t === "op" && peek().v === v;

  function primary(): Dec {
    const tk = tokens[pos++];
    if (!tk) throw new Error(`Expressão incompleta: ${expression}`);
    if (tk.t === "num") return new D(tk.v);
    if (tk.t === "id") {
      if (!Object.prototype.hasOwnProperty.call(variables, tk.v)) {
        throw new Error(`Variável indefinida: ${tk.v}`);
      }
      return variables[tk.v];
    }
    if (tk.v === "(") {
      const v = additive();
      if (!isOp(")")) throw new Error(`Parêntese não fechado: ${expression}`);
      pos++;
      return v;
    }
    throw new Error(`Token inesperado '${tk.v}' em: ${expression}`);
  }
  function unary(): Dec {
    if (isOp("-")) {
      pos++;
      return unary().neg();
    }
    if (isOp("+")) {
      pos++;
      return unary();
    }
    return primary();
  }
  function multiplicative(): Dec {
    let v = unary();
    while (isOp("*") || isOp("/")) {
      const op = tokens[pos++].v;
      const r = unary();
      if (op === "*") {
        v = v.mul(r);
      } else {
        if (r.isZero()) throw new ArithmeticError("Division by zero");
        v = dividir(v, r);
      }
    }
    return v;
  }
  function additive(): Dec {
    let v = multiplicative();
    while (isOp("+") || isOp("-")) {
      const op = tokens[pos++].v;
      const r = multiplicative();
      v = op === "+" ? v.plus(r) : v.minus(r);
    }
    return v;
  }
  const result = additive();
  if (pos < tokens.length) throw new Error(`Expressão inválida: ${expression}`);
  return result;
}
