import { CODIGOS_VSN } from "./codigos";
import type { ItemCollector } from "./collector";
import type { AtividadeSn, SituacaoIss, Vocabulario } from "./data";
import { ALIQUOTA_ZERO, type AliquotaDecimal } from "./decimal";
import { inteiroTolerante, isBlank } from "./java-compat";
import type { MotivoResolucaoAliquota, RegraAliquotaSimples, TipoAliquotaSimples } from "./official-types";

/**
 * Port de `EscolhaParAliquotasService` (+ modelos `LinhaAliquotasSimples`, `AliquotasAnexoSimples`,
 * `ParAliquotasSimples`): escolha do par de alíquotas (com/sem redistribuição do ISS) e avaliação dos
 * campos do ISS. Componente PURO.
 *
 * Regras, na ordem de avaliação (a primeira que se aplica decide):
 * DOCUMENTO, ATIVIDADE_NAO_TRIBUTADA, ANEXO_SEM_ISS, ISS_FORA_DO_SIMPLES, ATIVIDADE_SEM_ISS,
 * ISS_NAO_INCIDE, ISENCAO_MUNICIPAL, ISS_RETIDO, PADRAO.
 */

export const CAMPO_CRT = "CRT";
export const CAMPO_REGAPIBSCBSSN = "regApIBSCBSSN";
export const CAMPO_REGAPTRIBSN = "regApTribSN";
export const CAMPO_TRIBISSQN = "tribISSQN";
export const CAMPO_TPRETISSQN = "tpRetISSQN";
export const CAMPO_TPBM = "tpBM";

const DOMINIO_TRIBISSQN = new Set([1, 2, 3, 4]);
const DOMINIO_TPRETISSQN = new Set([1, 2, 3]);
const DOMINIO_TPBM = new Set([1, 2, 3, 4]);
const TRIBUTAVEL = 1;
const ISENCAO = 1;
const RETIDO = new Set([2, 3]);

/** `ParAliquotasSimples` (pontos percentuais; qualquer um pode ser nulo). */
export interface ParAliquotas {
  pCBSSN: AliquotaDecimal | null;
  pIBSSN: AliquotaDecimal | null;
}

export const PAR_ZERO: ParAliquotas = { pCBSSN: ALIQUOTA_ZERO, pIBSSN: ALIQUOTA_ZERO };

/** `AliquotasAnexoSimples`. */
export interface AliquotasAnexo {
  par: ParAliquotas | null;
  semRedistribuicaoISS: ParAliquotas | null;
}

/** `LinhaAliquotasSimples` (origem sempre REQUISICAO no contrato não assistido). */
export interface LinhaAliquotas {
  fatorR: boolean | null;
  impedimentoSublimite: boolean;
  anexoI: AliquotasAnexo | null;
  anexoII: AliquotasAnexo | null;
  anexoIII: AliquotasAnexo | null;
  anexoIV: AliquotasAnexo | null;
  anexoV: AliquotasAnexo | null;
}

export function anexoDaLinha(linha: LinhaAliquotas, anexo: string): AliquotasAnexo | null {
  switch (anexo) {
    case "I":
      return linha.anexoI;
    case "II":
      return linha.anexoII;
    case "III":
      return linha.anexoIII;
    case "IV":
      return linha.anexoIV;
    case "V":
      return linha.anexoV;
    default:
      throw new Error(`Anexo inválido: ${anexo}`);
  }
}

export const anexoComIss = (anexo: string) => anexo === "III" || anexo === "IV" || anexo === "V";

export interface CamposIssItem {
  tribISSQN: string | null;
  tpRetISSQN: string | null;
  tpBM: string | null;
}

export interface AvaliacaoIssItem {
  tribISSQN: number | null;
  tpRetISSQN: number | null;
  tpBM: number | null;
  avisos: string[];
}

export interface EscolhaParAliquotas {
  anexo: string | null;
  tipoAliquota: TipoAliquotaSimples | null;
  regra: RegraAliquotaSimples | null;
  par: ParAliquotas | null;
  parSemRedistribuicaoAusente: boolean;
  caminhoPar: string | null;
  motivo: MotivoResolucaoAliquota;
}

const informado = (v: string | null | undefined) => !isBlank(v);

/**
 * Avalia os campos do ISS do item. Só é chamada para item com atividade válida e regime que calcula
 * tributos; os erros vão para o coletor do item.
 */
