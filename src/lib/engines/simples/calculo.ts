import type { RegimeApuracao, TipoReceitaBruta, DestinoValor } from "./data";
import {
  UM,
  ZERO,
  arredondarAliquota,
  arredondarValorFiscal,
  formatarAliquota,
  formatarMoeda,
  moedaPtBr,
  percentualPtBr,
  percentualParaFracao,
  totalizar,
  type AliquotaDecimal,
  type Dec,
} from "./decimal";
import type { EstadoItemSimples, MotivoEstadoSimplesDomain, TributosSimplesDomain } from "./official-types";

/**
 * Port de `SimplesNacionalCalculoService` (NT 2026.005, seções 5.3.2 a 5.3.4): serviço PURO.
 * Aritmética exata; cada valor de item é arredondado UMA vez a 2 casas (HALF_EVEN) e o total do item é a
 * soma desses valores fiscais.
 */

export interface InsumoCalculoSimples {
  regime: RegimeApuracao;
  tipoReceitaBruta: TipoReceitaBruta;
  motivoNaoCalculo: MotivoEstadoSimplesDomain | null;
  baseCalculo: Dec | null;
  valorImpostoSeletivo: Dec | null;
  pIBSSN: AliquotaDecimal | null;
  pCBSSN: AliquotaDecimal | null;
  tpEnteGov: number | null;
  fatorTransicaoCompraGov: Dec | null;
  casasAliquotaCalculo: number | null;
}

export interface ResultadoCalculoSimples {
  estadoItem: EstadoItemSimples;
  motivoEstado: MotivoEstadoSimplesDomain | null;
  tribCalc: TributosSimplesDomain;
}

interface ParAliquotas {
  pIBSSN: Dec | null;
  pCBSSN: Dec | null;
}

interface ValorTributo {
  devido: Dec;
  pendenteSuspenso: Dec;
}

/** Descrição dos motivos de NAO_CALCULADO (`MotivoNaoCalculoSimplesEnum`). */
export const MOTIVOS_NAO_CALCULO = {
  REGIME_SOMENTE_RECEITA: (): MotivoEstadoSimplesDomain => ({
    codigo: "REGIME_SOMENTE_RECEITA",
    descricao:
      "O optante apura o IBS e a CBS pelo regime regular, fora do Simples Nacional; o item leva ao Simples apenas a receita bruta.",
  }),
  CATIVSN_AUSENTE: (): MotivoEstadoSimplesDomain => ({
    codigo: "CATIVSN_AUSENTE",
    descricao:
      "O código de atividade do Simples Nacional (cAtivSN) não foi informado; sem ele o IBS e a CBS do item não são calculados (NT 2026.005, §5.3.3).",
  }),
  CATIVSN_DESCONHECIDO: (codigo: string): MotivoEstadoSimplesDomain => ({
    codigo: "CATIVSN_DESCONHECIDO",
    descricao: `O código de atividade '${codigo}' não existe ou não está vigente na data do fato gerador; o IBS e a CBS do item não são calculados.`,
  }),
  CATIVSN_INADMISSIVEL_NO_DOCUMENTO: (codigo: string, sigla: string, tpDoc: number): MotivoEstadoSimplesDomain => ({
    codigo: "CATIVSN_INADMISSIVEL_NO_DOCUMENTO",
    descricao: `A atividade '${codigo}' não é admitida no tipo de documento ${sigla} (tpDoc ${tpDoc}); o IBS e a CBS do item não são calculados.`,
  }),
  ANEXO_SEM_ALIQUOTA_CBS: (anexo: string): MotivoEstadoSimplesDomain => ({
    codigo: "ANEXO_SEM_ALIQUOTA_CBS",
    descricao: `A Tabela de Alíquotas Efetivas do Simples Nacional não traz a alíquota de CBS do Anexo ${anexo} para o contribuinte no período; o IBS e a CBS do item não são calculados.`,
  }),
} as const;

