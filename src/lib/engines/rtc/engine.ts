/**
 * Orquestração dos endpoints do regime regular (port de):
 *  - api/controller/ObservabilidadeController.java + domain/service/ObservabilidadeService.java
 *      POST calculadora/observabilidade/regime-geral
 *  - api/controller/CalculadoraTributoController.java + domain/service/CalculadoraService.java
 *      POST calculadora/regime-geral
 *  - domain/service/collector/ItemCollector.java, api/exceptionhandler/*  (erros, RFC 9457)
 *  - domain/service/AvisoDadosSimuladosService.java (header x-warning-dados-simulados)
 *  - domain/service/VersaoAplicacaoService.java (headers x-calc-*)
 *  - api/model/roc/*.java (totais: ValoresTotaisDomain e filhos) e serializers (formato dos decimais)
 *
 * As funções são síncronas depois de `loadRtcData()`; a resposta é idêntica à da API (corpo + status + headers).
 */
import { Dec, ZERO, formatarAliquota, formatarMoeda, formatarQuantidade } from "./jdecimal";
import {
  ERRO_SISTEMA_PATH,
  ERRO_SISTEMA_TITULO,
  KINDS,
  MotorLocalNaoValidadoError,
  RtcException,
  ex,
  httpStatusOf,
  problemaHttpDe,
} from "./errors";
import type { RtcRepos, TipoDfe } from "./data";
import {
  ItemIn,
  JsonParseError,
  OperacaoIn,
  codigoDaAnotacao,
  detalheValidacao,
  paraJsonPointer,
  parseOperacao,
  validarCorpoCompleto,
  validarItem,
  validarOperacao,
} from "./input";
import { processarItem } from "./processamento";
import type { TributosOut, GrupoIbsCbsOut, CompraGov, Diferimento, ReducaoAliquota, ImpostoSeletivoOut } from "./calculo";
import type {
  CompraGovernamentalDomain,
  ErroDetalhe,
  EstadoItem,
  IBSCBSTotalDomain,
  ObjetoDomain,
  ObservabilidadeItemDomain,
  ObservabilidadeROCDomain,
  OperacaoConsumoDomain,
  ProblemDetailBody,
  ROCDomain,
  RtcHttpResponse,
  RtcResponseHeaders,
  TributosDomain,
  ValoresTotaisDomain,
  TpEnteGov,
  TpOperGov,
} from "./official-types";

/** pom.xml (<version> do projeto, linha 12 em f1eebd7): valor de `info.app.version`, header X-CALC-APP-VERSION. */
export const RTC_APP_VERSION = "1.7.2";

const PATH_OBS = "/api/calculadora/observabilidade/regime-geral";
const PATH_RG = "/api/calculadora/regime-geral";

export interface EngineOptions {
  /** `scheme://host` do request (HttpUtils.getBaseURL); padrão `http://localhost`, como no corpus. */
  baseUrl?: string;
  /** Relógio injetável (campo `timestamp` dos erros HTTP). */
  agora?: () => Date;
}

// ───────────────────────────── serialização (Jackson) ─────────────────────────────

const aliq = (v: Dec | null) => (v === null ? undefined : formatarAliquota(v));
const moeda = (v: Dec | null) => (v === null ? undefined : formatarMoeda(v));

