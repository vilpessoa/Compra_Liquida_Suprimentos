/**
 * Processamento de um item. Port de:
 *  - domain/service/ProcessamentoItemService.java
 *  - domain/service/ValidacaoNomenclaturaService.java, NomenclaturaService.java,
 *    NcmAplicavelService.java, NbsAplicavelService.java, TipoDfeClassificacaoService.java
 *  - domain/model/enumeration/SiglasDFeEnum.java
 *
 * A ordem das validações é a do Java: o primeiro erro encerra o item (um único erro por item).
 */
import { ONE, ZERO, Dec, jstr } from "./jdecimal";
import { ex } from "./errors";
import type { RtcRepos, TipoDfe, ClassificacaoDTO, TratamentoClassificacaoDTO } from "./data";
import type { ItemIn } from "./input";
import { calcularTributos, ItemWork, OperacaoModel, TratamentoClassificacaoModel, AliquotaIS, TributosOut } from "./calculo";
import { MotorLocalNaoValidadoError } from "./errors";

const ANO_LIMITE_SUPERIOR_ALIQUOTAS_NOMINAIS = 2027;

const isNullOrEmpty = (s: string | null | undefined) => s === null || s === undefined || s.trim() === "";
const isNotBlank = (s: string | null | undefined): s is string => !isNullOrEmpty(s);
const len = (s: string | null | undefined) => (s === null || s === undefined ? 0 : s.length);
const anoDe = (data: string) => parseInt(data.slice(0, 4), 10);

// ───────────────────────────── SiglasDFeEnum ─────────────────────────────

const SIGLAS: Record<string, string> = {
  NFEABI: "NFe ABI",
  NFE: "NFe",
  NFCE: "NFCe",
  CTE: "CTe",
  CTEOS: "CTe OS",
  CTESIMPLIFICADO: "CT-e Simplificado",
  BPE: "BPe",
  BPETA: "BPe TA",
  BPETM: "BPe TM",
  NF3E: "NF3e",
  NFSE: "NFSe",
  NFSEVIA: "NFSe Via",
  NFCOM: "NFCom",
  DERE: "DERE",
  DIR: "DIR",
  DUIMP: "Duimp",
  NFAG: "NFAg",
  NFGAS: "NFGas",
};
const NCM_APLICAVEL_DFE = new Set(["NFSE", "NFE", "NFCE"]);
const NBS_APLICAVEL_DFE = new Set(["NFSE"]);
const IMPOSTO_SELETIVO_APLICAVEL_DFE = new Set(["NFE", "NFCE"]);
const TRIO_RIGIDO = new Set(["NFE", "NFCE", "NFSE"]);

export const normalizarSigla = (s: string | null) => (s === null ? "" : s.toUpperCase().replace(/[\s\-_]/g, ""));

/** SiglasDFeEnum.getPorSiglaNormalizada: devolve o NOME do enum (chave normalizada). */
function getPorSiglaNormalizada(sigla: string): string {
  const n = normalizarSigla(sigla);
  if (!(n in SIGLAS)) throw ex.siglaDfeNaoEncontrada(sigla);
  return n;
}

// ───────────────────────────── NomenclaturaService ─────────────────────────────

const EXCEPTION_CLASSIFICACOES = new Set(["200038", "515001"]);
type Nomenclatura = "SEM" | "NCM" | "NBS" | "MISTO" | "EXCECAO_NCM" | "EXCECAO_NBS";