function memoriaCalculo(
  tipo: TipoReceitaBruta,
  vRBSNitem: Dec,
  vBC: Dec,
  aliquota: Dec | null,
  valor: ValorTributo,
): string {
  return (
    `Receita bruta do Simples Nacional de R$ ${moedaPtBr(vRBSNitem)} (${tipo.descricao}). ` +
    `A base de cálculo utilizada é de R$ ${moedaPtBr(vBC)}, com alíquota efetiva de ${percentualPtBr(aliquota)}%. ` +
    `Valor devido de R$ ${moedaPtBr(valor.devido)} e pendente/suspenso de R$ ${moedaPtBr(valor.pendenteSuspenso)}.`
  );
}

/** Passo 2: deslocamento CBS↔IBS em compras governamentais (arts. 372 e 473 da LC 214/2025). */
function aplicarDeslocamentoCbsIbs(a: ParAliquotas, tpEnteGov: number | null, fator: Dec | null): ParAliquotas {
  if (tpEnteGov == null || (a.pIBSSN == null && a.pCBSSN == null)) return a;
  const pIbs = a.pIBSSN ?? ZERO;
  const pCbs = a.pCBSSN ?? ZERO;
  if (tpEnteGov === 1) {
    // União: pCBS' = pCBS + pIBS; pIBS' = 0.
    return { pIBSSN: ZERO, pCBSSN: totalizar([pCbs, pIbs]) };
  }
  if (fator == null) {
    throw new Error(`Fator de transição de compra governamental não resolvido para tpEnteGov ${tpEnteGov}`);
  }
  // pIBS' = pIBS + f × pCBS; pCBS' = (1 − f) × pCBS.
  return { pIBSSN: totalizar([pIbs, fator.times(pCbs)]), pCBSSN: UM.minus(fator).times(pCbs) };
}

/** Passo 3: alíquota do leiaute (NFS-e: 2 casas), depois da transformação. */
function arredondarAliquotasDoLeiaute(a: ParAliquotas, casas: number | null): ParAliquotas {
  if (casas == null) return a;
  return { pIBSSN: arredondarAliquota(a.pIBSSN, casas), pCBSSN: arredondarAliquota(a.pCBSSN, casas) };
}

/** Valor EXATO do tributo: vRBSNitem × fatorReceita × (alíquota / 100). */
function valorTributo(vRBSNitem: Dec, fatorReceita: Dec, aliquota: Dec | null): Dec {
  if (aliquota == null || fatorReceita.isZero()) return ZERO;
  return vRBSNitem.times(fatorReceita).times(percentualParaFracao(aliquota));
}

function repartirPorRegime(regime: RegimeApuracao, valor: Dec, pendenteSuspenso: boolean): ValorTributo {
  const destino: DestinoValor | null = pendenteSuspenso ? regime.destinoPendenteSuspenso : regime.destinoDevido;
  switch (destino) {
    case "DEVIDO":
      return { devido: valor, pendenteSuspenso: ZERO };
    case "PENDENTE_SUSPENSO":
      return { devido: ZERO, pendenteSuspenso: valor };
    case "ZERO":
      return { devido: ZERO, pendenteSuspenso: ZERO };
    default:
      // switch sobre enum nulo no Java lança NullPointerException.
      throw new Error("Cannot invoke \"Object.ordinal()\" because the destination is null");
  }
}