function sReducao(g: ReducaoAliquota | null) {
  if (g === null) return undefined;
  return { pRedAliq: aliq(g.pRedAliq), pAliqEfet: aliq(g.pAliqEfet) };
}
function sDif(g: Diferimento | null) {
  if (g === null) return undefined;
  return { pDif: formatarAliquota(g.pDif), vDif: formatarMoeda(g.vDif) };
}
function sCompraGov(c: CompraGov | null) {
  if (c === null) return undefined;
  return {
    pAliqIBSUF: aliq(c.pAliqIBSUF),
    vTribIBSUF: moeda(c.vTribIBSUF),
    pAliqIBSMun: aliq(c.pAliqIBSMun),
    vTribIBSMun: moeda(c.vTribIBSMun),
    pAliqCBS: aliq(c.pAliqCBS),
    vTribCBS: moeda(c.vTribCBS),
  };
}
function sGrupo(g: GrupoIbsCbsOut | null) {
  if (g === null) return undefined;
  return {
    vBC: moeda(g.vBC),
    gIBSUF: g.gIBSUF
      ? { pIBSUF: aliq(g.gIBSUF.pIBSUF), gDif: sDif(g.gIBSUF.gDif), gRed: sReducao(g.gIBSUF.gRed), vIBSUF: moeda(g.gIBSUF.vIBSUF) }
      : undefined,
    gIBSMun: g.gIBSMun
      ? { pIBSMun: aliq(g.gIBSMun.pIBSMun), gDif: sDif(g.gIBSMun.gDif), gRed: sReducao(g.gIBSMun.gRed), vIBSMun: moeda(g.gIBSMun.vIBSMun) }
      : undefined,
    vIBS: moeda(g.vIBS),
    gCBS: g.gCBS
      ? { pCBS: aliq(g.gCBS.pCBS), gDif: sDif(g.gCBS.gDif), gRed: sReducao(g.gCBS.gRed), vCBS: moeda(g.gCBS.vCBS) }
      : undefined,
    gTribRegular: g.gTribRegular
      ? {
          CSTReg: g.gTribRegular.CSTReg,
          cClassTribReg: g.gTribRegular.cClassTribReg,
          pAliqEfetRegIBSUF: aliq(g.gTribRegular.pAliqEfetRegIBSUF),
          vTribRegIBSUF: moeda(g.gTribRegular.vTribRegIBSUF),
          pAliqEfetRegIBSMun: aliq(g.gTribRegular.pAliqEfetRegIBSMun),
          vTribRegIBSMun: moeda(g.gTribRegular.vTribRegIBSMun),
          pAliqEfetRegCBS: aliq(g.gTribRegular.pAliqEfetRegCBS),
          vTribRegCBS: moeda(g.gTribRegular.vTribRegCBS),
        }
      : undefined,
    gTribCompraGov: sCompraGov(g.gTribCompraGov),
  };
}
function sIS(i: ImpostoSeletivoOut | null) {
  if (i === null) return undefined;
  return {
    CSTIS: i.CSTIS,
    cClassTribIS: i.cClassTribIS,
    vBCIS: formatarMoeda(i.vBCIS),
    pIS: aliq(i.pIS),
    pISEspec: aliq(i.pISEspec),
    adRemIS: aliq(i.adRemIS),
    uTrib: i.uTrib === null ? undefined : i.uTrib,
    qTrib: i.qTrib === null ? undefined : formatarQuantidade(i.qTrib),
    vIS: moeda(i.vIS),
    memoriaCalculo: i.memoriaCalculo === null ? undefined : i.memoriaCalculo,
  };
}
function sTributos(t: TributosOut): TributosDomain {
  const ib = t.IBSCBS;
  return clean({
    IS: sIS(t.IS),
    IBSCBS: {
      CST: ib.CST,
      cClassTrib: ib.cClassTrib,
      gIBSCBS: sGrupo(ib.gIBSCBS),
      memoriaCalculo: ib.memoriaCalculo
        ? { cbs: ib.memoriaCalculo.cbs ?? undefined, ibsUF: ib.memoriaCalculo.ibsUF ?? undefined, ibsMun: ib.memoriaCalculo.ibsMun ?? undefined }
        : undefined,
    },
  }) as unknown as TributosDomain;
}
/** @JsonInclude(NON_NULL): remove propriedades `undefined` recursivamente (preserva a ordem de inserção). */
function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clean) as unknown as T;
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (x !== undefined) out[k] = clean(x);
    }
    return out as T;
  }
  return v;
}

