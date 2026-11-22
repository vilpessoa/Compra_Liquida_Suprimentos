/**
 * Entrada: desserialização estilo Jackson + Bean Validation (VAL-*) do motor oficial.
 *
 * Fontes (.rfb/.../src/main/java/br/gov/serpro/rtc):
 *  - api/model/input/*.java (anotações @NotNull/@Size/@Min/@Max/@Pattern/@PositiveOrZero/@Digits/@DecimalMax/@DecimalMin/@NotEmpty/@Valid)
 *  - config/serializer/OffsetDateTimeCustomDeserializer.java e GenericCustomDeserializer.java (data/hora)
 *  - domain/service/ObservabilidadeService.java (validarCamposGlobais, extractFieldName, buildValidationDetail, toJsonPointer)
 *  - api/exceptionhandler/ApiExceptionHandler.java (MethodArgumentNotValid -> 400 "Campos inválidos.")
 *
 * Coerções do Jackson reproduzidas: string numérica -> BigDecimal/Integer/Long (com trim() de caracteres <= U+0020,
 * por isso o corpus, que prefixa "\u0000", funciona), número -> String.
 */
import { Dec, JBig, decFromJBig, jstr, jbigOf } from "./jdecimal";
import { CODIGO_VALIDACAO } from "./errors";

/** Falha de desserialização (HttpMessageNotReadableException) -> HTTP 400. */
export class JsonParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonParseError";
  }
}

export interface ImpostoSeletivoIn {
  cst: string | null;
  cClassTrib: string | null;
  baseCalculo: Dec | null;
  quantidade: Dec | null;
  unidade: string | null;
  impostoInformado: Dec | null;
}
export interface AliquotasNominaisIn {
  cbs: Dec | null;
  ibsEstadual: Dec | null;
  ibsMunicipal: Dec | null;
  impostoSeletivo: { adValorem: Dec | null; adRem: Dec | null } | null;
}
export interface ItemIn {
  numero: number | null;
  ncm: string | null;
  nbs: string | null;
  cst: string | null;
  cClassTrib: string | null;
  baseCalculo: Dec | null;
  quantidade: Dec | null;
  unidade: string | null;
  impostoSeletivo: ImpostoSeletivoIn | null;
  tributacaoRegular: { cst: string | null; cClassTrib: string | null } | null;
  /** gComponentesBC informado com ao menos um componente (não validado localmente). */
  possuiComponentesBC: boolean;
  aliquotasNominais: AliquotasNominaisIn | null;
}
export interface OperacaoIn {
  id: string | null;
  versao: string | null;
  dhFatoGerador: string | null;
  dataHoraEmissao: string | null;
  municipio: number | null;
  uf: string | null;
  tpDoc: number | null;
  gCompraGov: { tpEnteGov: number | null; tpOperGov: number | null } | null;
  itens: ItemIn[] | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const TIPO_ENTE = "br.gov.serpro.rtc.api.model.input.calculadora.enumeration.TipoEnteGovernamental";
const TIPO_OPER = "br.gov.serpro.rtc.api.model.input.calculadora.enumeration.TipoOperacaoGovernamental";

function asStr(v: unknown, field: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  throw new JsonParseError(
    `JSON parse error: Cannot deserialize value of type \`java.lang.String\` from Object value (field '${field}')`,
  );
}
function trimJava(s: string): string {
  // String.trim(): remove caracteres <= U+0020 nas pontas
  let a = 0,
    b = s.length;
  while (a < b && s.charCodeAt(a) <= 0x20) a++;
  while (b > a && s.charCodeAt(b - 1) <= 0x20) b--;
  return s.slice(a, b);
}
function asBig(v: unknown, field: string): Dec | null {
  if (v === null || v === undefined) return null;
  let text: string;
  if (typeof v === "number") text = String(v);
  else if (typeof v === "string") {
    text = trimJava(v);
    if (text === "") return null; // coerção de string vazia -> null
  } else {
    throw new JsonParseError(
      `JSON parse error: Cannot deserialize value of type \`java.math.BigDecimal\` from Object value (field '${field}')`,
    );
  }
  const j = JBig.parse(text);
  if (!j) {
    throw new JsonParseError(
      `JSON parse error: Cannot deserialize value of type \`java.math.BigDecimal\` from String "${text}": not a valid representation`,
    );
  }
  return decFromJBig(j);
}
function asInt(v: unknown, field: string, tipo: "Integer" | "Long"): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Math.trunc(v);
  if (typeof v === "string") {
    const t = trimJava(v);
    if (t === "") return null;
    if (/^[+-]?\d+$/.test(t)) return parseInt(t, 10);
    throw new JsonParseError(
      `JSON parse error: Cannot deserialize value of type \`java.lang.${tipo}\` from String "${t}": not a valid \`${tipo.toLowerCase()}\` value`,
    );
  }
  throw new JsonParseError(
    `JSON parse error: Cannot deserialize value of type \`java.lang.${tipo}\` from Object value (field '${field}')`,
  );
}
function asEnum(v: unknown, tipo: string, validos: number[]): number | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === "number" || typeof v === "string" ? String(v) : "";
  const n = /^\d+$/.test(s) ? parseInt(s, 10) : NaN;
  if (!validos.includes(n)) {
    throw new JsonParseError(
      `JSON parse error: Cannot deserialize value of type \`${tipo}\` from String "${s}": not one of the values accepted for Enum class: [${validos.join(", ")}]`,
    );
  }
  return n;
}

