/**
 * Cálculo de CBS/IBS/IS por item. Port de:
 *  - domain/service/calculotributo/CalculoCbsIbsService.java
 *  - domain/service/calculotributo/CalculoImpostoSeletivoService.java
 *  - domain/service/calculotributo/CalculoTributoService.java
 *  - domain/service/MemoriaCalculoService.java (+ token/TemplateTokenizerService e TokenizerService)
 *  - api/model/roc/TributacaoCompraGovernamentalDomain.java (getValoresEfetivos)
 *
 * Política numérica (ADR003 do motor oficial): conta exata, cada número publicado é arredondado UMA vez:
 * base a 2 casas, alíquota/alíquota efetiva a 4 casas (pontos percentuais) e é o número publicado que entra
 * na conta seguinte; valor = arred2(vBC x alíquota publicada / 100). Modo HALF_EVEN (ArredondamentoUtils.MODO).
 *
 * O que NÃO é calculado (o Java também não): tratamentos com ajuste/monofasia (TRTR_IN_POSSUI_AJUSTE) lançam
 * ErroFaltaImplementacao (CAL-007). Ramos de monofasia, que o Java só alcança com tratamentos que já foram
 * rejeitados por esse motivo, lançam MotorLocalNaoValidadoError em vez de calcular.
 */
import {
  Dec,
  D,
  ZERO,
  ONE,
  arredondarAliquotaPublicada,
  arredondarValorFiscal,
  formatarMoedaPtBr,
  formatarPercentualPtBr,
  fracaoParaPercentual,
  jstr,
  movePointRight2,
  percentualParaFracao,
} from "./jdecimal";
import { evaluate, Variaveis } from "./expression";
import { ex, MotorLocalNaoValidadoError } from "./errors";
import type { RtcRepos, TratamentoClassificacaoDTO } from "./data";
import type { ItemIn } from "./input";

// ───────────────────────────── modelos internos ─────────────────────────────

export interface ReducaoAliquota {
  pRedAliq: Dec | null;
  pAliqEfet: Dec | null;
}
export interface Diferimento {
  pDif: Dec;
  vDif: Dec;
}
export interface TributacaoRegularOut {
  cst: string;
  cClassTrib: string;
  baseCalculo: Dec;
  aliquotaEfetiva: Dec | null;
  tributoDevido: Dec;
}
/** TributacaoCompraGovernamentalDomain: campos com @Builder.Default ZERO. */
export interface CompraGov {
  pAliqIBSUF: Dec | null;
  vTribIBSUF: Dec | null;
  pAliqIBSMun: Dec | null;
  vTribIBSMun: Dec | null;
  pAliqCBS: Dec | null;
  vTribCBS: Dec | null;
}
export interface CbsIbsOutput {
  aliquota: Dec | null;
  baseCalculo: Dec | null;
  quantidade: Dec | null;
  tributoCalculado: Dec | null;
  tributoDevido: Dec | null;
  grupoReducao: ReducaoAliquota | null;
  tributacaoRegular: TributacaoRegularOut | null;
  compraGovernamental: CompraGov | null;
  grupoDiferimento: Diferimento | null;
}
export interface ImpostoSeletivoOut {
  CSTIS: string;
  cClassTribIS: string;
  qTrib: Dec | null;
  uTrib: string | null;
  vIS: Dec | null;
  pIS: Dec | null;
  pISEspec: Dec | null;
  adRemIS: Dec | null;
  vBCIS: Dec;
  memoriaCalculo: string | null;
}
export interface GrupoIbsCbsOut {
  vBC: Dec | null;
  gIBSUF: { pIBSUF: Dec | null; gDif: Diferimento | null; gRed: ReducaoAliquota | null; vIBSUF: Dec | null } | null;
  gIBSMun: { pIBSMun: Dec | null; gDif: Diferimento | null; gRed: ReducaoAliquota | null; vIBSMun: Dec | null } | null;
  vIBS: Dec;
  gCBS: { pCBS: Dec | null; gDif: Diferimento | null; gRed: ReducaoAliquota | null; vCBS: Dec | null } | null;
  gTribRegular: {
    CSTReg: string;
    cClassTribReg: string;
    pAliqEfetRegIBSUF: Dec | null;
    vTribRegIBSUF: Dec | null;
    pAliqEfetRegIBSMun: Dec | null;
    vTribRegIBSMun: Dec | null;
    pAliqEfetRegCBS: Dec | null;
    vTribRegCBS: Dec | null;
  } | null;
  gTribCompraGov: CompraGov | null;
}
export interface TributosOut {
  IS: ImpostoSeletivoOut | null;
  IBSCBS: {
    CST: string;
    cClassTrib: string;
    gIBSCBS: GrupoIbsCbsOut | null;
    memoriaCalculo: { cbs: string | null; ibsUF: string | null; ibsMun: string | null } | null;
  };
}

export interface AliquotaIS {
  aliquotaAdValorem: Dec | null;
  aliquotaAdRem: Dec | null;
  unidadeMedida: string | null;
}
export interface TratamentoClassificacaoModel {
  cbsIbs: TratamentoClassificacaoDTO;
  is: TratamentoClassificacaoDTO | null;
  desoneracao: TratamentoClassificacaoDTO | null;
  aliquotaIS: AliquotaIS | null;
  temDesoneracao: boolean;
}
export interface OperacaoModel {
  data: string;
  codigoMunicipio: number;
  codigoUf: number;
  tpEnteGov: number | null;
  pRedutor: Dec;
  item: ItemWork;
  tratamento: TratamentoClassificacaoModel;
}
/** Item após os defaults do ProcessamentoItemService (quantidade=1, unidade="UN") e derivações de base. */
export interface ItemWork extends Omit<ItemIn, "cst" | "cClassTrib" | "numero" | "quantidade" | "unidade"> {
  numero: number;
  cst: string;
  cClassTrib: string;
  quantidade: Dec;
  unidade: string;
}

