import { CODIGOS_VSN, type CodigoValidacaoSimples } from "./codigos";
import type { ItemCollector } from "./collector";
import {
  buscarFatorTransicaoCompraGov,
  buscarRegimeApuracao,
  buscarSiglaVigentePorId,
  buscarSituacoesIss,
  buscarTiposDfeCalculo,
  permiteNcmZeroVigentePorId,
  tpDocSemTratamentoCalculadora,
  tpDocSuportado,
} from "./consultas";
import { carregarDadosBase, type DadosBase, type RegimeApuracao, type TipoDfeCalculo, type Vocabulario } from "./data";
import { D, aliquotaDeTexto, formatarMoeda, totalizar, type AliquotaDecimal, type Dec } from "./decimal";
import { ErrosCalculoException, MotorLocalNaoValidadoError } from "./errors";
import { NAO_SUPORTADOS } from "./unsupported";
import {
  CAMPO_CRT,
  CAMPO_REGAPIBSCBSSN,
  CAMPO_REGAPTRIBSN,
  CAMPO_TPBM,
  CAMPO_TPRETISSQN,
  CAMPO_TRIBISSQN,
  avaliarCamposIss,
  avisoParSemRedistribuicaoAusente,
  escolher,
  type EscolhaParAliquotas,
  type LinhaAliquotas,
  type ParAliquotas,
  type AliquotasAnexo,
} from "./escolha-par";
import { compararInteiros, fmtNull, inteiroTolerante, isBlank, javaTrim, parseIntJava, parseLocalDate } from "./java-compat";
import { prepararIndices } from "./nomenclatura";
import type {
  AliquotasEfetivasInput,
  ErroDetalhe,
  ItemSimplesInput,
  ItemSimplesUnificadoInput,
  ObjetoSimplesDomain,
  ObservabilidadeSimplesDomain,
  OperacaoSimplesInput,
  OperacaoSimplesNaoAssistidaInput,
  ResolucaoAliquotaItemDomain,
  TotalSimplesDomain,
} from "./official-types";
import {
  DESCRICAO_FORMATO_ALIQUOTA,
  FORMATO_ALIQUOTA,
  normalizarCAtivSN,
  processarItem,
  validarAliquota,
  type AliquotasItem,
  type Ambiente,
  type ContextoItem,
  type EntradaItem,
  type ItemProcessado,
  type ResolvedorAliquotasItem,
} from "./processador-item";

/**
 * Port de `SimplesNacionalObservabilidadeService` (contrato clássico), `SimplesNacionalNaoAssistidoService`
 * e `CalculoSimplesUnificadoService` (núcleo do não assistido). Erros globais lançam
 * `ErrosCalculoException` (HTTP 422 no handler).
 */

// ─── Utilidades de erro global ───────────────────────────────────────────────

function erroGlobal(baseURL: string, codigo: CodigoValidacaoSimples, campo: string, detail: string): ErroDetalhe {
  return {
    type: `${baseURL}/calculadora/observabilidade/simples-nacional/erros?codigo=${codigo.code}`,
    title: codigo.titulo,
    code: codigo.code,
    pointer: `#/${campo}`,
    detail,
  };
}

/** Converte texto em data ISO (`LocalDate.parse(trim)`), ou `null`. */
function lerData(v: string): string | null {
  return parseLocalDate(javaTrim(v));
}

function totalSimples(objetos: ObjetoSimplesDomain[]): TotalSimplesDomain | undefined {
  const comTrib = objetos.filter((o) => o.tribCalc != null);
  if (comTrib.length === 0) return undefined;
  // Os valores são texto (TDec1302) já arredondados; a soma é exata sobre eles.
  const soma = (campo: (t: NonNullable<ObjetoSimplesDomain["tribCalc"]>) => string | undefined): Dec | null => {
    const valores = comTrib.map((o) => campo(o.tribCalc!)).filter((v): v is string => v != null);
    return valores.length === 0 ? null : totalizar(valores.map(parseDec));
  };
  const vIBSSNtot = soma((t) => t.vIBSSN);
  const vCBSSNtot = soma((t) => t.vCBSSN);
  const totalIs = soma((t) => t.IS?.valor);
  let totalTributos: Dec | null = null;
  if (vIBSSNtot != null || vCBSSNtot != null || totalIs != null) {
    totalTributos = totalizar([vIBSSNtot, vCBSSNtot, totalIs].filter((v): v is Dec => v != null));
  }
  const fmt = (v: Dec | null) => (v == null ? undefined : formatarMoeda(v));
  const total: TotalSimplesDomain = {};
  const set = <K extends keyof TotalSimplesDomain>(k: K, v: string | undefined) => {
    if (v !== undefined) total[k] = v;
  };
  set("vRBSNtot", fmt(soma((t) => t.vRBSNitem)));
  set("vBC", fmt(soma((t) => t.vBC)));
  set("vIBSSNtot", fmt(vIBSSNtot));
  set("vIBSSNtotPendSusp", fmt(soma((t) => t.vIBSPendSusp)));
  set("vCBSSNtot", fmt(vCBSSNtot));
  set("vCBSSNtotPendSusp", fmt(soma((t) => t.vCBSPendSusp)));
  set("totalIs", fmt(totalIs));
  set("totalTributos", fmt(totalTributos));
  return total;
}

const parseDec = (s: string): Dec => new D(s);

const ordenarPorNObj = (objetos: ObjetoSimplesDomain[]): ObjetoSimplesDomain[] =>
  // Comparator.comparing(nObj, nullsFirst(naturalOrder())) — ordenação estável.
  objetos
    .map((o, i) => ({ o, i }))
    .sort((a, b) => {
      const x = a.o.nObj;
      const y = b.o.nObj;
      if (x == null && y == null) return a.i - b.i;
      if (x == null) return -1;
      if (y == null) return 1;
      return compararInteiros(x, y) || a.i - b.i;
    })
    .map((p) => p.o);

async function ambiente(baseURL: string, itens: EntradaItem[]): Promise<Ambiente> {
  const dados = await carregarDadosBase();
  const indices = await prepararIndices(itens);
  return { dados, indices, baseURL };
}

// ═════════════════════════════════════════════════════════════════════════════
// Contrato CLÁSSICO (OperacaoSimplesInput)
// ═════════════════════════════════════════════════════════════════════════════