export function avaliarCamposIss(
  vocabulario: Vocabulario,
  atividade: AtividadeSn,
  campos: CamposIssItem,
  collector: ItemCollector,
): AvaliacaoIssItem {
  const avisos: string[] = [];
  const tribInformado = informado(campos.tribISSQN);
  const retInformado = informado(campos.tpRetISSQN);
  const bmInformado = informado(campos.tpBM);

  if (vocabulario !== "NFSE") {
    const desconsiderados: string[] = [];
    if (tribInformado) desconsiderados.push(CAMPO_TRIBISSQN);
    if (retInformado) desconsiderados.push(CAMPO_TPRETISSQN);
    if (bmInformado) desconsiderados.push(CAMPO_TPBM);
    if (desconsiderados.length > 0) {
      avisos.push(`${desconsiderados.join(", ")} desconsiderado(s): os campos do ISS só valem na NFS-e.`);
    }
    return { tribISSQN: null, tpRetISSQN: null, tpBM: null, avisos };
  }

  const issNoSimples = atividade.issNoSimples;
  const cAtivSN = atividade.cAtivSN;

  // tribISSQN
  let tribISSQN = inteiroTolerante(campos.tribISSQN);
  if (tribInformado && (tribISSQN == null || !DOMINIO_TRIBISSQN.has(tribISSQN))) {
    collector.addErroValidacao(
      CODIGOS_VSN.TRIBISSQN_INVALIDO,
      CAMPO_TRIBISSQN,
      `A tributação do ISSQN (tribISSQN) deve ser 1, 2, 3 ou 4, recebido: '${campos.tribISSQN}'.`,
    );
    tribISSQN = null;
  } else if (!tribInformado && issNoSimples) {
    collector.addErroValidacao(
      CODIGOS_VSN.TRIBISSQN_INVALIDO,
      CAMPO_TRIBISSQN,
      `A tributação do ISSQN (tribISSQN) é obrigatória para a atividade ${cAtivSN}, que tem ISS no Simples Nacional.`,
    );
  }

  // tpRetISSQN
  let tpRetISSQN: number | null = null;
  if (retInformado && tribISSQN != null && tribISSQN !== TRIBUTAVEL) {
    avisos.push(
      `tpRetISSQN desconsiderado: não há retenção do ISS com tribISSQN ${tribISSQN} (a NFS-e recusaria a combinação: regra E0580).`,
    );
  } else if (retInformado) {
    tpRetISSQN = inteiroTolerante(campos.tpRetISSQN);
    if (tpRetISSQN == null || !DOMINIO_TPRETISSQN.has(tpRetISSQN)) {
      collector.addErroValidacao(
        CODIGOS_VSN.TPRETISSQN_INVALIDO,
        CAMPO_TPRETISSQN,
        `O tipo de retenção do ISSQN (tpRetISSQN) deve ser 1, 2 ou 3, recebido: '${campos.tpRetISSQN}'.`,
      );
      tpRetISSQN = null;
    }
  } else if (issNoSimples && tribISSQN === TRIBUTAVEL) {
    collector.addErroValidacao(
      CODIGOS_VSN.TPRETISSQN_INVALIDO,
      CAMPO_TPRETISSQN,
      `O tipo de retenção do ISSQN (tpRetISSQN) é obrigatório com tribISSQN = 1 na atividade ${cAtivSN}, que tem ISS no Simples Nacional.`,
    );
  }

  // tpBM
  let tpBM: number | null = null;
  if (bmInformado && !atividade.admiteBeneficioMunicipal) {
    avisos.push(
      `tpBM desconsiderado: a atividade ${cAtivSN} não admite benefício municipal do ISS (regra E0536 da NFS-e: só os subitens 7.02 e 7.05, atividades 12 e 13).`,
    );
  } else if (bmInformado) {
    tpBM = inteiroTolerante(campos.tpBM);
    if (tpBM == null || !DOMINIO_TPBM.has(tpBM)) {
      collector.addErroValidacao(
        CODIGOS_VSN.TPBM_INVALIDO,
        CAMPO_TPBM,
        `O tipo de benefício municipal (tpBM) deve ser 1, 2, 3 ou 4, recebido: '${campos.tpBM}'.`,
      );
      tpBM = null;
    }
  }

  if (tpBM === ISENCAO && tpRetISSQN != null && RETIDO.has(tpRetISSQN)) {
    avisos.push(
      `tpBM 1 (isenção) com tpRetISSQN ${tpRetISSQN}: combinação recusada pela NFS-e (regra E0594); vale a isenção municipal (par sem redistribuição).`,
    );
  }
  return { tribISSQN, tpRetISSQN, tpBM, avisos };
}

function escolhido(
  anexo: string,
  tipo: TipoAliquotaSimples,
  regra: RegraAliquotaSimples,
  par: ParAliquotas | null,
  semAusente: boolean,
  caminho: string,
): EscolhaParAliquotas {
  const motivo: MotivoResolucaoAliquota = par == null || par.pCBSSN == null ? "ANEXO_SEM_ALIQUOTA" : "RESOLVIDA";
  return { anexo, tipoAliquota: tipo, regra, par, parSemRedistribuicaoAusente: semAusente, caminhoPar: caminho, motivo };
}