function determinarNomenclatura(r: RtcRepos, siglaDfe: string, cClassTrib: string, data: string): Nomenclatura {
  const classificacao = r.buscarClassificacaoCbsIbs(cClassTrib, data);
  const id = classificacao.id;

  // siglaDfeCompativel
  const tipos = r.tiposDfeVinculados(id, data);
  const siglaNormalizada = getPorSiglaNormalizada(siglaDfe);
  const compativel = tipos.some((t) => normalizarSigla(t.sigla) === siglaNormalizada);
  if (!compativel) return "SEM";

  const ncmAplicavel = r.ncmAplicavelTem(id, data);
  const nbsAplicavel = r.nbsAplicavelTem(id, data);

  if (EXCEPTION_CLASSIFICACOES.has(cClassTrib)) {
    const s = getPorSiglaNormalizada(siglaDfe);
    if (s === "NFE" || s === "NFCE") return "EXCECAO_NCM";
    if (s === "NFSE") return "EXCECAO_NBS";
    return "SEM";
  }
  const n = normalizarSigla(siglaDfe);
  // NFe/NFCe: apenas NCM permitido, NBS é ignorado
  if (NCM_APLICAVEL_DFE.has(n) && !NBS_APLICAVEL_DFE.has(n)) return ncmAplicavel ? "NCM" : "SEM";
  // NFSe: ambos NCM e NBS permitidos (pode retornar MISTO)
  if (NBS_APLICAVEL_DFE.has(n)) {
    if (ncmAplicavel && nbsAplicavel) return "MISTO";
    if (ncmAplicavel) return "NCM";
    if (nbsAplicavel) return "NBS";
    return "SEM";
  }
  return "SEM";
}

// ───────────────────────────── NcmAplicavelService / NbsAplicavelService ─────────────────────────────

function criticarNcm(r: RtcRepos, ncm: string, id: number, codigo: string, data: string, tributos: string, tem: boolean) {
  if (!tem) return; // classificação sem anexo: aceitar sem crítica
  if (!r.temNcmAplicavel(ncm, id, data)) throw ex.ncmNaoVinculada(ncm, codigo, tributos);
  if (r.temExcecaoNcmAplicavel(ncm, id, data) && !r.temNcmAplicavelSemExcecao(ncm, id, data)) {
    throw ex.ncmNaoVinculada(ncm, codigo, tributos);
  }
}
function criticarNbs(r: RtcRepos, nbs: string, id: number, codigo: string, data: string, tributos: string, tem: boolean) {
  if (!tem) return;
  if (!r.temNbsAplicavel(nbs, id, data)) throw ex.nbsNaoVinculada(nbs, codigo, tributos);
  if (r.temExcecaoNbsAplicavel(nbs, id, data) && !r.temNbsAplicavelSemExcecao(nbs, id, data)) {
    throw ex.nbsNaoVinculada(nbs, codigo, tributos);
  }
}
function criticarNcmContraAnexo(r: RtcRepos, ncm: string, id: number, codigo: string, data: string, tributos: string) {
  criticarNcm(r, ncm, id, codigo, data, tributos, r.ncmAplicavelTem(id, data));
}
function criticarNbsContraAnexo(r: RtcRepos, nbs: string, id: number, codigo: string, data: string, tributos: string) {
  criticarNbs(r, nbs, id, codigo, data, tributos, r.nbsAplicavelTem(id, data));
}
function validarNcmAplicavel(r: RtcRepos, ncm: string | null, id: number, codigo: string, data: string, tributos: string) {
  const completo = len(ncm) === 8;
  const tem = r.ncmAplicavelTem(id, data);
  if (tem && !completo) throw ex.ncmCompletoNaoInformado();
  if (completo) criticarNcm(r, ncm!, id, codigo, data, tributos, tem);
}
function validarNbsAplicavel(r: RtcRepos, nbs: string | null, id: number, codigo: string, data: string, tributos: string) {
  const completo = len(nbs) === 9;
  const tem = r.nbsAplicavelTem(id, data);
  if (tem && !completo) throw ex.nbsCompletoNaoInformado();
  if (completo) criticarNbs(r, nbs!, id, codigo, data, tributos, tem);
}

// ───────────────────────────── ValidacaoNomenclaturaService (modo PERMISSIVO) ─────────────────────────────