function validarTpEnteGov(tpEnteGov: string | null | undefined, erros: ErroDetalhe[], baseURL: string): void {
  if (tpEnteGov == null || isBlank(tpEnteGov)) return;
  const valor = inteiroTolerante(tpEnteGov);
  if (valor == null || valor < 1 || valor > 4) {
    erros.push(
      erroGlobal(
        baseURL,
        CODIGOS_VSN.TPENTEGOV_INVALIDO,
        "tpEnteGov",
        `Tipo de ente governamental inválido, recebido: '${tpEnteGov}' (esperado 1, 2, 3 ou 4).`,
      ),
    );
  }
}

function validarEscopoClassico(
  d: DadosBase,
  op: OperacaoSimplesInput,
  data: string | null,
  erros: ErroDetalhe[],
  baseURL: string,
): void {
  // tpDoc: obrigatório e suportado pelo cálculo na data do fato gerador.
  if (op.tpDoc == null || isBlank(op.tpDoc)) {
    erros.push(
      erroGlobal(baseURL, CODIGOS_VSN.TPDOC_AUSENTE, "tpDoc", "O tipo de documento fiscal (tpDoc) é obrigatório e não foi informado."),
    );
  } else {
    const tpDoc = inteiroTolerante(op.tpDoc);
    if (tpDoc == null) {
      erros.push(
        erroGlobal(
          baseURL,
          CODIGOS_VSN.TPDOC_NAO_SUPORTADO,
          "tpDoc",
          `Tipo de documento não suportado pelo cálculo do Simples Nacional, recebido: '${op.tpDoc}'.`,
        ),
      );
    } else if (data != null && tpDocSemTratamentoCalculadora(d, tpDoc, data)) {
      erros.push(
        erroGlobal(
          baseURL,
          CODIGOS_VSN.TPDOC_NAO_SUPORTADO,
          "tpDoc",
          `Tipo de documento fiscal (tpDoc) de código ${tpDoc} ainda não possui tratamento implementado no cálculo do Simples Nacional.`,
        ),
      );
    } else if (data != null && !tpDocSuportado(d, tpDoc, data)) {
      erros.push(
        erroGlobal(
          baseURL,
          CODIGOS_VSN.TPDOC_NAO_SUPORTADO,
          "tpDoc",
          `Tipo de documento não suportado pelo cálculo do Simples Nacional, recebido: '${op.tpDoc}'.`,
        ),
      );
    }
  }

  // CRT: obrigatório, em {1, 2, 3, 4}.
  const crt = inteiroTolerante(op.CRT);
  if (crt == null || crt < 1 || crt > 4) {
    erros.push(
      erroGlobal(
        baseURL,
        CODIGOS_VSN.CRT_INVALIDO,
        "CRT",
        `O Código de Regime Tributário (CRT) é obrigatório e deve ser 1, 2, 3 ou 4, recebido: '${fmtNull(op.CRT)}'.`,
      ),
    );
    return;
  }

  // tpRegimeIBSCBS: opcional; quando informado, em {1, 2}.
  const tpRegimeInformado = op.tpRegimeIBSCBS != null && !isBlank(op.tpRegimeIBSCBS);
  let tpRegime: number | null = null;
  if (tpRegimeInformado) {
    tpRegime = inteiroTolerante(op.tpRegimeIBSCBS);
    if (tpRegime == null || (tpRegime !== 1 && tpRegime !== 2)) {
      erros.push(
        erroGlobal(
          baseURL,
          CODIGOS_VSN.TPREGIMEIBSCBS_INVALIDO,
          "tpRegimeIBSCBS",
          `Tipo de regime de apuração do IBS/CBS inválido, recebido: '${op.tpRegimeIBSCBS}' (esperado 1 ou 2).`,
        ),
      );
      return;
    }
  }

  // Incoerências CRT × tpRegimeIBSCBS (regras C21a-10/20/30 da NT, msg 1275).
  if (crt === 4 && tpRegimeInformado) {
    erros.push(
      erroGlobal(
        baseURL,
        CODIGOS_VSN.TPREGIMEIBSCBS_INCOMPATIVEL,
        "tpRegimeIBSCBS",
        "CRT=4 (MEI) não admite tpRegimeIBSCBS algum (regra C21a-30 da NT 2026.005).",
      ),
    );
  } else if ((crt === 1 || crt === 2) && tpRegime === 2) {
    erros.push(
      erroGlobal(
        baseURL,
        CODIGOS_VSN.TPREGIMEIBSCBS_INCOMPATIVEL,
        "tpRegimeIBSCBS",
        `CRT=${crt} não admite tpRegimeIBSCBS=2 (regra C21a-10 da NT 2026.005).`,
      ),
    );
  } else if (crt === 3 && tpRegime === 1) {
    erros.push(
      erroGlobal(
        baseURL,
        CODIGOS_VSN.TPREGIMEIBSCBS_INCOMPATIVEL,
        "tpRegimeIBSCBS",
        "CRT=3 não admite tpRegimeIBSCBS=1 (regra C21a-20 da NT 2026.005).",
      ),
    );
  }

  // Fora do escopo do cálculo do Simples Nacional.
  if (crt === 4) {
    erros.push(
      erroGlobal(
        baseURL,
        CODIGOS_VSN.OPERACAO_FORA_ESCOPO,
        "CRT",
        "Operação fora do escopo do cálculo do Simples Nacional: MEI (CRT=4) está fora do Evento de Tributação do Simples Nacional.",
      ),
    );
  }
  if (tpRegime === 1) {
    erros.push(
      erroGlobal(
        baseURL,
        CODIGOS_VSN.OPERACAO_FORA_ESCOPO,
        "tpRegimeIBSCBS",
        "Operação fora do escopo do cálculo do Simples Nacional: optante pelo regime regular do IBS/CBS (tpRegimeIBSCBS=1) tem a tributação calculada pelo regime regular, não por este endpoint.",
      ),
    );
  }
  if (crt === 3 && !tpRegimeInformado) {
    erros.push(
      erroGlobal(
        baseURL,
        CODIGOS_VSN.OPERACAO_FORA_ESCOPO,
        "CRT",
        "Operação fora do escopo do cálculo do Simples Nacional: CRT=3 sem tpRegimeIBSCBS=2 (regime normal puro) não é Simples Nacional.",
      ),
    );
  }
}