// ───────────────────────────── utilitários ─────────────────────────────

const isNotBlank = (s: string | null | undefined): s is string => s !== null && s !== undefined && s.trim() !== "";

/** entry(c, v): valores nulos viram ZERO (requireNonNullElse). */
function vars(entries: Record<string, Dec | null | undefined>): Variaveis {
  const out: Variaveis = {};
  for (const [k, v] of Object.entries(entries)) out[k] = v ?? ZERO;
  return out;
}

/** publicarAliquota: fração -> pp, arred a 4 casas, de volta a fração. Nulo permanece nulo. */
function publicarAliquota(fracao: Dec | null): Dec | null {
  return percentualParaFracao(arredondarAliquotaPublicada(fracaoParaPercentual(fracao)));
}

/** Aritmética que o Java faz com Dec nulo: multiplicar() devolve nulo se algum operando for nulo. */
const multiplicar = (a: Dec | null, b: Dec | null): Dec | null => (a === null || b === null ? null : a.mul(b));

function npe(what: string): never {
  throw ex.sistema(`NullPointerException: ${what}`);
}

// ───────────────────────────── CalculoCbsIbsService ─────────────────────────────

const TRIBUTOS = {
  CBS: { id: 2, nome: "CBS" },
  IBS_ESTADUAL: { id: 3, nome: "IBS Estadual" },
  IBS_MUNICIPAL: { id: 4, nome: "IBS Municipal" },
} as const;
type TributoKey = keyof typeof TRIBUTOS;

function aliquotaNominal(tributo: TributoKey, item: ItemWork): Dec | null {
  const n = item.aliquotasNominais;
  if (!n) return null;
  switch (tributo) {
    case "CBS":
      return n.cbs;
    case "IBS_ESTADUAL":
      return n.ibsEstadual;
    case "IBS_MUNICIPAL":
      return n.ibsMunicipal;
  }
}

/** `expressaoAliquota.matches(".*\\baliquota\\b.*")`. */
const expressaoUsaAliquota = (e: string | null) => isNotBlank(e) && /\baliquota\b/.test(e);