function validarNomenclatura(
  r: RtcRepos,
  siglaDfe: string,
  id: number,
  codigo: string,
  ncm: string | null,
  nbs: string | null,
  data: string,
  tributos: string,
): void {
  const resultado = determinarNomenclatura(r, siglaDfe, codigo, data);
  const siglaExibicao = SIGLAS[siglaDfe];
  switch (resultado) {
    case "NCM":
    case "EXCECAO_NCM":
      if (isNotBlank(nbs)) throw ex.nomenclaturaIncompativel("NBS", codigo, siglaExibicao);
      if (len(ncm) !== 8) throw ex.ncmCompletoNaoInformado();
      criticarNcmContraAnexo(r, ncm!, id, codigo, data, tributos);
      return;
    case "NBS":
    case "EXCECAO_NBS":
      if (isNotBlank(ncm)) throw ex.nomenclaturaIncompativel("NCM", codigo, siglaExibicao);
      if (len(nbs) !== 9) throw ex.nbsCompletoNaoInformado();
      criticarNbsContraAnexo(r, nbs!, id, codigo, data, tributos);
      return;
    case "MISTO":
      if (isNotBlank(ncm)) {
        if (len(ncm) !== 8) throw ex.ncmCompletoNaoInformado();
        criticarNcmContraAnexo(r, ncm, id, codigo, data, tributos);
      } else if (isNotBlank(nbs)) {
        if (len(nbs) !== 9) throw ex.nbsCompletoNaoInformado();
        criticarNbsContraAnexo(r, nbs, id, codigo, data, tributos);
      } else {
        throw ex.nomenclaturaObrigatoria(codigo, siglaExibicao);
      }
      return;
    case "SEM": {
      const ncmInformado = isNotBlank(ncm);
      const nbsInformado = isNotBlank(nbs);
      if (!ncmInformado && !nbsInformado) return;
      if (TRIO_RIGIDO.has(siglaDfe)) {
        // Dentro do trio a regra é sempre rígida: apenas a nomenclatura natural do documento é admitida.
        if (siglaDfe === "NFSE") {
          if (ncmInformado) throw ex.nomenclaturaIncompativel("NCM", codigo, siglaExibicao);
        } else if (nbsInformado) {
          throw ex.nomenclaturaIncompativel("NBS", codigo, siglaExibicao);
        }
        return;
      }
      // modo PERMISSIVO (fixado no call site do Java): não bloqueia; critica contra o anexo, se houver
      if (ncmInformado) validarNcmAplicavel(r, ncm, id, codigo, data, tributos);
      else validarNbsAplicavel(r, nbs, id, codigo, data, tributos);
      return;
    }
  }
}

// ───────────────────────────── ProcessamentoItemService ─────────────────────────────

/** validarNcmNbs */
function validarNcmNbs(r: RtcRepos, ncm: string | null, nbs: string | null, data: string) {
  if (!isNullOrEmpty(ncm) && !isNullOrEmpty(nbs)) throw ex.ncmNbsSimultaneas();
  if (!isNullOrEmpty(ncm) && !r.existeNcm(ncm!, data)) throw ex.ncmNaoEncontrada(ncm!, data);
  if (!isNullOrEmpty(nbs) && !r.existeNbs(nbs!, data)) throw ex.nbsNaoEncontrada(nbs!, data);
}

/** validarBaseCalculoLegado */
function validarBaseCalculoLegado(item: ItemWork) {
  const is = item.impostoSeletivo;
  const baseCalculo = item.baseCalculo;
  if (is === null) {
    if (baseCalculo === null) throw ex.baseCalculoNaoInformada();
    return;
  }
  const bcIs = is.baseCalculo;
  if (bcIs === null) {
    throw ex.erroGenerico(
      "A base de cálculo do Imposto Seletivo deve ser informada quando o grupo de Imposto Seletivo é informado",
    );
  }
  const impostoInformado = is.impostoInformado;
  if (baseCalculo === null) {
    item.baseCalculo = bcIs.plus(impostoInformado ?? ZERO);
    return;
  }
  if (impostoInformado !== null) {
    if (!baseCalculo.eq(bcIs.plus(impostoInformado))) {
      throw ex.baseCalculoInconsistente(jstr(baseCalculo), jstr(bcIs), jstr(impostoInformado));
    }
  } else if (baseCalculo.lt(bcIs)) {
    throw ex.baseCalculoMenor(jstr(baseCalculo), jstr(bcIs));
  }
}