// ───────────────────────────── totais ─────────────────────────────

interface ObjetoCalc {
  nObj: number;
  tribCalc: TributosOut;
}

function somar(vals: Array<Dec | null>): Dec {
  return vals.reduce<Dec>((a, b) => a.plus(b ?? ZERO), ZERO);
}

function totais(detalhes: ObjetoCalc[]): ValoresTotaisDomain {
  const comIS = detalhes.filter((d) => d.tribCalc.IS !== null);
  const ISTot = comIS.length > 0 ? { vIS: formatarMoeda(somar(comIS.map((d) => d.tribCalc.IS!.vIS ?? ZERO))) } : undefined;

  let IBSCBSTot: IBSCBSTotalDomain | undefined;
  if (detalhes.length > 0) {
    const grupos = detalhes.map((d) => d.tribCalc.IBSCBS.gIBSCBS);
    const vBC = somar(grupos.filter((g) => g !== null && g.vBC !== null).map((g) => g!.vBC));
    const comUF = grupos.filter((g) => g !== null && g.gIBSUF !== null);
    const comMun = grupos.filter((g) => g !== null && g.gIBSMun !== null);
    const comCbs = grupos.filter((g) => g !== null && g.gCBS !== null);
    const gIBSUF = {
      vDif: formatarMoeda(somar(comUF.map((g) => g!.gIBSUF!.gDif?.vDif ?? ZERO))),
      vDevTrib: formatarMoeda(ZERO),
      vIBSUF: formatarMoeda(somar(comUF.map((g) => g!.gIBSUF!.vIBSUF ?? ZERO))),
    };
    const gIBSMun = {
      vDif: formatarMoeda(somar(comMun.map((g) => g!.gIBSMun!.gDif?.vDif ?? ZERO))),
      vDevTrib: formatarMoeda(ZERO),
      vIBSMun: formatarMoeda(somar(comMun.map((g) => g!.gIBSMun!.vIBSMun ?? ZERO))),
    };
    const vIBS = somar(grupos.filter((g) => g !== null).map((g) => g!.vIBS));
    IBSCBSTot = {
      vBCIBSCBS: formatarMoeda(vBC),
      gIBS: { gIBSUF, gIBSMun, vIBS: formatarMoeda(vIBS), vCredPres: formatarMoeda(ZERO), vCredPresCondSus: formatarMoeda(ZERO) },
      gCBS: {
        vDif: formatarMoeda(somar(comCbs.map((g) => g!.gCBS!.gDif?.vDif ?? ZERO))),
        vDevTrib: formatarMoeda(ZERO),
        vCBS: formatarMoeda(somar(comCbs.map((g) => g!.gCBS!.vCBS ?? ZERO))),
        vCredPres: formatarMoeda(ZERO),
        vCredPresCondSus: formatarMoeda(ZERO),
      },
      // Garantido pelo Java mesmo zerado (obrigatório no leiaute); monofasia nunca é calculada (CAL-007)
      gMono: {
        vIBSMono: formatarMoeda(ZERO),
        vCBSMono: formatarMoeda(ZERO),
        vIBSMonoReten: formatarMoeda(ZERO),
        vCBSMonoReten: formatarMoeda(ZERO),
        vIBSMonoRet: formatarMoeda(ZERO),
        vCBSMonoRet: formatarMoeda(ZERO),
      },
    };
  }
  return { tribCalc: clean({ ISTot, IBSCBSTot }) };
}

// ───────────────────────────── erros ─────────────────────────────

function tituloSistema(kind: RtcException["kind"]): string {
  if (kind === "SiglaDFeNaoEncontrada") return "Sigla DFe não reconhecida";
  if (kind === "FormaAplicacaoNaoDefinida") return "Forma de Aplicação de Percentual não definida";
  return ERRO_SISTEMA_TITULO;
}