function calcularCbsIbs(
  r: RtcRepos,
  tributo: TributoKey,
  codigoUf: number | null,
  codigoMunicipio: number | null,
  item: ItemWork,
  tc: TratamentoClassificacaoDTO,
  impostoSeletivoCalculado: Dec,
  temTributacaoRegular: boolean,
  data: string,
  tpEnteGov: number | null,
  pRedutorCompraGov: Dec,
): CbsIbsOutput | null {
  const idTributo = TRIBUTOS[tributo].id;
  let cst: string | null = null;
  let cClassTrib: string | null = null;

  const tt = r.buscarTratamentoTributario(tc.idTratamentoTributario);
  const cl = r.buscarClassificacaoCalculo(tc.idClassificacaoTributaria);
  const situacao = r.consultarSituacaoPorCodigo(item.cst, idTributo, data);

  if (temTributacaoRegular) {
    cst = item.tributacaoRegular!.cst;
    cClassTrib = item.tributacaoRegular!.cClassTrib;
  }

  if (tt.inPossuiAjuste) {
    throw ex.erroFaltaImplementacao(cl.codigo);
  }

  const possuiPercentualReducao = tt.inPossuiPercentualReducao;
  let valorPercentualReducao: Dec | null = null;

  const baseCalculoInformada = item.baseCalculo;
  const quantidade = item.quantidade;
  let impostoSeletivoInformado: Dec | null = null;
  if (item.impostoSeletivo) {
    impostoSeletivoInformado = item.impostoSeletivo.impostoInformado ?? ZERO;
  }

  let valorAliquota: Dec | null = null;
  const valorAjuste: Dec | null = null;
  const valorRedutor: Dec | null = null;
  const valorAliquotaPadraoOuReferencia: Dec | null = null;
  const valorAliquotaReferencia: Dec | null = null;
  const valorAliquotaAdValorem: Dec | null = null;
  const valorAliquotaAdRem: Dec | null = null;
  const valorAliquotaAdRemPrincipal: Dec | null = null;
  const valorAliquotaAdRemSecundaria: Dec | null = null;
  const variacaoPontoPercentual: Dec | null = null;
  const pBio: Dec | null = null;
  const pDif: Dec | null = null;

  let resultadoAliquota: Dec | null = null;
  let resultadoAliquotaEfetiva: Dec | null = null;
  let resultadoBaseCalculo: Dec;
  let resultadoTributoDevido: Dec | null = null;
  let resultadoPercentualDiferimento: Dec | null = null;
  let resultadoValorDiferimento: Dec | null = null;

  if (possuiPercentualReducao) {
    const percentualReducao = r.buscarPercentualReducao(cl.id, idTributo, data);
    valorPercentualReducao = percentualParaFracao(percentualReducao);
  }

  // CalculoCbsIbsService.java:209-215 ("ajuste para 510001"): literal "510001" tratado como tipo de alíquota Padrão
  const tipoAliquota = cl.codigo === "510001" ? "Padrão" : cl.tipoAliquota;

  const aliquotaInformada = aliquotaNominal(tributo, item);
  let aliquotaInformadaAplicada = false;
  let aliquotaDivididaPorCem = false;

  switch (tipoAliquota) {
    case "Padrão":
      if (aliquotaInformada !== null) {
        valorAliquota = percentualParaFracao(aliquotaInformada);
        aliquotaInformadaAplicada = true;
      } else {
        valorAliquota = percentualParaFracao(r.buscarAliquotaPadrao(idTributo, codigoUf, codigoMunicipio, data).valorAplicavel);
      }
      aliquotaDivididaPorCem = true;
      break;
    case "Uniforme nacional (referência)":
      if (aliquotaInformada !== null) {
        valorAliquota = percentualParaFracao(aliquotaInformada);
        aliquotaInformadaAplicada = true;
      } else {
        valorAliquota = percentualParaFracao(r.buscarAliquotaReferencia(idTributo, data));
      }
      aliquotaDivididaPorCem = true;
      break;
    case "Uniforme setorial":
      if (tt.inPossuiMonofasia) {
        throw new MotorLocalNaoValidadoError(
          { cClassTrib: cl.codigo, condicao: "Uniforme setorial com monofasia (não calculado pelo motor oficial: CAL-007)" },
        );
      } else {
        if (aliquotaInformada !== null) {
          valorAliquota = percentualParaFracao(aliquotaInformada);
          aliquotaInformadaAplicada = true;
        } else {
          let a = r.buscarAdValoremServico(item.nbs, idTributo, cl.id, data);
          if (a === null) {
            a = r.buscarAdValoremPorClassificacao(idTributo, cl.id, data);
            if (a === null) throw ex.erroGenerico("Alíquota uniforme setorial não encontrada em " + data);
          }
          valorAliquota = percentualParaFracao(a);
        }
        aliquotaDivididaPorCem = true;
      }
      break;
    case "Fixa":
      if (aliquotaInformada !== null) {
        valorAliquota = percentualParaFracao(aliquotaInformada);
        aliquotaInformadaAplicada = true;
      } else {
        const fixa = r.buscarAdValoremPorClassificacao(idTributo, cl.id, data);
        if (fixa === null) throw ex.erroGenerico("Alíquota fixa não encontrada em " + data);
        valorAliquota = percentualParaFracao(fixa);
      }
      aliquotaDivididaPorCem = true;
      break;
    case "Sem alíquota":
      if (aliquotaInformada !== null) {
        valorAliquota = percentualParaFracao(aliquotaInformada);
        aliquotaInformadaAplicada = true;
        aliquotaDivididaPorCem = true;
      } else {
        // fixar o valor 0 no tratamento tributário, por enquanto
        valorAliquota = ZERO;
      }
      break;
    case "Alíquotas Combinadas (Ad Valorem e Ad Rem)":
      // "para fazer" no Java: nada é atribuído
      break;
    default:
      throw ex.tipoAliquotaDesconhecido(tipoAliquota, cClassTrib, cst);
  }

  const base = {
    quantidade,
    percentualReducao: valorPercentualReducao,
    aliquotaPadraoOuReferencia: valorAliquotaPadraoOuReferencia,
    aliquotaReferencia: valorAliquotaReferencia,
    aliquotaAdValorem: valorAliquotaAdValorem,
    aliquotaAdRem: valorAliquotaAdRem,
    ajuste: valorAjuste,
    redutor: valorRedutor,
    aliquotaAdRemPrincipal: valorAliquotaAdRemPrincipal,
    aliquotaAdRemSecundaria: valorAliquotaAdRemSecundaria,
    variacaoPontoPercentual,
    pBio,
    percentualDiferimento: pDif,
  };

  if (aliquotaInformadaAplicada && !expressaoUsaAliquota(tt.expressaoAliquota)) {
    // A alíquota nominal informada prevalece sobre uma expressão fixa persistida, como "0" ou "2.08/100".
    resultadoAliquota = valorAliquota;
  } else if (isNotBlank(tt.expressaoAliquota)) {
    resultadoAliquota = evaluate(tt.expressaoAliquota, vars({ ...base, aliquota: valorAliquota }));
  }

  if (aliquotaDivididaPorCem) {
    // a alíquota vai ao documento com até 4 casas e é ela que segue na conta
    resultadoAliquota = publicarAliquota(resultadoAliquota);
  }

  if (isNotBlank(tt.expressaoAliquotaEfetiva)) {
    resultadoAliquotaEfetiva = evaluate(
      tt.expressaoAliquotaEfetiva,
      vars({ ...base, aliquota: resultadoAliquota, pRedutorCompraGov }),
    );
    if (aliquotaDivididaPorCem) {
      // alíquota efetiva: arredondada uma vez a 4 casas; é ela que multiplica a base
      resultadoAliquotaEfetiva = publicarAliquota(resultadoAliquotaEfetiva);
    }
  }

  const comuns = {
    ...base,
    quantidade,
    aliquota: resultadoAliquota,
    aliquotaEfetiva: resultadoAliquotaEfetiva,
    impostoSeletivoInformado,
    baseCalculoInformada,
    impostoSeletivoCalculado,
  };

  resultadoBaseCalculo = evaluate(tt.expressaoBaseCalculo!, vars(comuns));
  if (!tt.inPossuiMonofasia) {
    // a base é arredondada a 2 casas antes de multiplicar (na monofasia é uma quantidade)
    resultadoBaseCalculo = arredondarValorFiscal(resultadoBaseCalculo);
  }
  if (resultadoBaseCalculo.isNegative() && !resultadoBaseCalculo.isZero()) {
    resultadoBaseCalculo = ZERO;
  }

  // conta exata sobre os números publicados (base e alíquota efetiva), arredondada uma vez
  const tributoCalculadoExato = evaluate(tt.expressaoTributoCalculado!, vars({ ...comuns, baseCalculo: resultadoBaseCalculo }));
  const resultadoTributoCalculado = arredondarValorFiscal(tributoCalculadoExato);

  if (isNotBlank(tt.expressaoTributoDevido)) {
    resultadoTributoDevido = arredondarValorFiscal(
      evaluate(
        tt.expressaoTributoDevido,
        vars({ ...comuns, baseCalculo: resultadoBaseCalculo, tributoCalculado: resultadoTributoCalculado }),
      ),
    );
  }

  if (isNotBlank(tt.expressaoPercentualDiferimento) && isNotBlank(tt.expressaoValorDiferimento)) {
    const v5 = vars({
      tributoCalculado: resultadoTributoCalculado,
      quantidade,
      baseCalculo: resultadoBaseCalculo,
      aliquota: resultadoAliquota,
      aliquotaEfetiva: resultadoAliquotaEfetiva,
      baseCalculoInformada,
      impostoSeletivoInformado,
      impostoSeletivoCalculado,
      percentualReducao: valorPercentualReducao,
      aliquotaPadraoOuReferencia: valorAliquotaPadraoOuReferencia,
      aliquotaReferencia: valorAliquotaReferencia,
      aliquotaAdValorem: valorAliquotaAdValorem,
      aliquotaAdRem: valorAliquotaAdRem,
      ajuste: valorAjuste,
      redutor: valorRedutor,
    });
    // pDif publicado com até 4 casas (em pontos percentuais)
    resultadoPercentualDiferimento = publicarAliquota(evaluate(tt.expressaoPercentualDiferimento, v5));

    // vDif = arred2(vBC x alíquota publicada / 100 x pDif / 100): a expressão recebe o tributo calculado
    // exato, e o produto é arredondado uma única vez
    const v6 = vars({
      percentualDiferimento: resultadoPercentualDiferimento,
      tributoCalculado: tributoCalculadoExato,
      quantidade,
      baseCalculo: resultadoBaseCalculo,
      aliquota: resultadoAliquota,
      aliquotaEfetiva: resultadoAliquotaEfetiva,
      baseCalculoInformada,
      impostoSeletivoInformado,
      impostoSeletivoCalculado,
      percentualReducao: valorPercentualReducao,
      aliquotaPadraoOuReferencia: valorAliquotaPadraoOuReferencia,
      aliquotaReferencia: valorAliquotaReferencia,
      aliquotaAdValorem: valorAliquotaAdValorem,
      aliquotaAdRem: valorAliquotaAdRem,
      ajuste: valorAjuste,
      redutor: valorRedutor,
    });
    resultadoValorDiferimento = arredondarValorFiscal(evaluate(tt.expressaoValorDiferimento, v6));

    // valor devido: o tributo calculado menos o diferimento, descontado uma única vez
    resultadoTributoDevido = resultadoTributoCalculado.minus(resultadoValorDiferimento);
    if (resultadoTributoDevido.isNegative() && !resultadoTributoDevido.isZero()) resultadoTributoDevido = ZERO;
  }

  if (situacao === null) npe('"situacaoTributaria" is null');
  if (!situacao.inGrupoIbsCbs) {
    return null;
  }

  if (cl.inGrupoMonofasiaPadrao || cl.inGrupoMonofasiaReten || cl.inGrupoMonofasiaRet || cl.inGrupoMonofasiaDiferimento) {
    throw new MotorLocalNaoValidadoError({ cClassTrib: cl.codigo, condicao: "classificação com grupo de monofasia" });
  }

  const grupoReducao =
    !cl.inGrupoReducao || (temTributacaoRegular && tpEnteGov === null)
      ? null
      : obterGrupoReducao(cl.inGrupoReducao, resultadoAliquotaEfetiva, valorPercentualReducao, aliquotaDivididaPorCem);

  const compraGovernamental = obterGrupoCompraGov(tpEnteGov, tributo, resultadoAliquotaEfetiva, resultadoTributoDevido);

  const tributacaoRegular = temTributacaoRegular
    ? obterGrupoDesoneracao(
        cst!,
        cClassTrib!,
        resultadoBaseCalculo,
        resultadoAliquota,
        valorPercentualReducao ?? ZERO,
        aliquotaDivididaPorCem,
        possuiPercentualReducao,
      )
    : null;

  const grupoDiferimento =
    resultadoValorDiferimento === null || resultadoPercentualDiferimento === null
      ? null
      : { vDif: resultadoValorDiferimento, pDif: movePointRight2(resultadoPercentualDiferimento) };

  return {
    grupoReducao,
    compraGovernamental,
    tributacaoRegular,
    grupoDiferimento,
    tributoCalculado: temTributacaoRegular ? ZERO : resultadoTributoCalculado,
    tributoDevido: temTributacaoRegular ? ZERO : resultadoTributoDevido,
    aliquota: temTributacaoRegular
      ? ZERO
      : aliquotaDivididaPorCem && resultadoAliquota !== null
        ? movePointRight2(resultadoAliquota)
        : resultadoAliquota,
    baseCalculo: resultadoBaseCalculo,
    quantidade,
  };
}

