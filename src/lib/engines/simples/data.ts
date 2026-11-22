import { D, type Dec } from "./decimal";

/**
 * Carga LAZY e CACHEADA dos dados oficiais (`src/data/rtc/*.json`, gerados das migrações Flyway da RFB;
 * o Simples usa o mesmo banco do regime regular). Nada é digitado à mão: só o que existe nos JSON.
 *
 * Os JSON são importados dinamicamente (literais, para o bundler/trace do Next incluí-los na rota Node).
 * `ncm.json` (2,4 MB) e `nbs.json` só são lidos quando algum item informa NCM/NBS.
 *
 * Datas são texto ISO (`YYYY-MM-DD`), comparadas lexicograficamente — exatamente como o SQLite do motor
 * oficial compara `:data BETWEEN INICIO AND COALESCE(FIM, :data)`.
 */

type Tabelas = Record<string, { rows: Array<Record<string, unknown>> }>;

async function carregar(arquivo: string): Promise<Tabelas> {
  switch (arquivo) {
    case "simples-nacional":
      return (await import("@/data/rtc/simples-nacional.json")).default as unknown as Tabelas;
    case "documentos-fiscais":
      return (await import("@/data/rtc/documentos-fiscais.json")).default as unknown as Tabelas;
    case "classificacoes-tributarias":
      return (await import("@/data/rtc/classificacoes-tributarias.json")).default as unknown as Tabelas;
    case "situacoes-tributarias":
      return (await import("@/data/rtc/situacoes-tributarias.json")).default as unknown as Tabelas;
    case "aliquotas":
      return (await import("@/data/rtc/aliquotas.json")).default as unknown as Tabelas;
    case "tratamentos-tributarios":
      return (await import("@/data/rtc/tratamentos-tributarios.json")).default as unknown as Tabelas;
    case "vinculos-ncm-nbs":
      return (await import("@/data/rtc/vinculos-ncm-nbs.json")).default as unknown as Tabelas;
    case "ncm":
      return (await import("@/data/rtc/ncm.json")).default as unknown as Tabelas;
    case "nbs":
      return (await import("@/data/rtc/nbs.json")).default as unknown as Tabelas;
    default:
      throw new Error(`Arquivo de dados desconhecido: ${arquivo}`);
  }
}

/** `:data BETWEEN inicio AND COALESCE(fim, :data)`. */
export function vigente(data: string, inicio: unknown, fim: unknown): boolean {
  if (typeof inicio !== "string") return false;
  return inicio <= data && data <= (typeof fim === "string" ? fim : data);
}

const bool = (v: unknown): boolean | null => (v == null ? null : v === 1 || v === true || v === "1");
const str = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number | null => (v == null ? null : Number(v));

// ─── Linhas tipadas ──────────────────────────────────────────────────────────

export type Vocabulario = "CRT" | "NFSE";
export type DestinoValor = "DEVIDO" | "PENDENTE_SUSPENSO" | "ZERO";

export interface Vig {
  inicio: string;
  fim: string | null;
}

export interface AtividadeSn extends Vig {
  id: number;
  ordem: number;
  descricao: string;
  anexoSemFatorR: string | null;
  anexoComFatorR: string | null;
  rotulo: string;
  rotuloCurto: string;
  cAtivSN: string | null;
  naoTributavel: boolean;
  issNoSimples: boolean;
  admiteBeneficioMunicipal: boolean;
}

export interface RegimeApuracao extends Vig {
  id: number;
  codigo: "SN_PLENO" | "SN_SUBLIMITE" | "PENDENTE" | "PENDENTE_SUBLIMITE" | "SOMENTE_RECEITA";
  calculaTributos: boolean;
  geraIbs: boolean | null;
  destinoDevido: DestinoValor | null;
  destinoPendenteSuspenso: DestinoValor | null;
}

export interface Enquadramento extends Vig {
  id: number;
  vocabulario: Vocabulario;
  crt: number | null;
  tpRegimeIBSCBS: number | null;
  opSimpNac: number | null;
  regApIBSCBSSN: number | null;
  regimeId: number;
}

export interface SituacaoIss extends Vig {
  id: number;
  campo: string;
  valor: number;
  regra: string;
  tipoAliquota: string;
  ordem: number;
}