/** ItemCollector: estado + ErroDetalhe a partir de uma exceção. */
function erroDeExcecao(e: unknown, index: number, baseUrl: string): { estado: EstadoItem; erro: ErroDetalhe } {
  const exc = e instanceof RtcException ? e : ex.sistema(e instanceof Error ? e.message : String(e));
  const info = KINDS[exc.kind];
  const buildType = (codigo: string) => `${baseUrl}/api/calculadora/observabilidade/erros?codigo=${codigo}`;
  if (info.obs) {
    const campo = info.obs.campoDefault;
    return {
      estado: info.obs.estado,
      erro: {
        type: buildType(info.obs.codigo),
        title: info.obs.titulo,
        code: info.obs.codigo,
        pointer: campo === null ? `#/itens/${index}` : `#/itens/${index}/${campo}`,
        detail: exc.message,
      },
    };
  }
  return {
    estado: "FALHA_TECNICA",
    erro: {
      type: buildType("CAL-999"),
      title: tituloSistema(exc.kind),
      code: "CAL-999",
      pointer: `#/itens/${index}`,
      detail: exc.message,
    },
  };
}

function problema(
  status: number,
  title: string,
  type: string,
  detail: string,
  instance: string,
  opts: EngineOptions,
  errors?: ErroDetalhe[],
): ProblemDetailBody {
  const body: ProblemDetailBody = {
    type,
    title,
    status,
    detail,
    instance,
    timestamp: (opts.agora?.() ?? new Date()).toISOString(),
  };
  if (errors) body.errors = errors;
  return body;
}

/** ApiExceptionHandler + ProblemType (HTTP) para exceções de negócio de /regime-geral. */
function respostaErroHttp(e: unknown, instance: string, base: string, opts: EngineOptions): RtcHttpResponse<ProblemDetailBody> {
  const exc = e instanceof RtcException ? e : ex.sistema(e instanceof Error ? e.message : String(e));
  const status = httpStatusOf(exc.kind);
  const http = problemaHttpDe(exc.kind);
  return {
    status,
    body: problema(status, http.titulo, `${base}/errors/${http.path}`, exc.message, instance, opts),
    headers: {},
  };
}

function respostaJsonParse(e: JsonParseError, instance: string, base: string, opts: EngineOptions): RtcHttpResponse<ProblemDetailBody> {
  return {
    status: 400,
    body: problema(400, ERRO_SISTEMA_TITULO, `${base}/errors/${ERRO_SISTEMA_PATH}`, e.message, instance, opts),
    headers: {},
  };
}

// ───────────────────────────── utilitários da operação ─────────────────────────────

function dataFatoGerador(op: OperacaoIn): string {
  if (op.dhFatoGerador !== null) return op.dhFatoGerador.slice(0, 10);
  if (op.dataHoraEmissao !== null) return op.dataHoraEmissao.slice(0, 10);
  throw ex.dataFatoGeradorNaoInformada();
}

function operacaoConsumo(r: RtcRepos, op: OperacaoIn, data: string): OperacaoConsumoDomain | undefined {
  if (op.gCompraGov === null) return undefined;
  const g: CompraGovernamentalDomain = {
    tpEnteGov: op.gCompraGov.tpEnteGov as TpEnteGov,
    pRedutor: formatarAliquota(r.buscarValorRedutor(op.gCompraGov.tpEnteGov, data)),
  };
  if (op.gCompraGov.tpOperGov !== null) g.tpOperGov = op.gCompraGov.tpOperGov as TpOperGov;
  return { gCompraGov: g };
}