function obterGrupoCompraGov(tpEnteGov: number | null, t: TributoKey, aliquota: Dec | null, valor: Dec | null): CompraGov | null {
  if (tpEnteGov === null) return null;
  const b: CompraGov = {
    pAliqIBSUF: ZERO,
    vTribIBSUF: ZERO,
    pAliqIBSMun: ZERO,
    vTribIBSMun: ZERO,
    pAliqCBS: ZERO,
    vTribCBS: ZERO,
  };
  if (aliquota === null) npe('"aliquota" is null');
  switch (t) {
    case "CBS":
      b.pAliqCBS = movePointRight2(aliquota); // nao divide por 100
      b.vTribCBS = valor;
      break;
    case "IBS_ESTADUAL":
      b.pAliqIBSUF = movePointRight2(aliquota);
      b.vTribIBSUF = valor;
      break;
    case "IBS_MUNICIPAL":
      b.pAliqIBSMun = movePointRight2(aliquota);
      b.vTribIBSMun = valor;
      break;
  }
  return b;
}

function obterGrupoReducao(
  inGrupoReducao: boolean,
  aliquotaEfetiva: Dec | null,
  percentualReducao: Dec | null,
  aliquotaDivididaPorCem: boolean,
): ReducaoAliquota | null {
  if (percentualReducao === null || aliquotaEfetiva === null || !inGrupoReducao) return null;
  return {
    pRedAliq: movePointRight2(percentualReducao), // para nao enviar o percentual dividido por 100
    pAliqEfet: aliquotaDivididaPorCem ? movePointRight2(aliquotaEfetiva) : aliquotaEfetiva,
  };
}