/** validarAliquotasNominais */
function validarAliquotasNominais(r: RtcRepos, item: ItemWork, data: string) {
  const a = item.aliquotasNominais;
  if (anoDe(data) < ANO_LIMITE_SUPERIOR_ALIQUOTAS_NOMINAIS) {
    const informou =
      a !== null &&
      (a.cbs !== null ||
        a.ibsEstadual !== null ||
        a.ibsMunicipal !== null ||
        (a.impostoSeletivo !== null && (a.impostoSeletivo.adValorem !== null || a.impostoSeletivo.adRem !== null)));
    if (informou) throw ex.aliquotasNominaisInformadasIndevidamente();
    return;
  }
  const situacao = r.consultarSituacaoPorCodigo(item.cst, 2, data);
  const cstExigeGrupo = situacao !== null && situacao.inGrupoIbsCbs;
  if (!cstExigeGrupo) return;
  if (a === null || a.cbs === null || a.ibsEstadual === null || a.ibsMunicipal === null) {
    throw ex.aliquotasNominaisNaoInformadas();
  }
}

function validarClassificacaoCbsIbs(c: ClassificacaoDTO, cst: string, ncm: string | null, nbs: string | null) {
  // sob demanda da plataforma
  if (isNullOrEmpty(ncm) && isNullOrEmpty(nbs)) return;
  if (c.cst !== cst) throw ex.classificacaoNaoVinculadaCst(c.codigo, cst, "CBS e IBS");
}
function validarClassificacaoIS(c: ClassificacaoDTO, cst: string) {
  if (c.cst !== cst) throw ex.classificacaoNaoVinculadaCst(c.codigo, cst, "Imposto Seletivo");
}
function validarVinculoTipoDfe(r: RtcRepos, tipoDfe: TipoDfe | null, c: ClassificacaoDTO, data: string) {
  if (tipoDfe === null) return;
  const vinculado = r.tiposDfeVinculados(c.id, data).some((t) => t.id === tipoDfe.id);
  if (!vinculado) throw ex.classificacaoNaoVinculadaTipoDfe(c.codigo, tipoDfe.tipo, "CBS e IBS");
}

function existeIncidenciaImpostoSeletivo(r: RtcRepos, ncm: string | null, nbs: string | null, data: string): boolean {
  if (isNotBlank(ncm) && len(ncm) === 8) {
    return r.existeNcmAdValorem(ncm, 1, data) || r.buscarAdRemProduto(ncm, 1, data) !== null;
  }
  if (isNotBlank(nbs) && len(nbs) === 9) {
    return r.existeNbsAdValorem(nbs, 1, data);
  }
  return false;
}

function analisarAliquotaImpostoSeletivo(r: RtcRepos, item: ItemWork, data: string): AliquotaIS | null {
  const ncm = item.ncm;
  const nbs = item.nbs;
  const informadas = item.impostoSeletivo === null ? null : (item.aliquotasNominais?.impostoSeletivo ?? null);
  const possuiAdRemInformada = informadas !== null && informadas.adRem !== null;

  if (possuiAdRemInformada && !isNotBlank(item.impostoSeletivo!.unidade)) {
    throw ex.erroGenerico(
      "A unidade de medida do Imposto Seletivo deve ser informada quando a alíquota ad rem é informada pelo usuário",
    );
  }

  let adValorem: Dec | null = informadas !== null ? informadas.adValorem : null;
  let adRem: Dec | null = informadas !== null ? informadas.adRem : null;
  let unidade: string | null = adRem !== null ? item.impostoSeletivo!.unidade : null;

  if (isNotBlank(ncm) && len(ncm) === 8) {
    if (adValorem === null) {
      const dto = r.buscarAdValoremProduto(ncm, 1, data);
      if (dto !== null) adValorem = dto.valor;
    }
    if (adRem === null) {
      const dto = r.buscarAdRemProduto(ncm, 1, data);
      if (dto !== null) {
        adRem = dto.valor;
        unidade = dto.unidadeMedida;
      }
    }
  } else if (isNotBlank(nbs) && len(nbs) === 9) {
    if (adValorem === null) adValorem = r.buscarAdValoremServico(nbs, 1, null, data);
  }

  // Qualquer componente encontrada, seja no request ou no banco, habilita o cálculo.
  if (adValorem !== null || adRem !== null) {
    return { aliquotaAdValorem: adValorem, aliquotaAdRem: adRem, unidadeMedida: unidade };
  }
  return null;
}