export interface TipoDfeCalculo extends Vig {
  id: number;
  tipoDfeId: number;
  vocabulario: Vocabulario;
  casasAliquotaCalculo: number | null;
  maximoItens: number | null;
  admiteImpostoSeletivo: boolean;
}

export interface TipoReceitaBruta extends Vig {
  id: number;
  codigo: number;
  descricao: string;
  compoeReceita: boolean;
  impostoSeletivoCompoeReceita: boolean;
  fatorReceita: Dec;
  pendenteSuspenso: boolean;
  exigeAliquota: boolean;
  vedadoNaoTributavel: boolean;
  vocabulario: Vocabulario | null;
}

export interface TransicaoCompraGov extends Vig {
  id: number;
  fator: Dec;
}

export interface TipoDfe extends Vig {
  id: number;
  sigla: string;
  tipo: number | null;
  permiteNcmZero: boolean;
  possuiTratamentoCalculadora: boolean;
}

export interface TipoDfeAtividade extends Vig {
  atividadeId: number;
  tipoDfeId: number;
}

export interface ClassificacaoTributaria extends Vig {
  id: number;
  codigo: string;
  sitrId: number;
  tpRBSN: number;
}

export interface TributoSituacao extends Vig {
  sitrId: number;
  tributoId: number;
}

export interface Situacao extends Vig {
  id: number;
}

export interface Tributo extends Vig {
  id: number;
}

export interface TratamentoClassificacao extends Vig {
  cltrId: number;
  trtrId: number;
}

export interface Tratamento extends Vig {
  id: number;
  possuiAjuste: boolean;
}

export interface TipoDfeClassificacao extends Vig {
  cltrId: number;
  tipoDfeId: number;
}

export interface VinculoNomenclatura extends Vig {
  id: number;
  codigo: string;
  cltrId: number;
}

export interface ExcecaoNomenclatura extends Vig {
  id: number;
  codigo: string;
  vinculoId: number;
}


const vig = (r: Record<string, unknown>, ini: string, fim: string): Vig => ({
  inicio: String(r[ini]),
  fim: str(r[fim]),
});

/** Todas as tabelas do Simples e do domínio compartilhado necessárias ao cálculo, já tipadas. */
export interface DadosBase {
  atividades: AtividadeSn[];
  regimes: Map<number, RegimeApuracao>;
  enquadramentos: Enquadramento[];
  situacoesIss: SituacaoIss[];
  tiposDfeCalculo: TipoDfeCalculo[];
  tiposReceitaBruta: TipoReceitaBruta[];
  transicoesCompraGov: TransicaoCompraGov[];
  tiposDfe: TipoDfe[];
  tiposDfeAtividade: TipoDfeAtividade[];
  classificacoes: ClassificacaoTributaria[];
  tributoSituacoes: TributoSituacao[];
  situacoes: Situacao[];
  tributos: Tributo[];
  tratamentoClassificacoes: TratamentoClassificacao[];
  tratamentos: Map<number, Tratamento>;
  tiposDfeClassificacao: TipoDfeClassificacao[];
  ncmAplicavel: VinculoNomenclatura[];
  excecaoNcm: ExcecaoNomenclatura[];
  nbsAplicavel: VinculoNomenclatura[];
  excecaoNbs: ExcecaoNomenclatura[];
  /** SITR_IDs que têm linha de TRIBUTO_SITUACAO_TRIBUTARIA para a CBS (tributo 2), sem filtro de vigência. */
  sitrComCbs: Set<number>;
}