function validarCamposGlobaisClassico(d: DadosBase, op: OperacaoSimplesInput, baseURL: string): ErroDetalhe[] {
  const erros: ErroDetalhe[] = [];
  if (op.id == null || isBlank(op.id)) {
    erros.push(erroGlobal(baseURL, CODIGOS_VSN.DADO_GLOBAL_AUSENTE, "id", "O identificador da operação (id) é obrigatório."));
  }
  if (op.versao == null || isBlank(op.versao)) {
    erros.push(erroGlobal(baseURL, CODIGOS_VSN.DADO_GLOBAL_AUSENTE, "versao", "A versão do payload (versao) é obrigatória."));
  }

  // A data é validada antes do escopo: o suporte do tpDoc é um lookup de vigência que depende dela.
  let data: string | null = null;
  if (op.data == null || isBlank(op.data)) {
    erros.push(erroGlobal(baseURL, CODIGOS_VSN.DATA_INVALIDA, "data", "A data do fato gerador é obrigatória."));
  } else {
    data = lerData(op.data);
    if (data == null) {
      erros.push(
        erroGlobal(baseURL, CODIGOS_VSN.DATA_INVALIDA, "data", `Data inválida, recebido: '${op.data}' (esperado YYYY-MM-DD).`),
      );
    }
  }
  validarEscopoClassico(d, op, data, erros, baseURL);
  validarTpEnteGov(op.tpEnteGov, erros, baseURL);

  if (op.itens == null || op.itens.length === 0) {
    erros.push(erroGlobal(baseURL, CODIGOS_VSN.ITENS_VAZIOS, "itens", "A lista de itens é obrigatória e não pode estar vazia."));
  }
  return erros;
}

function nomenclatura<T extends { ncm?: string | null; NCM?: string | null; nbs?: string | null; NBS?: string | null }>(
  item: T,
): { NCM: string | null; NBS: string | null } {
  return { NCM: item.ncm ?? item.NCM ?? null, NBS: item.nbs ?? item.NBS ?? null };
}

export async function processarOperacaoClassica(op: OperacaoSimplesInput, baseURL: string): Promise<ObservabilidadeSimplesDomain> {
  const dados = await carregarDadosBase();

  // 1. Validação global e de escopo (HTTP 422).
  const errosGlobais = validarCamposGlobaisClassico(dados, op, baseURL);
  if (errosGlobais.length > 0) throw new ErrosCalculoException(errosGlobais);

  const data = lerData(op.data as string) as string;

  // 2. Linha vigente da matriz de regime (CRT_1 / CRT_2 / CRT_3+tpRegime 2).
  const crt = parseIntJava(javaTrim(op.CRT as string));
  const regime = buscarRegimeApuracao(dados, "CRT", crt, crt === 3 ? 2 : null, null, null, data);
  if (regime == null) {
    throw new ErrosCalculoException([
      erroGlobal(
        baseURL,
        CODIGOS_VSN.PARAMETRIZACAO_INDISPONIVEL,
        "CRT",
        `Não há parametrização de regime de apuração do Simples Nacional vigente para CRT=${fmtNull(op.CRT)} e tpRegimeIBSCBS=${fmtNull(op.tpRegimeIBSCBS)} na data '${data}'.`,
      ),
    ]);
  }

  // 3. Fator de transição de compra governamental (VSN-025 se a data não tem vigência).
  const tpEnteGov = inteiroTolerante(op.tpEnteGov);
  let fatorTransicao: Dec | null = null;
  if (tpEnteGov != null && tpEnteGov !== 1) {
    fatorTransicao = buscarFatorTransicaoCompraGov(dados, data);
    if (fatorTransicao == null) {
      throw new ErrosCalculoException([
        erroGlobal(
          baseURL,
          CODIGOS_VSN.COMPRA_GOV_SEM_VIGENCIA,
          "tpEnteGov",
          `Não há parametrização de transição de compra governamental vigente para a data '${data}'.`,
        ),
      ]);
    }
  }

  const tpDoc = parseIntJava(javaTrim(op.tpDoc as string));
  const documento = buscarTiposDfeCalculo(dados, tpDoc, data)[0] ?? null;
  const siglaDfe = documento == null ? null : buscarSiglaVigentePorId(dados, documento.tipoDfeId, data);
  const permiteNcmZero = documento != null && permiteNcmZeroVigentePorId(dados, documento.tipoDfeId, data);
  const contexto: ContextoItem = {
    data,
    tpDoc,
    regime,
    tpEnteGov,
    fatorTransicaoCompraGov: fatorTransicao,
    vocabularioTipoReceita: null,
    normalizarCAtivSN: false,
    admiteImpostoSeletivo: true,
    casasAliquotaCalculo: null,
    siglaDfe,
    permiteNcmZero,
  };

  const itensEntrada = (op.itens as Array<ItemSimplesInput | null>).map((item) => {
    if (item == null) {
      // O Java lança NullPointerException (HTTP 500) ao ler um item nulo: sem resposta fiel possível.
      throw new MotorLocalNaoValidadoError("ITEM_NULO_CLASSICO", NAO_SUPORTADOS.ITEM_NULO_CLASSICO);
    }
    return item;
  });
  const entradas: EntradaItem[] = itensEntrada.map((item) => ({
    numero: item.numero ?? null,
    cAtivSN: item.cAtivSN ?? null,
    cClassTrib: item.cClassTrib ?? null,
    baseCalculo: item.baseCalculo ?? null,
    valorImpostoSeletivo: item.valorImpostoSeletivo ?? null,
    ...nomenclatura(item),
  }));
  const amb = await ambiente(baseURL, entradas);

  // 4. Itens (cada um com o resolvedor de alíquotas do próprio contrato clássico).
  const processados: ItemProcessado[] = entradas.map((entrada, i) =>
    processarItem(amb, entrada, i, contexto, aliquotasDoItemClassico(itensEntrada[i])),
  );
  const objetos = ordenarPorNObj(processados.map((p) => p.objeto));

  const oper: NonNullable<ObservabilidadeSimplesDomain["oper"]> = {};
  if (op.data != null) oper.data = op.data;
  if (op.tpDoc != null) oper.tpDoc = op.tpDoc;
  if (op.CRT != null) oper.CRT = op.CRT;
  if (op.tpRegimeIBSCBS != null) oper.tpRegimeIBSCBS = op.tpRegimeIBSCBS;
  if (op.tpEnteGov != null) oper.tpEnteGov = op.tpEnteGov;

  const resp: ObservabilidadeSimplesDomain = { oper, objetos };
  const total = totalSimples(objetos);
  if (total) resp.total = total;
  return resp;
}