/** AvisoDadosSimuladosService.getWarningDadosSimulados -> valor do header ou null. */
// Literais do Java: AvisoDadosSimuladosService.java:27 (2026-12-31), :38 (CSTs "010","220","221"), :49 (2025-12-31), :53 (2027-01-01);
// valores do header: TipoWarningDadosSimulados.java (CASO_GERAL=1 ... CASO_CALCULOS_SIMULADOS=6).
function avisoDadosSimulados(op: OperacaoIn, data: string): string | null {
  if (data > "2026-12-31") return "6"; // CASO_CALCULOS_SIMULADOS
  const fictiaias = (op.itens ?? []).some((i) => i.cst === "010" || i.cst === "220" || i.cst === "221");
  if (fictiaias && data > "2025-12-31") return "5"; // CASO_ALIQUOTAS_FICTICIAS
  if (data < "2027-01-01") return null;
  return "1"; // inalcançável (datas >= 2027 já retornaram 6)
}

function headersOk(r: RtcRepos, op: OperacaoIn, data: string): RtcResponseHeaders {
  const h: RtcResponseHeaders = { "x-calc-app-version": RTC_APP_VERSION, "x-calc-db-version": r.d.versaoBase };
  const w = avisoDadosSimulados(op, data);
  if (w !== null) h["x-warning-dados-simulados"] = w;
  return h;
}

// ───────────────────────────── POST /calculadora/observabilidade/regime-geral ─────────────────────────────

export function processarObservabilidade(r: RtcRepos, raw: unknown, opts: EngineOptions = {}): RtcHttpResponse {
  const base = opts.baseUrl ?? "http://localhost";
  let op: OperacaoIn;
  try {
    op = parseOperacao(raw);
  } catch (e) {
    if (e instanceof JsonParseError) return respostaJsonParse(e, PATH_OBS, base, opts);
    throw e;
  }

  const erro422 = (erros: ErroDetalhe[]): RtcHttpResponse<ProblemDetailBody> => ({
    status: 422,
    body: problema(
      422,
      "Erros no processamento do cálculo",
      "about:blank",
      `O cálculo contém ${erros.length} erro(s).`,
      PATH_OBS,
      opts,
      erros,
    ),
    headers: {},
  });

  // Bean Validation dos campos globais (id, versao, municipio, uf, tpDoc, gCompraGov, itens)
  const globais = validarOperacao(op).filter((v) => !v.path.startsWith("itens[") && !v.path.startsWith("itens."));
  if (globais.length > 0) {
    return erro422(
      globais.map((v) => {
        const c = codigoDaAnotacao(v.annotation);
        return {
          type: `${base}/calculadora/observabilidade/erros?codigo=${c.code}`,
          title: c.titulo,
          code: c.code,
          pointer: paraJsonPointer(v.path),
          detail: detalheValidacao(v.path, v.message, v.invalid),
        };
      }),
    );
  }

  let data: string;
  let tipoDfe: TipoDfe | null;
  try {
    if (op.uf === null) op.uf = r.buscarUfPorMunicipio(op.municipio!);
    r.validarUf(op.uf);
    r.validarMunicipio(op.municipio!, op.uf);
    data = dataFatoGerador(op);
    tipoDfe = r.buscarTipoDfe(op.tpDoc, data);
  } catch (e) {
    return erro422([erroDeExcecao(e, -1, base).erro]);
  }

  const itens = op.itens!;
  const resultados: Array<ObservabilidadeItemDomain & { _calc?: ObjetoCalc }> = [];
  itens.forEach((item, index) => {
    const nObj = item.numero !== null ? item.numero : index + 1;
    const violations = validarItem(item);
    if (violations.length > 0) {
      const erros: ErroDetalhe[] = violations.map((v) => {
        const c = codigoDaAnotacao(v.annotation);
        return {
          type: `${base}/api/calculadora/observabilidade/erros?codigo=${c.code}`,
          title: c.titulo,
          code: c.code,
          pointer: `#/itens/${index}/${v.path}`,
          detail: detalheValidacao(v.path, v.message, v.invalid),
        };
      });
      resultados.push({ nObj, estadoItem: "INCONSISTENCIA_ENTRADA", erros });
      return;
    }
    try {
      const tribCalc = processarItem(r, { uf: op.uf!, municipio: op.municipio!, tpEnteGov: op.gCompraGov?.tpEnteGov ?? null }, item, data, tipoDfe);
      resultados.push({
        nObj,
        estadoItem: item.aliquotasNominais === null ? "CALCULADO" : "CALCULO_SIMULADO",
        tribCalc: sTributos(tribCalc),
        _calc: { nObj, tribCalc },
      });
    } catch (e) {
      if (e instanceof MotorLocalNaoValidadoError) throw e;
      const { estado, erro } = erroDeExcecao(e, index, base);
      resultados.push({ nObj, estadoItem: estado, erros: [erro] });
    }
  });

  resultados.sort((a, b) => a.nObj - b.nObj); // sorted(Comparator.comparing(nObj)) — estável
  const calculados = resultados.filter((x) => x._calc).map((x) => x._calc!);
  const total = calculados.length === 0 ? undefined : totais(calculados);

  const objetos: ObservabilidadeItemDomain[] = resultados.map((x) => {
    const o: ObservabilidadeItemDomain = { nObj: x.nObj, estadoItem: x.estadoItem };
    if (x.tribCalc) o.tribCalc = x.tribCalc;
    if (x.erros) o.erros = x.erros;
    return o;
  });

  const body: ObservabilidadeROCDomain = { objetos };
  const oper = operacaoConsumo(r, op, data);
  const out: ObservabilidadeROCDomain = clean({ oper, objetos: body.objetos, total });
  return { status: 200, body: out, headers: headersOk(r, op, data) };
}