function obterGrupoDesoneracao(
  cst: string,
  cClassTrib: string,
  baseCalculo: Dec,
  aliquota: Dec | null,
  percentualReducao: Dec,
  aliquotaDivididaPorCem: boolean,
  possuiPercentualReducao: boolean,
): TributacaoRegularOut {
  let aliquotaEfetiva: Dec | null = aliquota;
  if (possuiPercentualReducao) {
    const redutor = ONE.minus(percentualReducao);
    aliquotaEfetiva = multiplicar(aliquota, redutor);
  }
  if (aliquotaDivididaPorCem) {
    // alíquota efetiva da tributação regular: 4 casas, e é ela que multiplica a base
    aliquotaEfetiva = publicarAliquota(aliquotaEfetiva);
  }
  const tributoDevido = arredondarValorFiscal(multiplicar(baseCalculo, aliquotaEfetiva) ?? npe('"aliquotaEfetiva" is null'));
  return {
    cst,
    cClassTrib,
    baseCalculo,
    aliquotaEfetiva: aliquotaEfetiva === null ? null : aliquotaDivididaPorCem ? movePointRight2(aliquotaEfetiva) : aliquotaEfetiva,
    tributoDevido,
  };
}

// ───────────────────────────── CalculoImpostoSeletivoService ─────────────────────────────

function calcularImpostoSeletivo(
  r: RtcRepos,
  item: ItemWork,
  tc: TratamentoClassificacaoDTO,
  aliquota: AliquotaIS,
): ImpostoSeletivoOut {
  const tt = r.buscarTratamentoTributario(tc.idTratamentoTributario);
  const is = item.impostoSeletivo!;
  const baseCalculoInformada = is.baseCalculo;
  const quantidade = is.quantidade;
  const impostoSeletivoInformado = is.impostoInformado ?? ZERO;

  // alíquotas publicadas (4 casas): são elas que entram na conta
  let valorAliquotaAdValorem = arredondarAliquotaPublicada(aliquota.aliquotaAdValorem);
  if (valorAliquotaAdValorem !== null) valorAliquotaAdValorem = percentualParaFracao(valorAliquotaAdValorem);
  const valorAliquotaAdRem = arredondarAliquotaPublicada(aliquota.aliquotaAdRem);

  const comuns = {
    quantidade,
    aliquota: null,
    aliquotaEfetiva: null,
    baseCalculoInformada,
    impostoSeletivoInformado,
    impostoSeletivoCalculado: ZERO,
    percentualReducao: null,
    aliquotaPadraoOuReferencia: null,
    aliquotaReferencia: null,
    aliquotaAdValorem: valorAliquotaAdValorem,
    aliquotaAdRem: valorAliquotaAdRem,
    ajuste: null,
    redutor: null,
  };

  // base publicada (2 casas): é ela que entra na conta
  const resultadoBaseCalculo = arredondarValorFiscal(evaluate(tt.expressaoBaseCalculo!, vars(comuns)));
  // conta exata sobre os números publicados, arredondada uma vez
  const resultadoTributoCalculado = arredondarValorFiscal(
    evaluate(tt.expressaoTributoCalculado!, vars({ ...comuns, baseCalculo: resultadoBaseCalculo })),
  );
  let resultadoTributoDevido: Dec | null = null;
  if (isNotBlank(tt.expressaoTributoDevido)) {
    resultadoTributoDevido = arredondarValorFiscal(
      evaluate(
        tt.expressaoTributoDevido,
        vars({ ...comuns, baseCalculo: resultadoBaseCalculo, tributoCalculado: resultadoTributoCalculado }),
      ),
    );
  }

  return {
    CSTIS: is.cst!,
    cClassTribIS: is.cClassTrib!,
    qTrib: quantidade,
    uTrib: is.unidade,
    vIS: resultadoTributoDevido,
    pIS: fracaoParaPercentual(valorAliquotaAdValorem), // para nao enviar a aliquota ad valorem dividida por 100
    pISEspec: valorAliquotaAdRem, // depreciado, mantido para compatibilidade
    adRemIS: valorAliquotaAdRem,
    vBCIS: resultadoBaseCalculo,
    memoriaCalculo: null,
  };
}

// ───────────────────────────── MemoriaCalculoService ─────────────────────────────

/** TemplateTokenizerService.tokenize + TokenizerService.substituirPlaceholders. */
export function substituirPlaceholders(template: string, values: Record<string, string>): string {
  if (!template.includes("[")) return template;
  let out = "";
  let last = 0;
  const len = template.length;
  while (last < len) {
    const open = template.indexOf("[", last);
    if (open < 0) {
      out += template.slice(last);
      break;
    }
    const close = template.indexOf("]", open + 1);
    if (close < 0) {
      out += template.slice(last);
      break;
    }
    if (open > last) out += template.slice(last, open);
    const key = template.slice(open + 1, close);
    out += Object.prototype.hasOwnProperty.call(values, key) ? values[key] : "";
    last = close + 1;
  }
  return out;
}