async function montarBase(): Promise<DadosBase> {
  const [sn, doc, cl, sit, aliq, trat, vinc] = await Promise.all([
    carregar("simples-nacional"),
    carregar("documentos-fiscais"),
    carregar("classificacoes-tributarias"),
    carregar("situacoes-tributarias"),
    carregar("aliquotas"),
    carregar("tratamentos-tributarios"),
    carregar("vinculos-ncm-nbs"),
  ]);

  const regimes = new Map<number, RegimeApuracao>();
  for (const r of sn.REGIME_APURACAO_SIMPLES_NACIONAL.rows) {
    regimes.set(Number(r.RASN_ID), {
      id: Number(r.RASN_ID),
      codigo: String(r.RASN_CD) as RegimeApuracao["codigo"],
      calculaTributos: bool(r.RASN_IN_CALCULA_TRIBUTOS) === true,
      geraIbs: bool(r.RASN_IN_GERA_IBS),
      destinoDevido: str(r.RASN_DESTINO_DEVIDO) as DestinoValor | null,
      destinoPendenteSuspenso: str(r.RASN_DESTINO_PENDENTE_SUSPENSO) as DestinoValor | null,
      ...vig(r, "RASN_INICIO_VIGENCIA", "RASN_FIM_VIGENCIA"),
    });
  }

  const tratamentos = new Map<number, Tratamento>();
  for (const r of trat.TRATAMENTO_TRIBUTARIO.rows) {
    tratamentos.set(Number(r.TRTR_ID), {
      id: Number(r.TRTR_ID),
      possuiAjuste: bool(r.TRTR_IN_POSSUI_AJUSTE) === true,
      ...vig(r, "TRTR_INICIO_VIGENCIA", "TRTR_FIM_VIGENCIA"),
    });
  }

  const tributoSituacoes = sit.TRIBUTO_SITUACAO_TRIBUTARIA.rows.map((r) => ({
    sitrId: Number(r.TRST_SITR_ID),
    tributoId: Number(r.TRST_TBTO_ID),
    ...vig(r, "TRST_INICIO_VIGENCIA", "TRST_FIM_VIGENCIA"),
  }));

  return {
    atividades: sn.ATIVIDADE_SIMPLES_NACIONAL.rows.map((r) => ({
      id: Number(r.ATSN_ID),
      ordem: Number(r.ATSN_ORDEM),
      descricao: String(r.ATSN_DESCRICAO),
      anexoSemFatorR: str(r.ATSN_ANEXO_SEM_FATOR_R),
      anexoComFatorR: str(r.ATSN_ANEXO_COM_FATOR_R),
      rotulo: String(r.ATSN_ROTULO),
      rotuloCurto: String(r.ATSN_ROTULO_CURTO),
      cAtivSN: str(r.ATSN_CATIVSN),
      naoTributavel: bool(r.ATSN_IN_NAO_TRIBUTAVEL) === true,
      issNoSimples: bool(r.ATSN_IN_ISS_NO_SIMPLES) === true,
      admiteBeneficioMunicipal: bool(r.ATSN_IN_ADMITE_BENEFICIO_MUNICIPAL) === true,
      ...vig(r, "ATSN_INICIO_VIGENCIA", "ATSN_FIM_VIGENCIA"),
    })),
    regimes,
    enquadramentos: sn.ENQUADRAMENTO_REGIME_SIMPLES_NACIONAL.rows.map((r) => ({
      id: Number(r.ERSN_ID),
      vocabulario: String(r.ERSN_VOCABULARIO_REGIME) as Vocabulario,
      crt: num(r.ERSN_CRT),
      tpRegimeIBSCBS: num(r.ERSN_TPREGIMEIBSCBS),
      opSimpNac: num(r.ERSN_OPSIMPNAC),
      regApIBSCBSSN: num(r.ERSN_REGAPIBSCBSSN),
      regimeId: Number(r.ERSN_RASN_ID),
      ...vig(r, "ERSN_INICIO_VIGENCIA", "ERSN_FIM_VIGENCIA"),
    })),
    situacoesIss: sn.SITUACAO_ISS_PAR_ALIQUOTA_SIMPLES_NACIONAL.rows.map((r) => ({
      id: Number(r.SIPA_ID),
      campo: String(r.SIPA_CAMPO),
      valor: Number(r.SIPA_VALOR),
      regra: String(r.SIPA_REGRA),
      tipoAliquota: String(r.SIPA_TIPO_ALIQUOTA),
      ordem: Number(r.SIPA_ORDEM),
      ...vig(r, "SIPA_INICIO_VIGENCIA", "SIPA_FIM_VIGENCIA"),
    })),
    tiposDfeCalculo: sn.TIPO_DFE_CALCULO_SIMPLES_NACIONAL.rows.map((r) => ({
      id: Number(r.TDCS_ID),
      tipoDfeId: Number(r.TDCS_TPDF_ID),
      vocabulario: String(r.TDCS_VOCABULARIO_REGIME) as Vocabulario,
      casasAliquotaCalculo: num(r.TDCS_CASAS_ALIQUOTA_CALCULO),
      maximoItens: num(r.TDCS_MAXIMO_ITENS),
      admiteImpostoSeletivo: bool(r.TDCS_IN_ADMITE_IS) === true,
      ...vig(r, "TDCS_INICIO_VIGENCIA", "TDCS_FIM_VIGENCIA"),
    })),
    tiposReceitaBruta: sn.TIPO_RECEITA_BRUTA_SIMPLES_NACIONAL.rows.map((r) => ({
      id: Number(r.TRBS_ID),
      codigo: Number(r.TRBS_CD),
      descricao: String(r.TRBS_DESCRICAO),
      compoeReceita: bool(r.TRBS_IN_COMPOE_RECEITA) === true,
      impostoSeletivoCompoeReceita: bool(r.TRBS_IN_IS_COMPOE_RECEITA) === true,
      fatorReceita: new D(String(r.TRBS_FATOR_RECEITA)),
      pendenteSuspenso: bool(r.TRBS_IN_PENDENTE_SUSPENSO) === true,
      exigeAliquota: bool(r.TRBS_IN_EXIGE_ALIQUOTA) === true,
      vedadoNaoTributavel: bool(r.TRBS_IN_VEDADO_NAO_TRIBUTAVEL) === true,
      vocabulario: str(r.TRBS_VOCABULARIO_REGIME) as Vocabulario | null,
      ...vig(r, "TRBS_INICIO_VIGENCIA", "TRBS_FIM_VIGENCIA"),
    })),
    transicoesCompraGov: sn.TRANSICAO_ALIQUOTA_COMPRA_GOV_SIMPLES_NACIONAL.rows.map((r) => ({
      id: Number(r.TACG_ID),
      fator: new D(String(r.TACG_FATOR)),
      ...vig(r, "TACG_INICIO_VIGENCIA", "TACG_FIM_VIGENCIA"),
    })),
    tiposDfe: doc.TIPO_DFE.rows.map((r) => ({
      id: Number(r.TPDF_ID),
      sigla: String(r.TPDF_SIGLA),
      tipo: num(r.TPDF_TIPO),
      permiteNcmZero: bool(r.TPDF_B_PERMITE_NCM_ZERO) === true,
      possuiTratamentoCalculadora: bool(r.TPDF_B_POSSUI_TRATAMENTO_CALCULADORA) === true,
      ...vig(r, "TPDF_INICIO_VIGENCIA", "TPDF_FIM_VIGENCIA"),
    })),
    tiposDfeAtividade: sn.TIPO_DFE_ATIVIDADE_SIMPLES_NACIONAL.rows.map((r) => ({
      atividadeId: Number(r.TDAS_ATSN_ID),
      tipoDfeId: Number(r.TDAS_TPDF_ID),
      ...vig(r, "TDAS_INICIO_VIGENCIA", "TDAS_FIM_VIGENCIA"),
    })),
    classificacoes: cl.CLASSIFICACAO_TRIBUTARIA.rows.map((r) => ({
      id: Number(r.CLTR_ID),
      codigo: String(r.CLTR_CD),
      sitrId: Number(r.CLTR_SITR_ID),
      tpRBSN: Number(r.CLTR_TPRBSN),
      ...vig(r, "CLTR_INICIO_VIGENCIA", "CLTR_FIM_VIGENCIA"),
    })),
    tributoSituacoes,
    situacoes: sit.SITUACAO_TRIBUTARIA.rows.map((r) => ({
      id: Number(r.SITR_ID),
      ...vig(r, "SITR_INICIO_VIGENCIA", "SITR_FIM_VIGENCIA"),
    })),
    tributos: aliq.TRIBUTO.rows.map((r) => ({
      id: Number(r.TBTO_ID),
      ...vig(r, "TBTO_INICIO_VIGENCIA", "TBTO_FIM_VIGENCIA"),
    })),
    tratamentoClassificacoes: trat.TRATAMENTO_CLASSIFICACAO.rows.map((r) => ({
      cltrId: Number(r.TRCL_CLTR_ID),
      trtrId: Number(r.TRCL_TRTR_ID),
      ...vig(r, "TRCL_INICIO_VIGENCIA", "TRCL_FIM_VIGENCIA"),
    })),
    tratamentos,
    tiposDfeClassificacao: doc.TIPO_DFE_CLASSIFICACAO.rows.map((r) => ({
      cltrId: Number(r.TDCL_CLTR_ID),
      tipoDfeId: Number(r.TDCL_TPDF_ID),
      ...vig(r, "TDCL_INICIO_VIGENCIA", "TDCL_FIM_VIGENCIA"),
    })),
    ncmAplicavel: vinc.NCM_APLICAVEL.rows.map((r) => ({
      id: Number(r.NCMA_ID),
      codigo: String(r.NCMA_NCM_CD),
      cltrId: Number(r.NCMA_CLTR_ID),
      ...vig(r, "NCMA_INICIO_VIGENCIA", "NCMA_FIM_VIGENCIA"),
    })),
    excecaoNcm: vinc.EXCECAO_NCM_APLICAVEL.rows.map((r) => ({
      id: Number(r.ENCM_ID),
      codigo: String(r.ENCM_NCM_CD),
      vinculoId: Number(r.ENCM_NCMA_ID),
      ...vig(r, "ENCM_INICIO_VIGENCIA", "ENCM_FIM_VIGENCIA"),
    })),
    nbsAplicavel: vinc.NBS_APLICAVEL.rows.map((r) => ({
      id: Number(r.NBSA_ID),
      codigo: String(r.NBSA_NBS_CD),
      cltrId: Number(r.NBSA_CLTR_ID),
      ...vig(r, "NBSA_INICIO_VIGENCIA", "NBSA_FIM_VIGENCIA"),
    })),
    excecaoNbs: vinc.EXCECAO_NBS_APLICAVEL.rows.map((r) => ({
      id: Number(r.ENBS_ID),
      codigo: String(r.ENBS_NBS_CD),
      vinculoId: Number(r.ENBS_NBSA_ID),
      ...vig(r, "ENBS_INICIO_VIGENCIA", "ENBS_FIM_VIGENCIA"),
    })),
    sitrComCbs: new Set(tributoSituacoes.filter((t) => t.tributoId === 2).map((t) => t.sitrId)),
  };
}