const OFFSET_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/;
function asOffsetDateTime(v: unknown, field: string): string | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === "string" ? v : String(v);
  const formatted = `Campo '${field}' [${s}] inválido. Formato esperado: 'yyyy-MM-dd'T'HH:mm:ssXXX'. Exemplo de valor: '2026-01-05T13:45:00-03:00 ou 2026-05-22T10:57:23Z'`;
  if (!OFFSET_DATE_TIME.test(s)) throw new JsonParseError(`JSON parse error: ${formatted}`);
  // ISO_OFFSET_DATE_TIME: valida os campos de calendário
  const [y, m, d] = [Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10))];
  const [hh, mi, ss] = [Number(s.slice(11, 13)), Number(s.slice(14, 16)), Number(s.slice(17, 19))];
  const dt = new Date(Date.UTC(y, m - 1, d));
  const okDate = dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  if (!okDate || hh > 23 || mi > 59 || ss > 59) throw new JsonParseError(`JSON parse error: ${formatted}`);
  return s;
}

function parseImpostoSeletivo(o: unknown): ImpostoSeletivoIn | null {
  if (o === null || o === undefined) return null;
  if (!isObj(o)) throw new JsonParseError("JSON parse error: Cannot deserialize value of type `ImpostoSeletivoInput` from non-object");
  return {
    cst: asStr(o.cst, "cst"),
    cClassTrib: asStr(o.cClassTrib, "cClassTrib"),
    baseCalculo: asBig(o.baseCalculo, "baseCalculo"),
    quantidade: asBig(o.quantidade, "quantidade"),
    unidade: asStr(o.unidade, "unidade"),
    impostoInformado: asBig(o.impostoInformado, "impostoInformado"),
  };
}
function parseAliquotasNominais(o: unknown): AliquotasNominaisIn | null {
  if (o === null || o === undefined) return null;
  if (!isObj(o)) throw new JsonParseError("JSON parse error: Cannot deserialize value of type `AliquotasNominaisInput` from non-object");
  let is: AliquotasNominaisIn["impostoSeletivo"] = null;
  if (o.impostoSeletivo !== null && o.impostoSeletivo !== undefined) {
    if (!isObj(o.impostoSeletivo)) throw new JsonParseError("JSON parse error: Cannot deserialize `AliquotasNominaisImpostoSeletivo` from non-object");
    is = { adValorem: asBig(o.impostoSeletivo.adValorem, "adValorem"), adRem: asBig(o.impostoSeletivo.adRem, "adRem") };
  }
  return {
    cbs: asBig(o.cbs, "cbs"),
    ibsEstadual: asBig(o.ibsEstadual, "ibsEstadual"),
    ibsMunicipal: asBig(o.ibsMunicipal, "ibsMunicipal"),
    impostoSeletivo: is,
  };
}
const COMPONENTES = ["vProd", "vFrete", "vSeg", "vOutro", "vII", "vIS", "vDesc", "vPIS", "vCOFINS", "vICMS", "vICMSUFDest", "vFCP", "vFCPUFDest", "vICMSMono", "vISSQN"];
function parseItem(o: unknown): ItemIn {
  if (!isObj(o)) throw new JsonParseError("JSON parse error: Cannot deserialize value of type `ItemOperacaoInput` from non-object");
  let tr: ItemIn["tributacaoRegular"] = null;
  if (o.tributacaoRegular !== null && o.tributacaoRegular !== undefined) {
    if (!isObj(o.tributacaoRegular)) throw new JsonParseError("JSON parse error: Cannot deserialize `TributacaoRegularInput` from non-object");
    tr = { cst: asStr(o.tributacaoRegular.cst, "cst"), cClassTrib: asStr(o.tributacaoRegular.cClassTrib, "cClassTrib") };
  }
  let possuiComp = false;
  if (o.gComponentesBC !== null && o.gComponentesBC !== undefined) {
    if (!isObj(o.gComponentesBC)) throw new JsonParseError("JSON parse error: Cannot deserialize `ComponentesBaseCalculoInput` from non-object");
    for (const k of COMPONENTES) if (o.gComponentesBC[k] !== null && o.gComponentesBC[k] !== undefined) possuiComp = true;
  }
  return {
    numero: asInt(o.numero, "numero", "Integer"),
    ncm: asStr(o.ncm, "ncm"),
    nbs: asStr(o.nbs, "nbs"),
    cst: asStr(o.cst, "cst"),
    cClassTrib: asStr(o.cClassTrib, "cClassTrib"),
    baseCalculo: asBig(o.baseCalculo, "baseCalculo"),
    quantidade: asBig(o.quantidade, "quantidade"),
    unidade: asStr(o.unidade, "unidade"),
    impostoSeletivo: parseImpostoSeletivo(o.impostoSeletivo),
    tributacaoRegular: tr,
    possuiComponentesBC: possuiComp,
    aliquotasNominais: parseAliquotasNominais(o.aliquotasNominais),
  };
}