const TEXTO_SEM_MEMORIA = "Texto de memória de cálculo não encontrado";

function gerarMemoriaCbsIbs(
  r: RtcRepos,
  tc: TratamentoClassificacaoDTO,
  tributoIn: CbsIbsOutput | null,
  baseCalculoInformada: Dec | null,
  quantidade: Dec | null,
  unidade: string | null,
  data: string,
): string {
  // CST sem gIBSCBS (ex.: imunidade 410): usa a base informada no item e alíquota zero
  const tributo: CbsIbsOutput =
    tributoIn ??
    ({
      baseCalculo: baseCalculoInformada,
      aliquota: null,
      grupoReducao: null,
      grupoDiferimento: null,
    } as CbsIbsOutput);

  const fund = r.buscarFundamentacao(tc.idClassificacaoTributaria, data);
  const tt = r.buscarTratamentoTributario(tc.idTratamentoTributario);

  const valores: Record<string, string> = {
    norma: fund.textoCurto ?? "",
    tratamento: tt.descricao ?? "",
    base_calculo: formatarMoedaPtBr(tributo.baseCalculo),
    aliquota_ad_valorem: formatarPercentualPtBr(tributo.aliquota),
    aliquota_ad_rem: formatarPercentualPtBr(null), // somente monofasia
    quantidade: quantidade !== null ? jstr(quantidade) : "0",
    unidade: unidade ?? "",
    percentual_reducao:
      tributo.grupoReducao && tributo.grupoReducao.pRedAliq !== null
        ? formatarPercentualPtBr(tributo.grupoReducao.pRedAliq)
        : formatarPercentualPtBr(null),
    percentual_diferimento: tributo.grupoDiferimento ? formatarPercentualPtBr(tributo.grupoDiferimento.pDif) : formatarPercentualPtBr(null),
    valor_diferimento: tributo.grupoDiferimento ? formatarMoedaPtBr(tributo.grupoDiferimento.vDif) : formatarMoedaPtBr(null),
    aliquota_desoneracao: formatarPercentualPtBr(null),
    montante_desoneracao: formatarMoedaPtBr(null),
  };
  const texto = fund.memoriaCalculo;
  return !isNotBlank(texto) ? TEXTO_SEM_MEMORIA : substituirPlaceholders(texto, valores);
}

function gerarMemoriaImpostoSeletivo(
  r: RtcRepos,
  tc: TratamentoClassificacaoDTO,
  tributo: ImpostoSeletivoOut,
  quantidade: Dec | null,
  unidade: string | null,
  data: string,
): void {
  const fund = r.buscarFundamentacao(tc.idClassificacaoTributaria, data);
  const tt = r.buscarTratamentoTributario(tc.idTratamentoTributario);
  const valores: Record<string, string> = {
    norma: fund.textoCurto ?? "",
    tratamento: tt.descricao ?? "",
    base_calculo: formatarMoedaPtBr(tributo.vBCIS),
    aliquota_ad_valorem: formatarPercentualPtBr(tributo.pIS),
    aliquota_ad_rem: formatarPercentualPtBr(tributo.pISEspec),
    quantidade: quantidade !== null ? jstr(quantidade) : "",
    unidade: unidade ?? "",
  };
  const texto = fund.memoriaCalculo;
  tributo.memoriaCalculo = !isNotBlank(texto) ? TEXTO_SEM_MEMORIA : substituirPlaceholders(texto, valores);
}

// ───────────────────────────── CalculoTributoService ─────────────────────────────

/** TributacaoCompraGovernamentalDomain.getValoresEfetivos. */
function valoresEfetivos(
  cg: CompraGov,
  tpEnteGov: number,
  pTransferenciaCBS: Dec,
  dataFatoGerador: string,
  vBC: Dec,
): CompraGov {
  // TributacaoCompraGovernamentalDomain.java:109 (LocalDate.of(2027, 1, 1))
  if (dataFatoGerador < "2027-01-01") {
    // antes de 2027, cada um fica com os seus proprios valores
    return cg;
  }
  const pCBS = cg.pAliqCBS ?? ZERO;
  const pUF = cg.pAliqIBSUF ?? ZERO;
  const pMun = cg.pAliqIBSMun ?? ZERO;
  const soma = pCBS.plus(pUF).plus(pMun);
  // TipoEnteGovernamental.tipoEnteEquivalente(): 1=União; 2,3=Estado; 4,5,6=Município
  const uniao = tpEnteGov === 1;
  const estado = tpEnteGov === 2 || tpEnteGov === 3;
  const municipio = tpEnteGov === 4 || tpEnteGov === 5 || tpEnteGov === 6;
  if (uniao) {
    // se uniao compra, fica com tudo - estados e municipios ficam com zero
    return comAliquotas(soma, ZERO, ZERO, vBC);
  }
  // Estado ou Município compra: fica com o IBS do outro ente e (possivelmente) com parte da CBS.
  // pAliqCBS = arred4(pAliqCBS - (pAliqCBS * pTransferenciaCBS / 100)); quem recebe fecha pela diferença.
  const pAliqCBSFinal = arredondarAliquotaPublicada(pCBS.minus(pCBS.mul(percentualParaFracao(pTransferenciaCBS)!)));
  const recebedor = soma.minus(pAliqCBSFinal);
  if (estado) return comAliquotas(pAliqCBSFinal, recebedor, ZERO, vBC);
  if (municipio) return comAliquotas(pAliqCBSFinal, ZERO, recebedor, vBC);
  return comAliquotas(pAliqCBSFinal, ZERO, ZERO, vBC);
}
function comAliquotas(pCBS: Dec, pUF: Dec, pMun: Dec, vBC: Dec): CompraGov {
  const v = (a: Dec) => arredondarValorFiscal(vBC.mul(percentualParaFracao(a)!));
  return {
    pAliqCBS: pCBS,
    vTribCBS: v(pCBS),
    pAliqIBSUF: pUF,
    vTribIBSUF: v(pUF),
    pAliqIBSMun: pMun,
    vTribIBSMun: v(pMun),
  };
}