function validarQuantidadeEUnidade(item: ItemWork, a: AliquotaIS) {
  if (a.aliquotaAdRem !== null && item.impostoSeletivo !== null) {
    const is = item.impostoSeletivo;
    if (is.quantidade === null) throw ex.erroGenerico("A quantidade do Imposto Seletivo deve ser informada para alíquota ad rem");
    if (is.quantidade.lte(0)) {
      throw ex.erroGenerico("A quantidade do Imposto Seletivo deve ser maior do que zero para alíquota ad rem");
    }
    if (is.unidade === null) throw ex.erroGenerico("A unidade de medida do Imposto Seletivo deve ser informada para alíquota ad rem");
  }
  if (item.quantidade.lte(0)) throw ex.erroGenerico("A quantidade do item deve ser maior do que zero");
}

interface ClassificacaoResolvida {
  model: TratamentoClassificacaoModel;
}

function obterTratamentoClassificacao(r: RtcRepos, item: ItemWork, data: string, tipoDfe: TipoDfe | null): ClassificacaoResolvida {
  let tcIS: TratamentoClassificacaoDTO | null = null;
  let tcDesoneracao: TratamentoClassificacaoDTO | null = null;
  let temDesoneracao = false;
  const ncm = item.ncm;
  const nbs = item.nbs;

  let cltr = r.buscarClassificacaoCbsIbs(item.cClassTrib, data);
  validarClassificacaoCbsIbs(cltr, item.cst, ncm, nbs);
  validarVinculoTipoDfe(r, tipoDfe, cltr, data);
  let tcCbsIbs = r.buscarTratamentoClassificacao(cltr.id, data);

  if (tcCbsIbs.inExigeGrupoDesoneracao) {
    if (item.tributacaoRegular === null) throw ex.tributacaoRegularNaoInformada(item.cClassTrib, item.cst);
    const cst = item.tributacaoRegular.cst!;
    const cClassTrib = item.tributacaoRegular.cClassTrib!;
    tcDesoneracao = tcCbsIbs;
    cltr = r.buscarClassificacaoCbsIbs(cClassTrib, data);
    validarClassificacaoCbsIbs(cltr, cst, ncm, nbs);
    validarVinculoTipoDfe(r, tipoDfe, cltr, data);
    tcCbsIbs = r.buscarTratamentoClassificacao(cltr.id, data);
    if (tcCbsIbs.inIncompativelComSuspensao) throw ex.incompatibilidadeSuspensao(cClassTrib, cst);
    temDesoneracao = true;
  } else if (item.tributacaoRegular !== null) {
    if (tipoDfe !== null) {
      // O grupo de tributação regular não participa do cálculo neste caso, mas o vínculo do seu cClassTrib
      // com o tipo de DFe é validado quando tpDoc é informado.
      validarVinculoTipoDfe(r, tipoDfe, r.buscarClassificacaoCbsIbs(item.tributacaoRegular.cClassTrib!, data), data);
    }
  }

  if (tipoDfe !== null) {
    // Exigência/permissão de NCM/NBS dirigida pela nomenclatura do documento (modo PERMISSIVO).
    validarNomenclatura(r, getPorSiglaNormalizada(tipoDfe.sigla), cltr.id, cltr.codigo, ncm, nbs, data, "CBS e IBS");
  } else {
    if (isNullOrEmpty(ncm) && isNullOrEmpty(nbs)) {
      validarNcmAplicavel(r, ncm, cltr.id, cltr.codigo, data, "CBS e IBS");
      validarNbsAplicavel(r, nbs, cltr.id, cltr.codigo, data, "CBS e IBS");
    }
    if (!isNullOrEmpty(ncm) && isNullOrEmpty(nbs)) {
      validarNcmAplicavel(r, ncm, cltr.id, cltr.codigo, data, "CBS e IBS");
    }
    if (!isNullOrEmpty(nbs) && isNullOrEmpty(ncm)) {
      validarNbsAplicavel(r, nbs, cltr.id, cltr.codigo, data, "CBS e IBS");
    }
  }

  let cltrIS: ClassificacaoDTO | null = null;
  if (item.impostoSeletivo !== null) {
    r.validarCst(item.impostoSeletivo.cst!, 1, data);
    cltrIS = r.buscarClassificacaoImpostoSeletivo(item.impostoSeletivo.cClassTrib!, data);
    validarClassificacaoIS(cltrIS, item.impostoSeletivo.cst!);
  }

  const aliquotaIS = analisarAliquotaImpostoSeletivo(r, item, data);
  const nomenclatura = isNotBlank(ncm) ? "NCM" : "NBS";
  const codigoNomenclatura = (isNotBlank(ncm) ? ncm : nbs) as string;

  if (tipoDfe !== null && !IMPOSTO_SELETIVO_APLICAVEL_DFE.has(normalizarSigla(tipoDfe.sigla)) && aliquotaIS !== null) {
    throw ex.impostoSeletivoNaoAdmitidoTipoDfe(tipoDfe.tipo, nomenclatura, codigoNomenclatura);
  }

  // A partir de 2027, a incidência do IS é determinada pela existência do registro de alíquota.
  if (aliquotaIS === null && anoDe(data) >= ANO_LIMITE_SUPERIOR_ALIQUOTAS_NOMINAIS && existeIncidenciaImpostoSeletivo(r, ncm, nbs, data)) {
    if (item.impostoSeletivo === null) throw ex.impostoSeletivoNaoInformado(nomenclatura, codigoNomenclatura, data);
    throw ex.aliquotaImpostoSeletivoNaoInformada(nomenclatura, codigoNomenclatura, data);
  }

  if (aliquotaIS !== null) {
    if (item.impostoSeletivo === null) throw ex.impostoSeletivoNaoInformado(nomenclatura, codigoNomenclatura, data);
    validarQuantidadeEUnidade(item, aliquotaIS);
    tcIS = r.buscarTratamentoClassificacao(cltrIS!.id, data);
  }
  // validarNomenclaturaAplicavelImpostoSeletivo: desativada no Java (sem previsão legal)

  return { model: { cbsIbs: tcCbsIbs, is: tcIS, desoneracao: tcDesoneracao, aliquotaIS, temDesoneracao } };
}