let basePromise: Promise<DadosBase> | null = null;
let ncmPromise: Promise<Map<string, Vig[]>> | null = null;
let nbsPromise: Promise<Map<string, Vig[]>> | null = null;

/** Tabelas do cálculo (carga única por processo). */
export function carregarDadosBase(): Promise<DadosBase> {
  if (!basePromise) {
    basePromise = montarBase().catch((e) => {
      basePromise = null;
      throw e;
    });
  }
  return basePromise;
}

async function indexar(arquivo: "ncm" | "nbs", tabela: string, cd: string, ini: string, fim: string) {
  const t = await carregar(arquivo);
  const m = new Map<string, Vig[]>();
  for (const r of t[tabela].rows) {
    const k = String(r[cd]);
    const l = m.get(k);
    const v = vig(r, ini, fim);
    if (l) l.push(v);
    else m.set(k, [v]);
  }
  return m;
}

/** Índice NCM_CD -> vigências (carga sob demanda). */
export function carregarNcm(): Promise<Map<string, Vig[]>> {
  if (!ncmPromise) {
    ncmPromise = indexar("ncm", "NCM", "NCM_CD", "NCM_INICIO_VIGENCIA", "NCM_FIM_VIGENCIA").catch((e) => {
      ncmPromise = null;
      throw e;
    });
  }
  return ncmPromise;
}

/** Índice NBS_CD -> vigências (carga sob demanda). */
export function carregarNbs(): Promise<Map<string, Vig[]>> {
  if (!nbsPromise) {
    nbsPromise = indexar("nbs", "NBS", "NBS_CD", "NBS_INICIO_VIGENCIA", "NBS_FIM_VIGENCIA").catch((e) => {
      nbsPromise = null;
      throw e;
    });
  }
  return nbsPromise;
}

export function existeNaTabela(indice: Map<string, Vig[]>, codigo: string, data: string): boolean {
  return (indice.get(codigo) ?? []).some((v) => vigente(data, v.inicio, v.fim));
}

/** Ordena por início de vigência decrescente (estável: empates ficam na ordem da tabela). */
export function maisRecentePrimeiro<T extends Vig>(linhas: T[]): T[] {
  return [...linhas].sort((a, b) => (a.inicio < b.inicio ? 1 : a.inicio > b.inicio ? -1 : 0));
}