/** PONTO ÚNICO DE DECISÃO DE FLUXO DE CÁLCULO (`SimplesNacionalCalculoService.calcularItem`). */
export function calcularItem(insumo: InsumoCalculoSimples): ResultadoCalculoSimples {
  const tipoReceita = insumo.tipoReceitaBruta;

  // Receita bruta do item (campo P26): vIS só compõe a receita quando a linha vigente do tpRBSN o determina.
  const vRBSNitem = tipoReceita.compoeReceita
    ? arredondarValorFiscal(
        totalizar(
          (tipoReceita.impostoSeletivoCompoeReceita
            ? [insumo.baseCalculo, insumo.valorImpostoSeletivo]
            : [insumo.baseCalculo]
          ).filter((v): v is Dec => v != null),
        ),
      )
    : ZERO;

  // Regime que não calcula tributos ou item não calculável: NAO_CALCULADO (não é erro). O regime tem precedência.
  const motivo = insumo.regime.calculaTributos === false ? MOTIVOS_NAO_CALCULO.REGIME_SOMENTE_RECEITA() : insumo.motivoNaoCalculo;
  if (motivo != null) {
    return {
      estadoItem: "NAO_CALCULADO",
      motivoEstado: motivo,
      tribCalc: {
        vRBSNitem: formatarMoeda(vRBSNitem),
        tpRBSN: tipoReceita.codigo,
        tpRBSNDescricao: tipoReceita.descricao,
      },
    };
  }

  const aliquotas = arredondarAliquotasDoLeiaute(
    aplicarDeslocamentoCbsIbs(
      { pIBSSN: insumo.pIBSSN?.d ?? null, pCBSSN: insumo.pCBSSN?.d ?? null },
      insumo.tpEnteGov,
      insumo.fatorTransicaoCompraGov,
    ),
    insumo.casasAliquotaCalculo,
  );

  const fatorReceita = tipoReceita.fatorReceita;
  const pendenteSuspenso = tipoReceita.pendenteSuspenso;

  // vBC é apresentação: o tributo incide sobre vRBSNitem × fator exato, não sobre o vBC arredondado.
  const vBC = arredondarValorFiscal(vRBSNitem.times(fatorReceita));

  const valorIbs = arredondarValorFiscal(valorTributo(vRBSNitem, fatorReceita, aliquotas.pIBSSN));
  const valorCbs = arredondarValorFiscal(valorTributo(vRBSNitem, fatorReceita, aliquotas.pCBSSN));

  // Regime que não gera IBS (CRT=2): os campos de IBS não saem na resposta.
  const geraIbs = insumo.regime.geraIbs === true;
  const ibs = geraIbs ? repartirPorRegime(insumo.regime, valorIbs, pendenteSuspenso) : null;
  const cbs = repartirPorRegime(insumo.regime, valorCbs, pendenteSuspenso);

  const valorIs = insumo.valorImpostoSeletivo;

  // Total do item: somente os valores DEVIDOS + IS.
  const totalItem = totalizar(
    [ibs?.devido ?? null, cbs.devido, valorIs].filter((v): v is Dec => v != null),
  );

  const trib: TributosSimplesDomain = {
    vRBSNitem: formatarMoeda(vRBSNitem),
    tpRBSN: tipoReceita.codigo,
    tpRBSNDescricao: tipoReceita.descricao,
    vBC: formatarMoeda(vBC),
  };
  if (geraIbs && aliquotas.pIBSSN != null) trib.pIBSSN = formatarAliquota(aliquotas.pIBSSN);
  if (ibs) {
    trib.vIBSSN = formatarMoeda(ibs.devido);
    trib.vIBSPendSusp = formatarMoeda(ibs.pendenteSuspenso);
  }
  if (aliquotas.pCBSSN != null) trib.pCBSSN = formatarAliquota(aliquotas.pCBSSN);
  trib.vCBSSN = formatarMoeda(cbs.devido);
  trib.vCBSPendSusp = formatarMoeda(cbs.pendenteSuspenso);
  if (valorIs != null) trib.IS = { valor: formatarMoeda(valorIs) };
  trib.totalItem = formatarMoeda(totalItem);
  trib.memoriaCalculo = {
    cbs: memoriaCalculo(tipoReceita, vRBSNitem, vBC, aliquotas.pCBSSN, cbs),
    ...(ibs ? { ibs: memoriaCalculo(tipoReceita, vRBSNitem, vBC, aliquotas.pIBSSN, ibs) } : {}),
  };

  return { estadoItem: "CALCULADO", motivoEstado: null, tribCalc: trib };
}