/** Resolvedor do contrato clássico: alíquotas efetivas dos campos pIBSSN/pCBSSN do próprio item. */
function aliquotasDoItemClassico(item: ItemSimplesInput): ResolvedorAliquotasItem {
  return {
    resolver(dados, collector): AliquotasItem {
      const pCbs = validarAliquota(item.pCBSSN ?? null, dados.cbsExigida, collector, "pCBSSN", CODIGOS_VSN.ALIQUOTA_CBS_AUSENTE, CODIGOS_VSN.ALIQUOTA_CBS_INVALIDA);
      const pIbs = validarAliquota(item.pIBSSN ?? null, dados.ibsExigida, collector, "pIBSSN", CODIGOS_VSN.ALIQUOTA_IBS_AUSENTE, CODIGOS_VSN.ALIQUOTA_IBS_INVALIDA);
      return { pIBSSN: pIbs, pCBSSN: pCbs, naoCalcular: false, resolucao: null };
    },
    naoAvaliado: () => null,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Contrato NÃO ASSISTIDO (OperacaoSimplesNaoAssistidaInput) — núcleo unificado
// ═════════════════════════════════════════════════════════════════════════════

const OPTANTES = new Set([3, 4]);
const RAIZ = "aliquotasEfetivas";

interface RegimeInformado {
  crt: number | null;
  tpRegimeIBSCBS: number | null;
  opSimpNac: number | null;
  regApIBSCBSSN: number | null;
  regApTribSN: number | null;
}

function proibido(valor: string | null | undefined, campo: string, documento: string, erros: ErroDetalhe[], baseURL: string): void {
  if (valor != null && !isBlank(valor)) {
    erros.push(
      erroGlobal(
        baseURL,
        CODIGOS_VSN.CAMPO_REGIME_PROIBIDO,
        campo,
        `O campo ${campo} não pertence ao vocabulário de regime do ${documento}, recebido: '${valor}'.`,
      ),
    );
  }
}

function validarRegimeCrt(op: OperacaoSimplesNaoAssistidaInput, erros: ErroDetalhe[], baseURL: string): void {
  const crt = inteiroTolerante(op.CRT);
  if (crt == null || crt < 1 || crt > 4) {
    erros.push(
      erroGlobal(
        baseURL,
        CODIGOS_VSN.CRT_INVALIDO,
        "CRT",
        `O Código de Regime Tributário (CRT) é obrigatório e deve ser 1, 2, 3 ou 4, recebido: '${fmtNull(op.CRT)}'.`,
      ),
    );
    return;
  }
  const tpRegimeInformado = op.tpRegimeIBSCBS != null && !isBlank(op.tpRegimeIBSCBS);
  if (!tpRegimeInformado) return;
  const tpRegime = inteiroTolerante(op.tpRegimeIBSCBS);
  if (tpRegime == null || (tpRegime !== 1 && tpRegime !== 2)) {
    erros.push(
      erroGlobal(
        baseURL,
        CODIGOS_VSN.TPREGIMEIBSCBS_INVALIDO,
        "tpRegimeIBSCBS",
        `Tipo de regime de apuração do IBS/CBS inválido, recebido: '${op.tpRegimeIBSCBS}' (esperado 1 ou 2).`,
      ),
    );
    return;
  }
  if (crt === 4) {
    erros.push(
      erroGlobal(
        baseURL,
        CODIGOS_VSN.TPREGIMEIBSCBS_INCOMPATIVEL,
        "tpRegimeIBSCBS",
        tpRegime === 2
          ? "CRT=4 (MEI) não admite tpRegimeIBSCBS algum (regras C21a-10 e C21a-30 da NT 2026.005)."
          : "CRT=4 (MEI) não admite tpRegimeIBSCBS algum (regra C21a-30 da NT 2026.005).",
      ),
    );
  } else if ((crt === 1 || crt === 2) && tpRegime === 2) {
    erros.push(
      erroGlobal(
        baseURL,
        CODIGOS_VSN.TPREGIMEIBSCBS_INCOMPATIVEL,
        "tpRegimeIBSCBS",
        `CRT=${crt} não admite tpRegimeIBSCBS=2 (regra C21a-10 da NT 2026.005).`,
      ),
    );
  } else if (crt === 3 && tpRegime === 1) {
    erros.push(
      erroGlobal(
        baseURL,
        CODIGOS_VSN.TPREGIMEIBSCBS_INCOMPATIVEL,
        "tpRegimeIBSCBS",
        "CRT=3 não admite tpRegimeIBSCBS=1 (regra C21a-20 da NT 2026.005).",
      ),
    );
  }
}

function validarCampoNfse(
  valor: string | null | undefined,
  campo: string,
  opSimpNac: number,
  codigo: CodigoValidacaoSimples,
  regraObrigatorio: string,
  erros: ErroDetalhe[],
  baseURL: string,
): void {
  const informado = valor != null && !isBlank(valor);
  if (informado) {
    const convertido = inteiroTolerante(valor);
    if (convertido == null || convertido < 1 || convertido > 3) {
      erros.push(erroGlobal(baseURL, codigo, campo, `O ${campo} deve ser 1, 2 ou 3, recebido: '${valor}'.`));
    } else if (!OPTANTES.has(opSimpNac)) {
      erros.push(
        erroGlobal(
          baseURL,
          codigo,
          campo,
          `O ${campo} não pode ser informado com opSimpNac=${opSimpNac} (não optante ou MEI)${campo === CAMPO_REGAPTRIBSN ? " (regra E0162 da NFS-e)" : ""}.`,
        ),
      );
    }
  } else if (OPTANTES.has(opSimpNac)) {
    erros.push(erroGlobal(baseURL, codigo, campo, `O ${campo} é obrigatório com opSimpNac=${opSimpNac} (${regraObrigatorio}).`));
  }
}

function validarRegimeNfse(op: OperacaoSimplesNaoAssistidaInput, erros: ErroDetalhe[], baseURL: string): void {
  const opSimpNac = inteiroTolerante(op.opSimpNac);
  if (opSimpNac == null || opSimpNac < 1 || opSimpNac > 4) {
    erros.push(
      erroGlobal(
        baseURL,
        CODIGOS_VSN.OPSIMPNAC_INVALIDO,
        "opSimpNac",
        `A situação perante o Simples Nacional (opSimpNac) é obrigatória na NFS-e e deve ser 1, 2, 3 ou 4, recebido: '${fmtNull(op.opSimpNac)}'.`,
      ),
    );
    return;
  }
  validarCampoNfse(op.regApIBSCBSSN, CAMPO_REGAPIBSCBSSN, opSimpNac, CODIGOS_VSN.REGAPIBSCBSSN_INVALIDO, "regra 313 da NFS-e", erros, baseURL);
  validarCampoNfse(
    op.regApTribSN,
    CAMPO_REGAPTRIBSN,
    opSimpNac,
    CODIGOS_VSN.REGAPTRIBSN_INVALIDO,
    "regra E0166 da NFS-e, estendida pela NT 009",
    erros,
    baseURL,
  );
}

function validarRegime(op: OperacaoSimplesNaoAssistidaInput, vocabulario: Vocabulario, erros: ErroDetalhe[], baseURL: string): void {
  if (vocabulario === "NFSE") {
    proibido(op.CRT, "CRT", "NFS-e", erros, baseURL);
    proibido(op.tpRegimeIBSCBS, "tpRegimeIBSCBS", "NFS-e", erros, baseURL);
    validarRegimeNfse(op, erros, baseURL);
  } else {
    proibido(op.opSimpNac, "opSimpNac", "documento com CRT", erros, baseURL);
    proibido(op.regApIBSCBSSN, CAMPO_REGAPIBSCBSSN, "documento com CRT", erros, baseURL);
    proibido(op.regApTribSN, CAMPO_REGAPTRIBSN, "documento com CRT", erros, baseURL);
    validarRegimeCrt(op, erros, baseURL);
  }
}

function descreverRegime(vocabulario: Vocabulario, i: RegimeInformado): string {
  if (vocabulario === "NFSE") return `opSimpNac=${fmtNull(i.opSimpNac)}, regApIBSCBSSN=${fmtNull(i.regApIBSCBSSN)}`;
  return i.tpRegimeIBSCBS == null ? `CRT=${fmtNull(i.crt)}` : `CRT=${fmtNull(i.crt)}, tpRegimeIBSCBS=${i.tpRegimeIBSCBS}`;
}

function erroForaDoEscopo(vocabulario: Vocabulario, i: RegimeInformado, data: string, baseURL: string): ErroDetalhe {
  let motivo: string;
  let campo: string;
  if (vocabulario === "NFSE") {
    campo = "opSimpNac";
    switch (i.opSimpNac) {
      case 1:
        motivo = "prestador não optante pelo Simples Nacional (opSimpNac=1)";
        break;
      case 2:
        motivo = "MEI (opSimpNac=2) está fora do cálculo do IBS e da CBS pelo Simples Nacional";
        break;
      default:
        motivo = `não há enquadramento vigente na data '${data}' para opSimpNac=${fmtNull(i.opSimpNac)} e regApIBSCBSSN=${fmtNull(i.regApIBSCBSSN)}`;
    }
  } else {
    campo = "CRT";
    if (i.crt === 4) {
      motivo = "MEI (CRT=4) está fora do Evento de Tributação do Simples Nacional";
    } else if (i.crt === 3 && i.tpRegimeIBSCBS == null) {
      motivo = "CRT=3 sem tpRegimeIBSCBS=2 (regime normal puro) não é Simples Nacional";
    } else {
      motivo = `não há enquadramento vigente na data '${data}' para ${descreverRegime(vocabulario, i)}`;
    }
  }
  return erroGlobal(baseURL, CODIGOS_VSN.OPERACAO_FORA_ESCOPO, campo, `Operação fora do escopo do cálculo do Simples Nacional: ${motivo}.`);
}

// ─── Linha de alíquotas da requisição (FonteRequisicao) ──────────────────────

const informado = (v: string | null | undefined) => v != null && !isBlank(v);

function aliquotaGlobal(
  valor: string | null | undefined,
  caminho: string,
  codigo: CodigoValidacaoSimples,
  erros: ErroDetalhe[],
  baseURL: string,
): AliquotaDecimal | null {
  if (!informado(valor)) return null;
  const texto = javaTrim(valor as string);
  if (FORMATO_ALIQUOTA.test(texto)) return aliquotaDeTexto(texto);
  const negativo = texto.startsWith("-") && FORMATO_ALIQUOTA.test(texto.slice(1));
  erros.push(
    erroGlobal(
      baseURL,
      codigo,
      `${RAIZ}/${caminho}`,
      negativo
        ? `O valor não pode ser negativo, recebido: '${valor}'.`
        : `O valor não é um número decimal válido, recebido: '${valor}'. Informe ${DESCRICAO_FORMATO_ALIQUOTA}.`,
    ),
  );
  return null;
}

function parGlobal(
  pCBSSN: string | null | undefined,
  pIBSSN: string | null | undefined,
  caminho: string,
  erros: ErroDetalhe[],
  baseURL: string,
): ParAliquotas {
  const cbs = aliquotaGlobal(pCBSSN, `${caminho}/pCBSSN`, CODIGOS_VSN.ALIQUOTA_CBS_INVALIDA, erros, baseURL);
  const ibs = aliquotaGlobal(pIBSSN, `${caminho}/pIBSSN`, CODIGOS_VSN.ALIQUOTA_IBS_INVALIDA, erros, baseURL);
  return { pCBSSN: cbs, pIBSSN: ibs };
}

function anexoParUnico(
  anexo: { pCBSSN?: string | null; pIBSSN?: string | null } | null | undefined,
  caminho: string,
  erros: ErroDetalhe[],
  baseURL: string,
): AliquotasAnexo | null {
  if (anexo == null) return null;
  return { par: parGlobal(anexo.pCBSSN, anexo.pIBSSN, caminho, erros, baseURL), semRedistribuicaoISS: null };
}

function anexoComIssGlobal(
  anexo: { pCBSSN?: string | null; pIBSSN?: string | null; semRedistribuicaoISS?: { pCBSSN?: string | null; pIBSSN?: string | null } | null } | null | undefined,
  caminho: string,
  erros: ErroDetalhe[],
  baseURL: string,
): AliquotasAnexo | null {
  if (anexo == null) return null;
  const sem = anexo.semRedistribuicaoISS;
  const semInformado = sem != null && (informado(sem.pCBSSN) || informado(sem.pIBSSN));
  const par = parGlobal(anexo.pCBSSN, anexo.pIBSSN, caminho, erros, baseURL);
  return {
    par,
    semRedistribuicaoISS: semInformado ? parGlobal(sem!.pCBSSN, sem!.pIBSSN, `${caminho}/semRedistribuicaoISS`, erros, baseURL) : null,
  };
}

/** `FonteRequisicao.obter`: lê a linha do corpo; ausente => VSN-039; fora do formato => VSN-005/VSN-007 (globais). */
function obterLinha(a: AliquotasEfetivasInput | null | undefined, baseURL: string): LinhaAliquotas {
  if (a == null) {
    throw new ErrosCalculoException([
      erroGlobal(
        baseURL,
        CODIGOS_VSN.ALIQUOTAS_EFETIVAS_AUSENTES,
        RAIZ,
        "A linha de alíquotas efetivas do contribuinte (aliquotasEfetivas) é obrigatória no cálculo não assistido quando o regime calcula tributos.",
      ),
    ]);
  }
  const erros: ErroDetalhe[] = [];
  // A ordem de avaliação dos argumentos (I, II, III, IV, V) define a ordem dos erros.
  const anexoI = anexoParUnico(a.anexoI, "anexoI", erros, baseURL);
  const anexoII = anexoParUnico(a.anexoII, "anexoII", erros, baseURL);
  const anexoIII = anexoComIssGlobal(a.anexoIII, "anexoIII", erros, baseURL);
  const anexoIV = anexoComIssGlobal(a.anexoIV, "anexoIV", erros, baseURL);
  const anexoV = anexoComIssGlobal(a.anexoV, "anexoV", erros, baseURL);
  if (erros.length > 0) throw new ErrosCalculoException(erros);
  return {
    fatorR: a.fatorR ?? null,
    impedimentoSublimite: a.impedimentoSublimite === true,
    anexoI,
    anexoII,
    anexoIII,
    anexoIV,
    anexoV,
  };
}

// ─── Avisos da operação ──────────────────────────────────────────────────────

function avisosDaOperacao(
  vocabulario: Vocabulario,
  regime: RegimeApuracao,
  informadoRegime: RegimeInformado,
  linha: LinhaAliquotas | null,
): string[] {
  const avisos: string[] = [];
  if (linha != null) {
    const geraIbs = regime.geraIbs === true;
    if (geraIbs === linha.impedimentoSublimite) {
      avisos.push(
        `Regime de apuração ${regime.codigo} (${descreverRegime(vocabulario, informadoRegime)}) diverge do indicador de impedimento por sublimite da linha de alíquotas (${linha.impedimentoSublimite})`,
      );
    }
  }
  if (informadoRegime.regApIBSCBSSN === 2 && informadoRegime.regApTribSN === 1) {
    avisos.push(
      "regApIBSCBSSN 2 (excesso de sublimite) com regApTribSN 1: incoerente — quem excede o sublimite tem o ISS fora do Simples Nacional",
    );
  }
  return avisos;
}

// ─── Resolvedor do item (núcleo unificado) ───────────────────────────────────

function itemSeguro(item: ItemSimplesUnificadoInput | null): ItemSimplesUnificadoInput {
  return item != null ? item : {};
}

function resolvedorUnificado(
  item: ItemSimplesUnificadoInput,
  vocabulario: Vocabulario,
  linha: LinhaAliquotas,
  fatosDaOperacao: Map<string, number>,
  situacoes: ReturnType<typeof buscarSituacoesIss>,
): ResolvedorAliquotasItem {
  const semPar = (cAtivSN: string | null, motivo: ResolucaoAliquotaItemDomain["motivo"], avisos: string[]): AliquotasItem => ({
    pIBSSN: null,
    pCBSSN: null,
    naoCalcular: false,
    resolucao: {
      numero: item.numero ?? null,
      cAtivSN,
      anexoAplicado: null,
      tipoAliquota: null,
      regraAliquota: null,
      pIBSSN: null,
      pCBSSN: null,
      motivo,
      avisos,
    },
  });
  const ponteiroLinha = (caminho: string) => `#/${RAIZ}/${caminho}`;

  const exigir = (
    exigida: boolean,
    aliquota: AliquotaDecimal | null,
    codigo: CodigoValidacaoSimples,
    campo: string,
    escolha: EscolhaParAliquotas,
    collector: ItemCollector,
  ) => {
    if (!exigida || aliquota != null) return;
    const par = escolha.tipoAliquota === "SEM_REDISTRIBUICAO" && !escolha.parSemRedistribuicaoAusente ? "sem" : "com";
    const detalhe =
      escolha.tipoAliquota === "PAR_UNICO"
        ? `A alíquota ${campo} do anexo ${escolha.anexo} é exigida para o cálculo do item e não está na linha de alíquotas.`
        : `A alíquota ${campo} do anexo ${escolha.anexo} (par ${par} redistribuição do ISS, regra ${escolha.regra}) é exigida para o cálculo do item e não está na linha de alíquotas.`;
    collector.addErroValidacaoNoPonteiro(codigo, ponteiroLinha(`${escolha.caminhoPar}/${campo}`), detalhe);
  };

  return {
    resolver(dados, collector): AliquotasItem {
      const cAtivSN = dados.atividade.cAtivSN;
      if (dados.atividade.atividade == null) {
        return semPar(cAtivSN, "ATIVIDADE_DESCONHECIDA", []);
      }
      const atividade = dados.atividade.atividade;

      const avisos: string[] = [];
      const fatos = new Map(fatosDaOperacao);
      if (dados.atividade.admissivel) {
        const iss = avaliarCamposIss(
          vocabulario,
          atividade,
          { tribISSQN: item.tribISSQN ?? null, tpRetISSQN: item.tpRetISSQN ?? null, tpBM: item.tpBM ?? null },
          collector,
        );
        avisos.push(...iss.avisos);
        if (iss.tribISSQN != null) fatos.set(CAMPO_TRIBISSQN, iss.tribISSQN);
        if (iss.tpRetISSQN != null) fatos.set(CAMPO_TPRETISSQN, iss.tpRetISSQN);
        if (iss.tpBM != null) fatos.set(CAMPO_TPBM, iss.tpBM);
      }

      const escolha = escolher(atividade, dados.atividade.admissivel, linha, fatos, situacoes);
      if (escolha.motivo === "FATOR_R_AUSENTE") {
        collector.addErroValidacaoNoPonteiro(
          CODIGOS_VSN.FATOR_R_AUSENTE,
          ponteiroLinha("fatorR"),
          `O fatorR é exigido: a atividade ${cAtivSN} é sujeita ao fator "r" (Anexo III ou V).`,
        );
      }
      if (escolha.parSemRedistribuicaoAusente) {
        avisos.push(avisoParSemRedistribuicaoAusente(escolha.anexo));
      }

      const par = escolha.par;
      const pCbs = par == null ? null : par.pCBSSN;
      const pIbs = par == null ? null : par.pIBSSN;
      if (escolha.caminhoPar != null) {
        // Origem REQUISICAO: alíquota exigida e ausente no par escolhido => erro do item.
        exigir(dados.cbsExigida, pCbs, CODIGOS_VSN.ALIQUOTA_CBS_AUSENTE, "pCBSSN", escolha, collector);
        exigir(dados.ibsExigida, pIbs, CODIGOS_VSN.ALIQUOTA_IBS_AUSENTE, "pIBSSN", escolha, collector);
      }

      return {
        pIBSSN: pIbs,
        pCBSSN: pCbs,
        naoCalcular: false,
        resolucao: {
          numero: item.numero ?? null,
          cAtivSN,
          anexoAplicado: escolha.anexo,
          tipoAliquota: escolha.tipoAliquota,
          regraAliquota: escolha.regra,
          pIBSSN: pIbs == null ? null : pIbs.plain,
          pCBSSN: pCbs == null ? null : pCbs.plain,
          motivo: escolha.motivo,
          avisos,
        },
      };
    },
    naoAvaliado: () =>
      semPar(normalizarCAtivSN(item.cAtivSN ?? null, true), "ITEM_NAO_IMPLEMENTADO", []).resolucao,
  };
}

const SEM_ALIQUOTAS: ResolvedorAliquotasItem = {
  resolver: () => ({ pIBSSN: null, pCBSSN: null, naoCalcular: false, resolucao: null }),
  naoAvaliado: () => null,
};

// ─── Processamento do contrato não assistido ─────────────────────────────────

export async function processarOperacaoNaoAssistida(
  op: OperacaoSimplesNaoAssistidaInput,
  baseURL: string,
): Promise<ObservabilidadeSimplesDomain> {
  const dados = await carregarDadosBase();

  // 1. Validação global (HTTP 422): id, versao, data, tpEnteGov, itens.
  const erros: ErroDetalhe[] = [];
  if (op.id == null || isBlank(op.id)) {
    erros.push(erroGlobal(baseURL, CODIGOS_VSN.DADO_GLOBAL_AUSENTE, "id", "O identificador da operação (id) é obrigatório."));
  }
  if (op.versao == null || isBlank(op.versao)) {
    erros.push(erroGlobal(baseURL, CODIGOS_VSN.DADO_GLOBAL_AUSENTE, "versao", "A versão do payload (versao) é obrigatória."));
  }
  let data: string | null = null;
  if (op.data == null || isBlank(op.data)) {
    erros.push(erroGlobal(baseURL, CODIGOS_VSN.DATA_INVALIDA, "data", "A data do fato gerador é obrigatória."));
  } else {
    data = lerData(op.data);
    if (data == null) {
      erros.push(
        erroGlobal(baseURL, CODIGOS_VSN.DATA_INVALIDA, "data", `Data inválida, recebido: '${op.data}' (esperado YYYY-MM-DD).`),
      );
    }
  }
  if (op.tpEnteGov != null && !isBlank(op.tpEnteGov)) {
    const v = inteiroTolerante(op.tpEnteGov);
    if (v == null || v < 1 || v > 4) {
      erros.push(
        erroGlobal(
          baseURL,
          CODIGOS_VSN.TPENTEGOV_INVALIDO,
          "tpEnteGov",
          `Tipo de ente governamental inválido, recebido: '${op.tpEnteGov}' (esperado 1, 2, 3 ou 4).`,
        ),
      );
    }
  }
  if (op.itens == null || op.itens.length === 0) {
    erros.push(erroGlobal(baseURL, CODIGOS_VSN.ITENS_VAZIOS, "itens", "A lista de itens é obrigatória e não pode estar vazia."));
  }

  // validarDocumento
  const documento = validarDocumento(dados, op, data, erros, baseURL);
  if (documento != null) {
    validarRegime(op, documento.vocabulario, erros, baseURL);
    // validarQuantidadeItens
    const maximo = documento.maximoItens;
    if (maximo != null && op.itens != null && op.itens.length > maximo) {
      erros.push(
        erroGlobal(
          baseURL,
          CODIGOS_VSN.QUANTIDADE_ITENS_INVALIDA,
          "itens",
          `O documento ${javaTrim(op.tpDoc as string)} admite ${maximo === 1 ? "exatamente 1 item" : `no máximo ${maximo} itens`}, recebidos ${op.itens.length}.`,
        ),
      );
    }
  }
  if (erros.length > 0) throw new ErrosCalculoException(erros);

  const dataOk = data as string;
  const doc = documento as TipoDfeCalculo;
  const vocabulario = doc.vocabulario;
  const siglaDfe = buscarSiglaVigentePorId(dados, doc.tipoDfeId, dataOk);
  const permiteNcmZero = permiteNcmZeroVigentePorId(dados, doc.tipoDfeId, dataOk);
  const informadoRegime: RegimeInformado = {
    crt: inteiroTolerante(op.CRT),
    tpRegimeIBSCBS: inteiroTolerante(op.tpRegimeIBSCBS),
    opSimpNac: inteiroTolerante(op.opSimpNac),
    regApIBSCBSSN: inteiroTolerante(op.regApIBSCBSSN),
    regApTribSN: inteiroTolerante(op.regApTribSN),
  };

  // 2. Regime de apuração (código neutro) pela tabela de enquadramento.
  const regime = buscarRegimeApuracao(
    dados,
    vocabulario,
    informadoRegime.crt,
    informadoRegime.tpRegimeIBSCBS,
    informadoRegime.opSimpNac,
    informadoRegime.regApIBSCBSSN,
    dataOk,
  );
  if (regime == null) throw new ErrosCalculoException([erroForaDoEscopo(vocabulario, informadoRegime, dataOk, baseURL)]);
  const calculaTributos = regime.calculaTributos === true;

  // 3. Fator de transição de compra governamental.
  const tpEnteGov = inteiroTolerante(op.tpEnteGov);
  let fatorTransicao: Dec | null = null;
  if (tpEnteGov != null && tpEnteGov !== 1) {
    fatorTransicao = buscarFatorTransicaoCompraGov(dados, dataOk);
    if (fatorTransicao == null) {
      throw new ErrosCalculoException([
        erroGlobal(
          baseURL,
          CODIGOS_VSN.COMPRA_GOV_SEM_VIGENCIA,
          "tpEnteGov",
          `Não há parametrização de transição de compra governamental vigente para a data '${dataOk}'.`,
        ),
      ]);
    }
  }

  // 4. Linha de alíquotas: só quando o regime calcula tributos.
  const linha = calculaTributos ? obterLinha(op.aliquotasEfetivas, baseURL) : null;
  const situacoes = calculaTributos ? buscarSituacoesIss(dados, dataOk) : [];
  const avisos = avisosDaOperacao(vocabulario, regime, informadoRegime, linha);

  // 5. Itens.
  const contexto: ContextoItem = {
    data: dataOk,
    tpDoc: parseIntJava(javaTrim(op.tpDoc as string)),
    regime,
    tpEnteGov,
    fatorTransicaoCompraGov: fatorTransicao,
    vocabularioTipoReceita: vocabulario,
    normalizarCAtivSN: true,
    admiteImpostoSeletivo: doc.admiteImpostoSeletivo,
    casasAliquotaCalculo: doc.casasAliquotaCalculo,
    siglaDfe,
    permiteNcmZero,
  };
  const fatos = new Map<string, number>();
  if (informadoRegime.crt != null) fatos.set(CAMPO_CRT, informadoRegime.crt);
  if (informadoRegime.regApIBSCBSSN != null) fatos.set(CAMPO_REGAPIBSCBSSN, informadoRegime.regApIBSCBSSN);
  if (informadoRegime.regApTribSN != null) fatos.set(CAMPO_REGAPTRIBSN, informadoRegime.regApTribSN);

  const itens = (op.itens as Array<ItemSimplesUnificadoInput | null>).map(itemSeguro);
  const entradas: EntradaItem[] = itens.map((item) => ({
    numero: item.numero ?? null,
    cAtivSN: item.cAtivSN ?? null,
    cClassTrib: item.cClassTrib ?? null,
    baseCalculo: item.baseCalculo ?? null,
    valorImpostoSeletivo: item.valorImpostoSeletivo ?? null,
    ...nomenclatura(item),
  }));
  const amb = await ambiente(baseURL, entradas);
  const processados = entradas.map((entrada, i) =>
    processarItem(
      amb,
      entrada,
      i,
      contexto,
      calculaTributos ? resolvedorUnificado(itens[i], vocabulario, linha as LinhaAliquotas, fatos, situacoes) : SEM_ALIQUOTAS,
    ),
  );

  const objetos = ordenarPorNObj(processados.map((p) => p.objeto));
  const oper: NonNullable<ObservabilidadeSimplesDomain["oper"]> = {};
  if (op.data != null) oper.data = op.data;
  if (op.tpDoc != null) oper.tpDoc = op.tpDoc;
  if (op.CRT != null) oper.CRT = op.CRT;
  if (op.tpRegimeIBSCBS != null) oper.tpRegimeIBSCBS = op.tpRegimeIBSCBS;
  if (op.opSimpNac != null) oper.opSimpNac = op.opSimpNac;
  if (op.regApIBSCBSSN != null) oper.regApIBSCBSSN = op.regApIBSCBSSN;
  if (op.regApTribSN != null) oper.regApTribSN = op.regApTribSN;
  if (op.tpEnteGov != null) oper.tpEnteGov = op.tpEnteGov;
  oper.regimeApuracao = regime.codigo;

  const resp: ObservabilidadeSimplesDomain = { oper };
  if (calculaTributos) {
    resp.resolucaoAliquotas = {
      fatorR: (linha as LinhaAliquotas).fatorR,
      indSublimite: (linha as LinhaAliquotas).impedimentoSublimite,
      itens: processados.map((p) => p.resolucao as ResolucaoAliquotaItemDomain),
      avisos,
    };
  }
  resp.objetos = objetos;
  const total = totalSimples(objetos);
  if (total) resp.total = total;
  return resp;
}

/** tpDoc obrigatório e habilitado (VSN-014/015); devolve a linha de cálculo do documento. */
function validarDocumento(
  d: DadosBase,
  op: OperacaoSimplesNaoAssistidaInput,
  data: string | null,
  erros: ErroDetalhe[],
  baseURL: string,
): TipoDfeCalculo | null {
  if (op.tpDoc == null || isBlank(op.tpDoc)) {
    erros.push(
      erroGlobal(baseURL, CODIGOS_VSN.TPDOC_AUSENTE, "tpDoc", "O tipo de documento fiscal (tpDoc) é obrigatório e não foi informado."),
    );
    return null;
  }
  const tpDoc = inteiroTolerante(op.tpDoc);
  if (tpDoc != null && data != null && tpDocSemTratamentoCalculadora(d, tpDoc, data)) {
    erros.push(
      erroGlobal(
        baseURL,
        CODIGOS_VSN.TPDOC_NAO_SUPORTADO,
        "tpDoc",
        `Tipo de documento fiscal (tpDoc) de código ${tpDoc} ainda não possui tratamento implementado no cálculo do Simples Nacional.`,
      ),
    );
    return null;
  }
  if (tpDoc == null || data == null) {
    if (tpDoc == null) {
      erros.push(
        erroGlobal(
          baseURL,
          CODIGOS_VSN.TPDOC_NAO_SUPORTADO,
          "tpDoc",
          `Tipo de documento não suportado pelo cálculo do Simples Nacional, recebido: '${op.tpDoc}'.`,
        ),
      );
    }
    return null;
  }
  const doc = buscarTiposDfeCalculo(d, tpDoc, data)[0];
  if (!doc) {
    erros.push(
      erroGlobal(
        baseURL,
        CODIGOS_VSN.TPDOC_NAO_SUPORTADO,
        "tpDoc",
        `Tipo de documento não suportado pelo cálculo do Simples Nacional, recebido: '${op.tpDoc}'.`,
      ),
    );
    return null;
  }
  return doc;
}