export function parseOperacao(raw: unknown): OperacaoIn {
  if (!isObj(raw)) {
    throw new JsonParseError("JSON parse error: Cannot deserialize value of type `OperacaoInput` from non-object");
  }
  let g: OperacaoIn["gCompraGov"] = null;
  if (raw.gCompraGov !== null && raw.gCompraGov !== undefined) {
    if (!isObj(raw.gCompraGov)) throw new JsonParseError("JSON parse error: Cannot deserialize `CompraGovernamentalInput` from non-object");
    g = {
      tpEnteGov: asEnum(raw.gCompraGov.tpEnteGov, TIPO_ENTE, [1, 2, 3, 4, 5, 6]),
      tpOperGov: asEnum(raw.gCompraGov.tpOperGov, TIPO_OPER, [1, 2, 3, 4, 5]),
    };
  }
  let itens: ItemIn[] | null = null;
  if (raw.itens !== null && raw.itens !== undefined) {
    if (!Array.isArray(raw.itens)) throw new JsonParseError("JSON parse error: Cannot deserialize value of type `java.util.ArrayList` from non-array");
    itens = raw.itens.map(parseItem);
  }
  return {
    id: asStr(raw.id, "id"),
    versao: asStr(raw.versao, "versao"),
    dhFatoGerador: asOffsetDateTime(raw.dhFatoGerador, "dhFatoGerador"),
    dataHoraEmissao: asOffsetDateTime(raw.dataHoraEmissao, "dataHoraEmissao"),
    municipio: asInt(raw.municipio, "municipio", "Long"),
    uf: asStr(raw.uf, "uf"),
    tpDoc: asInt(raw.tpDoc, "tpDoc", "Integer"),
    gCompraGov: g,
    itens,
  };
}

// ───────────────────────────── Bean Validation ─────────────────────────────

export interface Violation {
  /** Nome simples da anotação (NotNull, Size, ...). */
  annotation: string;
  /** Caminho da propriedade (`itens[0].cst`, `impostoSeletivo.baseCalculo`, ...). */
  path: string;
  /** Mensagem padrão do Hibernate Validator (en-US) ou a personalizada. */
  message: string;
  /** invalidValue (já em texto Java) ou null. */
  invalid: string | null;
}