/**
 * Leva ao grupo principal de um tributo o resultado da redistribuição da compra governamental
 * (CalculoTributoService.trataImpactoCompraGov).
 */
function trataImpactoCompraGov(tributo: CbsIbsOutput | null, aliquotaEfetiva: Dec | null, valor: Dec | null, vBC: Dec): void {
  if (tributo === null) return;
  let grupoReducao = tributo.grupoReducao;
  if (grupoReducao === null) {
    grupoReducao = { pRedAliq: ZERO, pAliqEfet: null };
    tributo.grupoReducao = grupoReducao;
  }
  const tr = tributo.tributacaoRegular;
  if (tr !== null) {
    // possui suspensao
    grupoReducao.pRedAliq = ZERO;
    grupoReducao.pAliqEfet = ZERO;
    tributo.tributoDevido = ZERO;
    tr.aliquotaEfetiva = aliquotaEfetiva;
    tr.tributoDevido = valor!;
    return;
  }
  grupoReducao.pAliqEfet = aliquotaEfetiva;
  const dif = tributo.grupoDiferimento;
  if (dif === null) {
    tributo.tributoDevido = valor;
    return;
  }
  const frac = percentualParaFracao(aliquotaEfetiva)!;
  const bruto = arredondarValorFiscal(vBC.mul(frac));
  const vDif = arredondarValorFiscal(vBC.mul(frac).mul(percentualParaFracao(dif.pDif)!));
  dif.vDif = vDif;
  const devido = bruto.minus(vDif);
  tributo.tributoDevido = devido.isNegative() && !devido.isZero() ? ZERO : devido;
}

export function calcularTributos(r: RtcRepos, op: OperacaoModel): TributosOut {
  const { item, data } = op;
  const tcCbsIbs = op.tratamento.cbsIbs;
  const tcIS = op.tratamento.is;
  const temDesoneracao = op.tratamento.temDesoneracao;
  const tcDesoneracao = temDesoneracao ? op.tratamento.desoneracao : null;
  // memória de cálculo usa o tratamento da suspensão quando há desoneração
  const tcMemoria = temDesoneracao ? tcDesoneracao! : tcCbsIbs;

  let impostoSeletivo: ImpostoSeletivoOut | null = null;
  if (tcIS !== null) {
    impostoSeletivo = calcularImpostoSeletivo(r, item, tcIS, op.tratamento.aliquotaIS!);
    gerarMemoriaImpostoSeletivo(r, tcIS, impostoSeletivo, item.impostoSeletivo!.quantidade, item.impostoSeletivo!.unidade, data);
  }

  const impostoSeletivoCalculado = impostoSeletivo !== null ? (impostoSeletivo.vIS ?? ZERO) : ZERO;

  // Java: três CompletableFutures; aqui em sequência (CBS, IBS UF, IBS Município). O primeiro erro prevalece.
  const cbs = calcularCbsIbs(r, "CBS", null, null, item, tcCbsIbs, impostoSeletivoCalculado, temDesoneracao, data, op.tpEnteGov, op.pRedutor);
  const ibsEstadual = calcularCbsIbs(r, "IBS_ESTADUAL", op.codigoUf, null, item, tcCbsIbs, impostoSeletivoCalculado, temDesoneracao, data, op.tpEnteGov, op.pRedutor);
  const ibsMunicipal = calcularCbsIbs(r, "IBS_MUNICIPAL", null, op.codigoMunicipio, item, tcCbsIbs, impostoSeletivoCalculado, temDesoneracao, data, op.tpEnteGov, op.pRedutor);

  const baseCalculo = item.baseCalculo;
  const memoria = {
    cbs: gerarMemoriaCbsIbs(r, tcMemoria, cbs, baseCalculo, item.quantidade, item.unidade, data),
    ibsUF: gerarMemoriaCbsIbs(r, tcMemoria, ibsEstadual, baseCalculo, item.quantidade, item.unidade, data),
    ibsMun: gerarMemoriaCbsIbs(r, tcMemoria, ibsMunicipal, baseCalculo, item.quantidade, item.unidade, data),
  };

  const gIBSCBS = montarGIBSCBS(r, cbs, ibsEstadual, ibsMunicipal, op.tpEnteGov, data);

  return {
    IS: impostoSeletivo,
    IBSCBS: { CST: item.cst, cClassTrib: item.cClassTrib, gIBSCBS, memoriaCalculo: memoria },
  };
}