/** Primeira situação vigente da regra cujo campo tem, no documento, o valor da linha. */
function situacao(regra: string, fatos: Map<string, number>, situacoes: SituacaoIss[]): SituacaoIss | null {
  return situacoes.find((s) => s.regra === regra && s.valor === fatos.get(s.campo)) ?? null;
}

/** Escolhe o anexo e o par de alíquotas do item. */
export function escolher(
  atividade: AtividadeSn,
  admissivel: boolean,
  linha: LinhaAliquotas,
  fatos: Map<string, number>,
  situacoes: SituacaoIss[],
): EscolhaParAliquotas {
  // Regra 1 — DOCUMENTO.
  if (!admissivel) {
    return {
      anexo: null,
      tipoAliquota: null,
      regra: "DOCUMENTO",
      par: null,
      parSemRedistribuicaoAusente: false,
      caminhoPar: null,
      motivo: "ATIVIDADE_INADMISSIVEL_NO_DOCUMENTO",
    };
  }

  // Regra 2 — ATIVIDADE_NAO_TRIBUTADA: atividade sem anexo (código 90).
  const anexoComFatorR = atividade.anexoComFatorR;
  const anexoSemFatorR = atividade.anexoSemFatorR;
  if (anexoComFatorR == null && anexoSemFatorR == null) {
    return {
      anexo: null,
      tipoAliquota: "SEM_ALIQUOTA",
      regra: "ATIVIDADE_NAO_TRIBUTADA",
      par: PAR_ZERO,
      parSemRedistribuicaoAusente: false,
      caminhoPar: null,
      motivo: "ATIVIDADE_SEM_ANEXO",
    };
  }

  // Anexo: "sem fator r", ou "com fator r" na atividade sujeita ao fator r.
  let anexo = anexoSemFatorR as string;
  if (anexoComFatorR != null) {
    if (linha.fatorR == null) {
      return {
        anexo: null,
        tipoAliquota: null,
        regra: null,
        par: null,
        parSemRedistribuicaoAusente: false,
        caminhoPar: null,
        motivo: "FATOR_R_AUSENTE",
      };
    }
    anexo = linha.fatorR ? anexoComFatorR : (anexoSemFatorR as string);
  }
  const aliquotasAnexo = anexoDaLinha(linha, anexo);
  const parDoAnexo = aliquotasAnexo == null ? null : aliquotasAnexo.par;
  const caminhoAnexo = `anexo${anexo}`;

  // Regra 3 — ANEXO_SEM_ISS: anexos I e II têm um só par.
  if (!anexoComIss(anexo)) {
    return escolhido(anexo, "PAR_UNICO", "ANEXO_SEM_ISS", parDoAnexo, false, caminhoAnexo);
  }

  // Regras 4 a 9: anexos III, IV e V.
  let regra: RegraAliquotaSimples = "PADRAO";
  let tipo: TipoAliquotaSimples = "COM_REDISTRIBUICAO";
  let s: SituacaoIss | null;
  if (linha.impedimentoSublimite) {
    // Regra 4 — o impedimento vem da linha de alíquotas, não do documento.
    regra = "ISS_FORA_DO_SIMPLES";
    tipo = "SEM_REDISTRIBUICAO";
  } else if ((s = situacao("ISS_FORA_DO_SIMPLES", fatos, situacoes)) != null) {
    regra = s.regra as RegraAliquotaSimples;
    tipo = s.tipoAliquota as TipoAliquotaSimples;
  } else if (!atividade.issNoSimples) {
    // Regra 5 — atividade sem ISS no Simples (indicador do catálogo).
    regra = "ATIVIDADE_SEM_ISS";
    tipo = "SEM_REDISTRIBUICAO";
  } else {
    // Regras 6, 7 e 8, nesta ordem.
    for (const candidata of ["ISS_NAO_INCIDE", "ISENCAO_MUNICIPAL", "ISS_RETIDO"]) {
      s = situacao(candidata, fatos, situacoes);
      if (s != null) {
        regra = s.regra as RegraAliquotaSimples;
        tipo = s.tipoAliquota as TipoAliquotaSimples;
        break;
      }
    }
  }

  if (tipo !== "SEM_REDISTRIBUICAO") {
    return escolhido(anexo, tipo, regra, parDoAnexo, false, caminhoAnexo);
  }
  // Par sem redistribuição nulo: igual ao par com.
  const sem = aliquotasAnexo == null ? null : aliquotasAnexo.semRedistribuicaoISS;
  if (sem == null) {
    return escolhido(anexo, tipo, regra, parDoAnexo, true, caminhoAnexo);
  }
  return escolhido(anexo, tipo, regra, sem, false, `${caminhoAnexo}/semRedistribuicaoISS`);
}

/** Aviso do item quando o par sem redistribuição faltou e valeu o par com. */
export function avisoParSemRedistribuicaoAusente(anexo: string | null): string {
  return `Par sem redistribuição do ISS ausente no anexo ${anexo}; aplicado o par com redistribuição, igual quando o ISS não passa do teto.`;
}