class Validator {
  readonly out: Violation[] = [];
  constructor(private readonly prefix = "") {}
  private add(annotation: string, path: string, message: string, invalid: string | null) {
    this.out.push({ annotation, path: this.prefix + path, message, invalid });
  }
  notNull(path: string, v: unknown): boolean {
    if (v === null || v === undefined) {
      this.add("NotNull", path, "must not be null", null);
      return false;
    }
    return true;
  }
  size(path: string, v: string | null, min: number, max: number) {
    if (v !== null && (v.length < min || v.length > max)) this.add("Size", path, `size must be between ${min} and ${max}`, v);
  }
  pattern(path: string, v: string | null, re: RegExp, message: string) {
    if (v !== null && !re.test(v)) this.add("Pattern", path, message, v);
  }
  min(path: string, v: number | null, min: number) {
    if (v !== null && v < min) this.add("Min", path, `must be greater than or equal to ${min}`, String(v));
  }
  max(path: string, v: number | null, max: number) {
    if (v !== null && v > max) this.add("Max", path, `must be less than or equal to ${max}`, String(v));
  }
  positiveOrZero(path: string, v: Dec | null) {
    if (v !== null && v.isNegative() && !v.isZero()) this.add("PositiveOrZero", path, "must be greater than or equal to 0", jstr(v));
  }
  digits(path: string, v: Dec | null, integer: number, fraction: number) {
    if (v === null) return;
    const j = jbigOf(v) ?? JBig.parse(v.toFixed())!;
    const integerPart = j.precision() - j.scale;
    const fractionPart = j.scale < 0 ? 0 : j.scale;
    if (integerPart > integer || fractionPart > fraction) {
      this.add("Digits", path, `numeric value out of bounds (<${integer} digits>.<${fraction} digits> expected)`, jstr(v));
    }
  }
  decimalMax(path: string, v: Dec | null, max: string) {
    if (v !== null && v.greaterThan(max)) this.add("DecimalMax", path, `must be less than or equal to ${max}`, jstr(v));
  }
  decimalMin(path: string, v: Dec | null, min: string) {
    if (v !== null && v.lessThan(min)) this.add("DecimalMin", path, `must be greater than or equal to ${min}`, jstr(v));
  }
}

const SO_DIGITOS = /^\d+$/;
const MSG_DIGITOS = "Informar somente dígitos";