function montarGIBSCBS(
  r: RtcRepos,
  cbs: CbsIbsOutput | null,
  ibsEstadual: CbsIbsOutput | null,
  ibsMunicipal: CbsIbsOutput | null,
  tpEnteGov: number | null,
  data: string,
): GrupoIbsCbsOut | null {
  // CST sem gIBSCBS (ex.: imunidade): nenhum tributo foi calculado, não gera grupo.
  if (cbs === null && ibsEstadual === null && ibsMunicipal === null) return null;

  const vBC = ibsMunicipal?.baseCalculo ?? ibsEstadual?.baseCalculo ?? cbs?.baseCalculo ?? null;
  const pTransferenciaCBS = r.buscarPercentualTransferenciaCbs(data);
  const compraGovernamental = consolidarCompraGov(cbs, ibsEstadual, ibsMunicipal);
  const efetiva =
    compraGovernamental === null || tpEnteGov === null ? null : valoresEfetivos(compraGovernamental, tpEnteGov, pTransferenciaCBS, data, vBC!);

  if (efetiva !== null) {
    trataImpactoCompraGov(cbs, efetiva.pAliqCBS, efetiva.vTribCBS, vBC!);
    trataImpactoCompraGov(ibsEstadual, efetiva.pAliqIBSUF, efetiva.vTribIBSUF, vBC!);
    trataImpactoCompraGov(ibsMunicipal, efetiva.pAliqIBSMun, efetiva.vTribIBSMun, vBC!);
  }

  const gIBSUF = ibsEstadual
    ? { pIBSUF: ibsEstadual.aliquota, gDif: ibsEstadual.grupoDiferimento, gRed: ibsEstadual.grupoReducao, vIBSUF: ibsEstadual.tributoDevido }
    : null;
  const gIBSMun = ibsMunicipal
    ? { pIBSMun: ibsMunicipal.aliquota, gDif: ibsMunicipal.grupoDiferimento, gRed: ibsMunicipal.grupoReducao, vIBSMun: ibsMunicipal.tributoDevido }
    : null;
  const vIBS = (gIBSUF ? (gIBSUF.vIBSUF ?? ZERO) : ZERO).plus(gIBSMun ? (gIBSMun.vIBSMun ?? ZERO) : ZERO);
  const gCBS = cbs ? { pCBS: cbs.aliquota, gDif: cbs.grupoDiferimento, gRed: cbs.grupoReducao, vCBS: cbs.tributoDevido } : null;
  const gTribRegular = consolidarTributacaoRegular(cbs, ibsEstadual, ibsMunicipal);

  if (gTribRegular !== null && compraGovernamental !== null) {
    // suspensao com compra gov - zera valores
    compraGovernamental.pAliqIBSUF = ZERO;
    compraGovernamental.vTribIBSUF = ZERO;
    compraGovernamental.pAliqIBSMun = ZERO;
    compraGovernamental.vTribIBSMun = ZERO;
    compraGovernamental.pAliqCBS = ZERO;
    compraGovernamental.vTribCBS = ZERO;
  }

  return { vBC, gIBSUF, gIBSMun, vIBS, gCBS, gTribRegular, gTribCompraGov: compraGovernamental };
}

/** getCompraGovernamental: merge dos grupos de compra governamental de cada tributo. */
function consolidarCompraGov(
  cbs: CbsIbsOutput | null,
  uf: CbsIbsOutput | null,
  mun: CbsIbsOutput | null,
): CompraGov | null {
  const a = cbs?.compraGovernamental ?? null;
  const b = uf?.compraGovernamental ?? null;
  const c = mun?.compraGovernamental ?? null;
  if (a && b && c) {
    return {
      pAliqCBS: a.pAliqCBS,
      vTribCBS: a.vTribCBS,
      pAliqIBSUF: b.pAliqIBSUF,
      vTribIBSUF: b.vTribIBSUF,
      pAliqIBSMun: c.pAliqIBSMun,
      vTribIBSMun: c.vTribIBSMun,
    };
  }
  if (a || b || c) {
    throw ex.sistema("Erro ao consolidar valores de compras governamentais. Algum dos tributos não calculou compra governamental.");
  }
  return null;
}

/**
 * getTributacaoRegular: encadeamento CBS -> IBS UF -> IBS Município. Como no Java, cada etapa devolve nulo
 * (descartando o builder) quando o respectivo tributo não tem tributação regular.
 */
function consolidarTributacaoRegular(
  cbs: CbsIbsOutput | null,
  uf: CbsIbsOutput | null,
  mun: CbsIbsOutput | null,
): GrupoIbsCbsOut["gTribRegular"] {
  type B = NonNullable<GrupoIbsCbsOut["gTribRegular"]>;
  let b: B | null = null;
  if (cbs?.tributacaoRegular) {
    const tr = cbs.tributacaoRegular;
    b = {
      CSTReg: tr.cst,
      cClassTribReg: tr.cClassTrib,
      pAliqEfetRegIBSUF: ZERO,
      vTribRegIBSUF: ZERO,
      pAliqEfetRegIBSMun: ZERO,
      vTribRegIBSMun: ZERO,
      pAliqEfetRegCBS: tr.aliquotaEfetiva,
      vTribRegCBS: tr.tributoDevido,
    };
  }
  if (uf?.tributacaoRegular) {
    const tr = uf.tributacaoRegular;
    if (b === null) {
      b = {
        CSTReg: tr.cst,
        cClassTribReg: tr.cClassTrib,
        pAliqEfetRegIBSUF: ZERO,
        vTribRegIBSUF: ZERO,
        pAliqEfetRegIBSMun: ZERO,
        vTribRegIBSMun: ZERO,
        pAliqEfetRegCBS: ZERO,
        vTribRegCBS: ZERO,
      };
    }
    b.pAliqEfetRegIBSUF = tr.aliquotaEfetiva;
    b.vTribRegIBSUF = tr.tributoDevido;
  } else {
    b = null;
  }
  if (mun?.tributacaoRegular) {
    const tr = mun.tributacaoRegular;
    if (b === null) {
      b = {
        CSTReg: tr.cst,
        cClassTribReg: tr.cClassTrib,
        pAliqEfetRegIBSUF: ZERO,
        vTribRegIBSUF: ZERO,
        pAliqEfetRegIBSMun: ZERO,
        vTribRegIBSMun: ZERO,
        pAliqEfetRegCBS: ZERO,
        vTribRegCBS: ZERO,
      };
    }
    b.pAliqEfetRegIBSMun = tr.aliquotaEfetiva;
    b.vTribRegIBSMun = tr.tributoDevido;
  } else {
    b = null;
  }
  return b;
}

// silencia import não usado em builds que removem tree-shaking
void D;