// ───────────────────────────── POST /calculadora/regime-geral ─────────────────────────────

export function calcularRegimeGeral(r: RtcRepos, raw: unknown, opts: EngineOptions = {}): RtcHttpResponse {
  const base = opts.baseUrl ?? "http://localhost";
  let op: OperacaoIn;
  try {
    op = parseOperacao(raw);
  } catch (e) {
    if (e instanceof JsonParseError) return respostaJsonParse(e, PATH_RG, base, opts);
    throw e;
  }

  // @Valid @RequestBody: MethodArgumentNotValidException -> 400 "Campos inválidos."
  const violacoes = validarCorpoCompleto(op);
  if (violacoes.length > 0) {
    let detail = "Um ou mais campos são inválidos - ";
    for (const v of violacoes) detail += `[${v.path}: ${v.message}] `;
    return {
      status: 400,
      body: problema(400, "Campos inválidos.", `${base}/errors/${ERRO_SISTEMA_PATH}`, detail, PATH_RG, opts),
      headers: {},
    };
  }

  try {
    if (op.uf === null) op.uf = r.buscarUfPorMunicipio(op.municipio!);
    r.validarUf(op.uf);
    r.validarMunicipio(op.municipio!, op.uf);
    const data = dataFatoGerador(op);
    const tipoDfe = r.buscarTipoDfe(op.tpDoc, data);

    const detalhes: Array<ObjetoCalc & { simulado: boolean }> = [];
    for (const item of op.itens!) {
      const tribCalc = processarItem(r, { uf: op.uf, municipio: op.municipio!, tpEnteGov: op.gCompraGov?.tpEnteGov ?? null }, item, data, tipoDfe);
      detalhes.push({ nObj: item.numero!, tribCalc, simulado: item.aliquotasNominais !== null });
    }
    detalhes.sort((a, b) => a.nObj - b.nObj);

    const objetos: ObjetoDomain[] = detalhes.map((d) => ({
      nObj: d.nObj,
      tribCalc: sTributos(d.tribCalc),
      calculoSimulado: d.simulado,
    }));
    const oper = operacaoConsumo(r, op, data);
    const out: ROCDomain = clean({ oper, objetos, total: totais(detalhes) });
    return { status: 200, body: out, headers: headersOk(r, op, data) };
  } catch (e) {
    if (e instanceof MotorLocalNaoValidadoError) throw e;
    return respostaErroHttp(e, PATH_RG, base, opts);
  }
}

export type { ItemIn };