/**
 * ProcessamentoItemService.processarItem. `item` é modificado como no Java (quantidade/unidade default,
 * base derivada). Lança RtcException (um erro por item) ou MotorLocalNaoValidadoError.
 */
export function processarItem(
  r: RtcRepos,
  op: { uf: string; municipio: number; tpEnteGov: number | null },
  itemIn: ItemIn,
  data: string,
  tipoDfe: TipoDfe | null,
): TributosOut {
  // INÍCIO de bloco para a plataforma (Java): defaults de quantidade e unidade
  const item = itemIn as unknown as ItemWork;
  if (item.quantidade === null) item.quantidade = ONE;
  if (item.unidade === null) item.unidade = "UN";

  // item.ajustarNcm(tipoDfe)
  if (tipoDfe !== null && tipoDfe.permiteNcmZero && (item.ncm === "00" || item.ncm === "00000000")) item.ncm = null;

  if (itemIn.possuiComponentesBC) {
    throw new MotorLocalNaoValidadoError({ condicao: "grupo gComponentesBC (base de cálculo por componentes) não coberto pelo corpus" });
  }
  validarBaseCalculoLegado(item);

  validarNcmNbs(r, item.ncm, item.nbs, data);

  // tentar resolver a suspensão aqui
  r.validarCst(item.cst, 2, data);

  validarAliquotasNominais(r, item, data);

  const { model } = obterTratamentoClassificacao(r, item, data, tipoDfe);

  const codigoUf = r.buscarUf(op.uf);

  const operacaoModel: OperacaoModel = {
    data,
    codigoMunicipio: op.municipio,
    codigoUf,
    tpEnteGov: op.tpEnteGov,
    pRedutor: r.buscarValorRedutor(op.tpEnteGov, data),
    item,
    tratamento: model,
  };
  return calcularTributos(r, operacaoModel);
}