/** Constraints de ItemOperacaoInput e filhos (paths relativos ao item, com `prefix` opcional). */
export function validarItem(item: ItemIn, prefix = ""): Violation[] {
  const v = new Validator(prefix);
  v.notNull("numero", item.numero);
  v.min("numero", item.numero, 1);
  v.max("numero", item.numero, 9999999);
  v.notNull("cst", item.cst);
  v.pattern("cst", item.cst, SO_DIGITOS, MSG_DIGITOS);
  v.size("cst", item.cst, 3, 3);
  v.notNull("cClassTrib", item.cClassTrib);
  v.pattern("cClassTrib", item.cClassTrib, SO_DIGITOS, MSG_DIGITOS);
  v.size("cClassTrib", item.cClassTrib, 6, 6);
  v.positiveOrZero("baseCalculo", item.baseCalculo);
  v.digits("baseCalculo", item.baseCalculo, 13, 2);
  v.digits("quantidade", item.quantidade, 11, 4);
  const is = item.impostoSeletivo;
  if (is) {
    v.notNull("impostoSeletivo.cst", is.cst);
    v.pattern("impostoSeletivo.cst", is.cst, SO_DIGITOS, MSG_DIGITOS);
    v.size("impostoSeletivo.cst", is.cst, 3, 3);
    v.notNull("impostoSeletivo.cClassTrib", is.cClassTrib);
    v.pattern("impostoSeletivo.cClassTrib", is.cClassTrib, SO_DIGITOS, MSG_DIGITOS);
    v.size("impostoSeletivo.cClassTrib", is.cClassTrib, 6, 6);
    v.notNull("impostoSeletivo.baseCalculo", is.baseCalculo);
    v.positiveOrZero("impostoSeletivo.baseCalculo", is.baseCalculo);
    v.digits("impostoSeletivo.baseCalculo", is.baseCalculo, 13, 2);
    v.positiveOrZero("impostoSeletivo.quantidade", is.quantidade);
    v.digits("impostoSeletivo.quantidade", is.quantidade, 11, 4);
    v.positiveOrZero("impostoSeletivo.impostoInformado", is.impostoInformado);
    v.digits("impostoSeletivo.impostoInformado", is.impostoInformado, 13, 2);
  }
  const tr = item.tributacaoRegular;
  if (tr) {
    v.notNull("tributacaoRegular.cst", tr.cst);
    v.pattern("tributacaoRegular.cst", tr.cst, SO_DIGITOS, MSG_DIGITOS);
    v.size("tributacaoRegular.cst", tr.cst, 3, 3);
    v.notNull("tributacaoRegular.cClassTrib", tr.cClassTrib);
    v.pattern("tributacaoRegular.cClassTrib", tr.cClassTrib, SO_DIGITOS, MSG_DIGITOS);
    v.size("tributacaoRegular.cClassTrib", tr.cClassTrib, 6, 6);
  }
  const an = item.aliquotasNominais;
  if (an) {
    for (const k of ["cbs", "ibsEstadual", "ibsMunicipal"] as const) {
      v.positiveOrZero(`aliquotasNominais.${k}`, an[k]);
      v.digits(`aliquotasNominais.${k}`, an[k], 3, 4);
      v.decimalMax(`aliquotasNominais.${k}`, an[k], "100.00");
    }
    if (an.impostoSeletivo) {
      const p = "aliquotasNominais.impostoSeletivo";
      v.positiveOrZero(`${p}.adValorem`, an.impostoSeletivo.adValorem);
      v.digits(`${p}.adValorem`, an.impostoSeletivo.adValorem, 3, 4);
      v.decimalMax(`${p}.adValorem`, an.impostoSeletivo.adValorem, "100.00");
      v.decimalMin(`${p}.adRem`, an.impostoSeletivo.adRem, "0.00");
    }
  }
  return v.out;
}

/** Constraints do próprio OperacaoInput (sem descer nos itens). */
export function validarOperacao(op: OperacaoIn): Violation[] {
  const v = new Validator();
  v.notNull("id", op.id);
  v.notNull("versao", op.versao);
  v.notNull("municipio", op.municipio);
  v.min("municipio", op.municipio, 0);
  v.max("municipio", op.municipio, 9999999);
  v.size("uf", op.uf, 2, 2);
  v.min("tpDoc", op.tpDoc, 1);
  v.max("tpDoc", op.tpDoc, 999);
  if (op.gCompraGov) v.notNull("gCompraGov.tpEnteGov", op.gCompraGov.tpEnteGov);
  if (op.itens === null || op.itens.length === 0) {
    // @NotEmpty (valor inválido: null ou lista vazia -> "[]")
    v.out.push({ annotation: "NotEmpty", path: "itens", message: "must not be empty", invalid: op.itens === null ? null : "[]" });
  }
  return v.out;
}

/** Constraints do corpo inteiro (como `@Valid @RequestBody`): operação + cada item com prefixo `itens[i].`. */
export function validarCorpoCompleto(op: OperacaoIn): Violation[] {
  const out = validarOperacao(op);
  (op.itens ?? []).forEach((it, i) => out.push(...validarItem(it, `itens[${i}].`)));
  return out;
}

export function codigoDaAnotacao(annotation: string): { code: string; titulo: string } {
  return CODIGO_VALIDACAO[annotation] ?? { code: "VAL-000", titulo: "Erro de validação não categorizado" };
}

/** ObservabilidadeService.buildValidationDetail. */
export function detalheValidacao(field: string, message: string, invalid: string | null): string {
  return invalid !== null ? `Campo '${field}' ${message}, recebido: '${invalid}'` : `Campo '${field}' ${message}`;
}

/** ObservabilidadeService.toJsonPointer: `[n]` -> `/n`, `.` -> `/`, prefixo `#/`. */
export function paraJsonPointer(field: string): string {
  return "#/" + field.replace(/\[(\d+)]/g, "/$1").replace(/\./g, "/");
}
