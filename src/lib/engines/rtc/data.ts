/**
 * Camada de dados do motor local: carga LAZY e CACHEADA em módulo dos JSON oficiais (src/data/rtc/*.json,
 * snapshot das migrações Flyway da RFB; ver docs/DADOS_OFICIAIS.md) + índices em memória.
 *
 * Cada método de `RtcRepos` reproduz uma consulta JPQL/SQL dos repositórios Java
 * (.rfb/.../domain/repository/*.java), inclusive a semântica de vigência por comparação textual de datas ISO
 * (`:data BETWEEN inicio AND COALESCE(fim, :data)`) e os casos de resultado não único (Spring
 * IncorrectResultSizeDataAccessException).
 *
 * Nenhum valor tributário é digitado aqui: tudo vem dos JSON.
 */
import { Dec, D, ZERO } from "./jdecimal";
import { RtcException, ex } from "./errors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
interface Table {
  rows: Row[];
}
type TableFile = Record<string, Table>;

export interface RtcData {
  versaoBase: string;
  ufs: Row[];
  municipios: Map<number, Row>;
  tributos: Map<number, Row>;
  situacoes: Map<number, Row>;
  situacoesPorCd: Map<string, Row[]>;
  tributoSituacao: Row[];
  tributoSituacaoPorSitr: Map<number, Row[]>;
  classificacoes: Map<number, Row>;
  classificacoesPorCd: Map<string, Row[]>;
  percentuaisReducao: Map<string, Row[]>;
  tratamentoClassificacao: Map<number, Row[]>;
  tratamentos: Map<number, Row>;
  fundamentacaoClassificacao: Map<number, Row[]>;
  fundamentacoes: Map<number, Row>;
  ncm: Map<string, Row[]>;
  nbs: Map<string, Row[]>;
  ncmAplicavel: Map<number, Row[]>;
  excecaoNcmAplicavel: Map<number, Row[]>;
  nbsAplicavel: Map<number, Row[]>;
  excecaoNbsAplicavel: Map<number, Row[]>;
  tiposDfePorTipo: Map<number, Row[]>;
  tiposDfe: Map<number, Row>;
  tipoDfeClassificacao: Map<number, Row[]>;
  aliquotaReferencia: Row[];
  aliquotaPadrao: Row[];
  redutorCompraGov: Row[];
  transferenciaCbs: Row[];
  aliquotaAdValorem: Map<number, Row>;
  aliquotaAdValoremPorCltr: Row[];
  adValoremProduto: Row[];
  excecaoAdValoremProduto: Map<number, Row[]>;
  adValoremServico: Row[];
  excecaoAdValoremServico: Map<number, Row[]>;
  aliquotaAdRem: Map<number, Row>;
  adRemProduto: Row[];
  excecaoAdRemProduto: Map<number, Row[]>;
  unidadesMedida: Map<number, Row>;
}

function groupBy<K>(rows: Row[], key: (r: Row) => K): Map<K, Row[]> {
  const m = new Map<K, Row[]>();
  for (const r of rows) {
    const k = key(r);
    const l = m.get(k);
    if (l) l.push(r);
    else m.set(k, [r]);
  }
  return m;
}
function indexBy<K>(rows: Row[], key: (r: Row) => K): Map<K, Row> {
  const m = new Map<K, Row>();
  for (const r of rows) m.set(key(r), r);
  return m;
}

let cache: Promise<RtcData> | null = null;
let loaded: RtcData | null = null;

/** Carrega (uma única vez por processo) os JSON oficiais e monta os índices. */
export function loadRtcData(): Promise<RtcData> {
  if (!cache) {
    cache = build().then((d) => {
      loaded = d;
      return d;
    });
    cache.catch(() => {
      cache = null;
    });
  }
  return cache;
}
/** Acesso síncrono após `loadRtcData()`. */
export function getRtcDataSync(): RtcData {
  if (!loaded) throw new Error("Dados RTC não carregados: aguarde loadRtcData() antes do cálculo.");
  return loaded;
}

async function build(): Promise<RtcData> {
  const [aliq, trat, sit, cls, fund, vinc, ncmF, nbsF, isF, docs, loc, ver] = await Promise.all([
    import("@/data/rtc/aliquotas.json"),
    import("@/data/rtc/tratamentos-tributarios.json"),
    import("@/data/rtc/situacoes-tributarias.json"),
    import("@/data/rtc/classificacoes-tributarias.json"),
    import("@/data/rtc/fundamentacoes-legais.json"),
    import("@/data/rtc/vinculos-ncm-nbs.json"),
    import("@/data/rtc/ncm.json"),
    import("@/data/rtc/nbs.json"),
    import("@/data/rtc/imposto-seletivo.json"),
    import("@/data/rtc/documentos-fiscais.json"),
    import("@/data/rtc/localidades.json"),
    import("@/data/rtc/versao-base.json"),
  ]);
  const f = (m: unknown): TableFile => (m as { default: TableFile }).default;
  const A = f(aliq),
    T = f(trat),
    S = f(sit),
    C = f(cls),
    F = f(fund),
    V = f(vinc),
    N = f(ncmF),
    B = f(nbsF),
    I = f(isF),
    DF = f(docs),
    L = f(loc),
    VB = f(ver);

  const rows = (t: TableFile, n: string): Row[] => t[n]?.rows ?? [];
  const sitr = rows(S, "SITUACAO_TRIBUTARIA");
  const tst = rows(S, "TRIBUTO_SITUACAO_TRIBUTARIA");
  const cltr = rows(C, "CLASSIFICACAO_TRIBUTARIA");
  const versoes = rows(VB, "VERSAO_BASE_DADO");
  const ultima = versoes.reduce((a, b) => (b.VRBD_ID > a.VRBD_ID ? b : a));

  const ncmA = rows(V, "NCM_APLICAVEL");
  const nbsA = rows(V, "NBS_APLICAVEL");
  const aadv = rows(I, "ALIQUOTA_AD_VALOREM");

  return {
    versaoBase: ultima.VRBD_VERSAO_BASE_DADO as string,
    ufs: rows(L, "UF"),
    municipios: indexBy(rows(L, "MUNICIPIO"), (r) => r.MUNI_CD as number),
    tributos: indexBy(rows(A, "TRIBUTO"), (r) => r.TBTO_ID as number),
    situacoes: indexBy(sitr, (r) => r.SITR_ID as number),
    situacoesPorCd: groupBy(sitr, (r) => r.SITR_CD as string),
    tributoSituacao: tst,
    tributoSituacaoPorSitr: groupBy(tst, (r) => r.TRST_SITR_ID as number),
    classificacoes: indexBy(cltr, (r) => r.CLTR_ID as number),
    classificacoesPorCd: groupBy(cltr, (r) => r.CLTR_CD as string),
    percentuaisReducao: groupBy(rows(C, "PERCENTUAL_REDUCAO"), (r) => `${r.PERE_CLTR_ID}:${r.PERE_TBTO_ID}`),
    tratamentoClassificacao: groupBy(rows(T, "TRATAMENTO_CLASSIFICACAO"), (r) => r.TRCL_CLTR_ID as number),
    tratamentos: indexBy(rows(T, "TRATAMENTO_TRIBUTARIO"), (r) => r.TRTR_ID as number),
    fundamentacaoClassificacao: groupBy(rows(F, "FUNDAMENTACAO_CLASSIFICACAO"), (r) => r.FDCL_CLTR_ID as number),
    fundamentacoes: indexBy(rows(F, "FUNDAMENTACAO_LEGAL"), (r) => r.FDLG_ID as number),
    ncm: groupBy(rows(N, "NCM"), (r) => r.NCM_CD as string),
    nbs: groupBy(rows(B, "NBS"), (r) => r.NBS_CD as string),
    ncmAplicavel: groupBy(ncmA, (r) => r.NCMA_CLTR_ID as number),
    excecaoNcmAplicavel: groupBy(rows(V, "EXCECAO_NCM_APLICAVEL"), (r) => r.ENCM_NCMA_ID as number),
    nbsAplicavel: groupBy(nbsA, (r) => r.NBSA_CLTR_ID as number),
    excecaoNbsAplicavel: groupBy(rows(V, "EXCECAO_NBS_APLICAVEL"), (r) => r.ENBS_NBSA_ID as number),
    tiposDfePorTipo: groupBy(rows(DF, "TIPO_DFE"), (r) => r.TPDF_TIPO as number),
    tiposDfe: indexBy(rows(DF, "TIPO_DFE"), (r) => r.TPDF_ID as number),
    tipoDfeClassificacao: groupBy(rows(DF, "TIPO_DFE_CLASSIFICACAO"), (r) => r.TDCL_CLTR_ID as number),
    aliquotaReferencia: rows(A, "ALIQUOTA_REFERENCIA"),
    aliquotaPadrao: rows(A, "ALIQUOTA_PADRAO"),
    redutorCompraGov: rows(A, "REDUTOR_COMPRA_GOVERNAMENTAL"),
    transferenciaCbs: rows(A, "TRANSFERENCIA_CBS_ENTE_GOV"),
    aliquotaAdValorem: indexBy(aadv, (r) => r.AADV_ID as number),
    aliquotaAdValoremPorCltr: aadv,
    adValoremProduto: rows(I, "ALIQUOTA_AD_VALOREM_PRODUTO"),
    excecaoAdValoremProduto: groupBy(rows(I, "EXCECAO_AD_VALOREM_PRODUTO"), (r) => r.EAVP_AAVP_ID as number),
    adValoremServico: rows(I, "ALIQUOTA_AD_VALOREM_SERVICO"),
    excecaoAdValoremServico: groupBy(rows(I, "EXCECAO_AD_VALOREM_SERVICO"), (r) => r.EAVS_AAVS_ID as number),
    aliquotaAdRem: indexBy(rows(I, "ALIQUOTA_AD_REM"), (r) => r.AARE_ID as number),
    adRemProduto: rows(I, "ALIQUOTA_AD_REM_PRODUTO"),
    excecaoAdRemProduto: groupBy(rows(I, "EXCECAO_AD_REM_PRODUTO"), (r) => r.EARP_AARP_ID as number),
    unidadesMedida: indexBy(rows(A, "UNIDADE_MEDIDA"), (r) => r.UNMD_ID as number),
  };
}

// ───────────────────────────── helpers de consulta ─────────────────────────────

/** `inicio <= data AND (fim IS NULL OR fim >= data)` (JPQL). */
const vigente = (inicio: string | null, fim: string | null, data: string) =>
  inicio !== null && inicio <= data && (fim === null || fim >= data);
/** `:data BETWEEN inicio AND COALESCE(fim, :data)` (JPQL/SQL nativo; inicio nulo => falso, como no Java). */
const entre = (inicio: string | null, fim: string | null, data: string) =>
  inicio !== null && data >= inicio && data <= (fim ?? data);
/** SUBSTRING(s, 1, LENGTH(p)) = p  <=>  p é prefixo de s (ou igual). */
const prefixo = (p: string, s: string) => s.slice(0, p.length) === p;

/** Resultado único de uma consulta Spring Data; >1 linha => IncorrectResultSizeDataAccessException. */
function unico<T>(rows: T[]): T | null {
  if (rows.length > 1) {
    throw ex.sistema(`Incorrect result size: expected 1, actual ${rows.length}`);
  }
  return rows[0] ?? null;
}

export interface ClassificacaoDTO {
  id: number;
  codigo: string;
  nomenclatura: string | null;
  cst: string;
}
export interface ClassificacaoCalculoDTO {
  id: number;
  codigo: string;
  tipoAliquota: string;
  inGrupoMonofasiaPadrao: boolean;
  inGrupoMonofasiaReten: boolean;
  inGrupoMonofasiaRet: boolean;
  inGrupoMonofasiaDiferimento: boolean;
  inGrupoReducao: boolean;
}
export interface TratamentoClassificacaoDTO {
  idTratamentoTributario: number;
  idClassificacaoTributaria: number;
  inIncompativelComSuspensao: boolean;
  inExigeGrupoDesoneracao: boolean;
}
export interface TratamentoTributario {
  id: number;
  descricao: string;
  expressaoAliquota: string | null;
  expressaoAliquotaEfetiva: string | null;
  expressaoBaseCalculo: string | null;
  expressaoTributoCalculado: string | null;
  expressaoTributoDevido: string | null;
  expressaoPercentualDiferimento: string | null;
  expressaoValorDiferimento: string | null;
  inIncompativelComSuspensao: boolean;
  inExigeGrupoDesoneracao: boolean;
  inPossuiPercentualReducao: boolean;
  inPossuiAjuste: boolean;
  inPossuiRedutor: boolean;
  inPossuiMonofasia: boolean;
}
export interface SituacaoTributaria {
  id: number;
  codigo: string;
  inGrupoIbsCbs: boolean;
  inGrupoReducao: boolean;
}
export interface TipoDfe {
  id: number;
  tipo: number;
  sigla: string;
  permiteNcmZero: boolean;
  possuiTratamento: boolean;
}
export interface FundamentacaoDTO {
  textoCurto: string | null;
  memoriaCalculo: string | null;
}
export interface AliquotaResultadoDTO {
  valorAplicavel: Dec;
}
export interface AliquotaAdValoremDTO {
  valor: Dec | null;
}
export interface AliquotaAdRemDTO {
  valor: Dec | null;
  unidadeMedida: string;
}

const dec = (v: unknown): Dec | null => (v === null || v === undefined ? null : new D(String(v)));
const bool = (v: unknown): boolean => v === 1 || v === true;

/** Repositórios + serviços de consulta (Java: repository/* e service/*Service.java). */
export class RtcRepos {
  constructor(readonly d: RtcData) {}

  // ── Uf / Município (UfRepository, MunicipioRepository, UfService, MunicipioService)
  private ufPorSigla(sigla: string): Row | undefined {
    const up = sigla.toUpperCase();
    return this.d.ufs.find((u) => u.UF_SIGLA === up);
  }
  buscarUf(sigla: string): number {
    const u = this.ufPorSigla(sigla);
    if (!u) throw ex.ufNaoEncontrada(sigla);
    return u.UF_CD as number;
  }
  validarUf(sigla: string): void {
    if (!this.ufPorSigla(sigla)) throw ex.ufNaoEncontrada(sigla);
  }
  validarMunicipio(codigo: number, siglaUf: string): void {
    const m = this.d.municipios.get(codigo);
    if (!m) throw ex.municipioNaoEncontrado(codigo);
    const uf = this.d.ufs.find((u) => u.UF_CD === m.MUNI_UF_CD);
    if ((uf?.UF_SIGLA as string).toLowerCase() !== siglaUf.toLowerCase()) {
      throw ex.municipioNaoPertencente(codigo, siglaUf);
    }
  }
  buscarUfPorMunicipio(codigo: number): string {
    const m = this.d.municipios.get(codigo);
    if (!m) throw ex.municipioNaoEncontrado(codigo);
    return this.d.ufs.find((u) => u.UF_CD === m.MUNI_UF_CD)!.UF_SIGLA as string;
  }

  // ── TipoDfe (TipoDfeService / TipoDfeRepository)
  buscarTipoDfe(tpDoc: number | null, data: string): TipoDfe | null {
    if (tpDoc === null) return null;
    const rows = (this.d.tiposDfePorTipo.get(tpDoc) ?? []).filter((r) => entre(r.TPDF_INICIO_VIGENCIA, r.TPDF_FIM_VIGENCIA, data));
    const r = unico(rows);
    if (!r) throw ex.tipoDfeNaoEncontrado(tpDoc, data);
    const t: TipoDfe = {
      id: r.TPDF_ID,
      tipo: r.TPDF_TIPO,
      sigla: r.TPDF_SIGLA,
      permiteNcmZero: bool(r.TPDF_B_PERMITE_NCM_ZERO),
      possuiTratamento: bool(r.TPDF_B_POSSUI_TRATAMENTO_CALCULADORA),
    };
    if (!t.possuiTratamento) throw ex.tipoDfeNaoTratado(t.tipo, t.sigla);
    return t;
  }
  /** TipoDfeClassificacaoRepository.buscar -> ids de TIPO_DFE vinculados à classificação na data. */
  tiposDfeVinculados(idCltr: number, data: string): TipoDfe[] {
    return (this.d.tipoDfeClassificacao.get(idCltr) ?? [])
      .filter((r) => vigente(r.TDCL_INICIO_VIGENCIA, r.TDCL_FIM_VIGENCIA, data))
      .map((r) => this.d.tiposDfe.get(r.TDCL_TPDF_ID)!)
      .map((r) => ({
        id: r.TPDF_ID,
        tipo: r.TPDF_TIPO,
        sigla: r.TPDF_SIGLA,
        permiteNcmZero: bool(r.TPDF_B_PERMITE_NCM_ZERO),
        possuiTratamento: bool(r.TPDF_B_POSSUI_TRATAMENTO_CALCULADORA),
      }));
  }

  // ── Situação tributária (SituacaoTributariaRepository / Service)
  /** existeCst: tributo + CST + vigência do vínculo e da situação (sem vigência do tributo). */
  existeCst(cst: string, idTributo: number, data: string): boolean {
    for (const s of this.d.situacoesPorCd.get(cst) ?? []) {
      if (!entre(s.SITR_INICIO_VIGENCIA, s.SITR_FIM_VIGENCIA, data)) continue;
      for (const t of this.d.tributoSituacaoPorSitr.get(s.SITR_ID) ?? []) {
        if (t.TRST_TBTO_ID === idTributo && entre(t.TRST_INICIO_VIGENCIA, t.TRST_FIM_VIGENCIA, data)) return true;
      }
    }
    return false;
  }
  validarCst(cst: string, idTributo: number, data: string): void {
    if (!this.existeCst(cst, idTributo, data)) {
      throw ex.situacaoTributariaNaoEncontrada(cst, idTributo === 1 ? "Imposto Seletivo" : "CBS e IBS", data);
    }
  }
  /** consultarSituacaoTributariaPorCodigo (SQL nativo, LIMIT 1, inclui vigência do tributo). */
  consultarSituacaoPorCodigo(cst: string, idTributo: number, data: string): SituacaoTributaria | null {
    for (const s of this.d.situacoesPorCd.get(cst) ?? []) {
      if (!entre(s.SITR_INICIO_VIGENCIA, s.SITR_FIM_VIGENCIA, data)) continue;
      for (const t of this.d.tributoSituacaoPorSitr.get(s.SITR_ID) ?? []) {
        if (t.TRST_TBTO_ID !== idTributo || !entre(t.TRST_INICIO_VIGENCIA, t.TRST_FIM_VIGENCIA, data)) continue;
        const tb = this.d.tributos.get(t.TRST_TBTO_ID);
        if (!tb || !entre(tb.TBTO_INICIO_VIGENCIA, tb.TBTO_FIM_VIGENCIA, data)) continue;
        return {
          id: s.SITR_ID,
          codigo: s.SITR_CD,
          inGrupoIbsCbs: bool(s.SITR_IND_GIBSCBS),
          inGrupoReducao: bool(s.SITR_IND_GRED),
        };
      }
    }
    return null;
  }

  // ── Classificação tributária (ClassificacaoTributariaRepository / Service)
  private classificacaoPorCodigo(codigo: string, idTributo: number, data: string): ClassificacaoDTO[] {
    const out: ClassificacaoDTO[] = [];
    for (const c of this.d.classificacoesPorCd.get(codigo) ?? []) {
      if (!entre(c.CLTR_INICIO_VIGENCIA, c.CLTR_FIM_VIGENCIA, data)) continue;
      const s = this.d.situacoes.get(c.CLTR_SITR_ID);
      if (!s || !entre(s.SITR_INICIO_VIGENCIA, s.SITR_FIM_VIGENCIA, data)) continue;
      for (const t of this.d.tributoSituacaoPorSitr.get(s.SITR_ID) ?? []) {
        if (t.TRST_TBTO_ID !== idTributo || !entre(t.TRST_INICIO_VIGENCIA, t.TRST_FIM_VIGENCIA, data)) continue;
        const tb = this.d.tributos.get(t.TRST_TBTO_ID);
        if (!tb || !entre(tb.TBTO_INICIO_VIGENCIA, tb.TBTO_FIM_VIGENCIA, data)) continue;
        out.push({ id: c.CLTR_ID, codigo: c.CLTR_CD, nomenclatura: c.CLTR_NOMENCLATURA, cst: s.SITR_CD });
      }
    }
    return out;
  }
  buscarClassificacaoCbsIbs(codigo: string, data: string): ClassificacaoDTO {
    const c = unico(this.classificacaoPorCodigo(codigo, 2, data));
    if (!c) throw ex.classificacaoNaoEncontrada(codigo, "CBS e IBS", data);
    return c;
  }
  buscarClassificacaoImpostoSeletivo(codigo: string, data: string): ClassificacaoDTO {
    const c = unico(this.classificacaoPorCodigo(codigo, 1, data));
    if (!c) throw ex.classificacaoNaoEncontrada(codigo, "Imposto Seletivo", data);
    return c;
  }
  buscarClassificacaoCalculo(id: number): ClassificacaoCalculoDTO {
    const c = this.d.classificacoes.get(id);
    if (!c) throw ex.classificacaoNaoEncontradaId(id);
    const s = this.d.situacoes.get(c.CLTR_SITR_ID);
    return {
      id: c.CLTR_ID,
      codigo: c.CLTR_CD,
      tipoAliquota: c.CLTR_TIPO_ALIQUOTA,
      inGrupoMonofasiaPadrao: bool(c.CLTR_IND_GMONOPADRAO),
      inGrupoMonofasiaReten: bool(c.CLTR_IND_GMONORETEN),
      inGrupoMonofasiaRet: bool(c.CLTR_IND_GMONORET),
      inGrupoMonofasiaDiferimento: bool(c.CLTR_IND_GMONODIF),
      inGrupoReducao: bool(s?.SITR_IND_GRED),
    };
  }

  // ── Tratamento (TratamentoClassificacaoRepository / TratamentoTributarioService)
  buscarTratamentoClassificacao(idCltr: number, data: string): TratamentoClassificacaoDTO {
    const rows = (this.d.tratamentoClassificacao.get(idCltr) ?? []).filter((r) =>
      vigente(r.TRCL_INICIO_VIGENCIA, r.TRCL_FIM_VIGENCIA, data),
    );
    const r = unico(rows);
    if (!r) throw ex.tratamentoClassificacaoNaoEncontrado(idCltr, data);
    const tt = this.d.tratamentos.get(r.TRCL_TRTR_ID)!;
    return {
      idTratamentoTributario: r.TRCL_TRTR_ID,
      idClassificacaoTributaria: r.TRCL_CLTR_ID,
      inIncompativelComSuspensao: bool(tt.TRTR_IN_INCOMPATIVEL_COM_SUSPENSAO),
      inExigeGrupoDesoneracao: bool(tt.TRTR_IN_EXIGE_GRUPO_DESONERACAO),
    };
  }
  buscarTratamentoTributario(id: number): TratamentoTributario {
    const t = this.d.tratamentos.get(id);
    if (!t) throw ex.tratamentoTributarioNaoEncontrado(id);
    return {
      id: t.TRTR_ID,
      descricao: t.TRTR_DESCRICAO,
      expressaoAliquota: t.TRTR_EXPRESSAO_ALIQUOTA,
      expressaoAliquotaEfetiva: t.TRTR_EXPRESSAO_ALIQUOTA_EFETIVA,
      expressaoBaseCalculo: t.TRTR_EXPRESSAO_BASE_CALCULO,
      expressaoTributoCalculado: t.TRTR_EXPRESSAO_TRIBUTO_CALCULADO,
      expressaoTributoDevido: t.TRTR_EXPRESSAO_TRIBUTO_DEVIDO,
      expressaoPercentualDiferimento: t.TRTR_EXPRESSAO_PERCENTUAL_DIFERIMENTO,
      expressaoValorDiferimento: t.TRTR_EXPRESSAO_VALOR_DIFERIMENTO,
      inIncompativelComSuspensao: bool(t.TRTR_IN_INCOMPATIVEL_COM_SUSPENSAO),
      inExigeGrupoDesoneracao: bool(t.TRTR_IN_EXIGE_GRUPO_DESONERACAO),
      inPossuiPercentualReducao: bool(t.TRTR_IN_POSSUI_PERCENTUAL_REDUCAO),
      inPossuiAjuste: bool(t.TRTR_IN_POSSUI_AJUSTE),
      inPossuiRedutor: bool(t.TRTR_IN_POSSUI_REDUTOR),
      inPossuiMonofasia: bool(t.TRTR_IN_POSSUI_MONOFASIA),
    };
  }

  // ── Percentual de redução / alíquotas
  buscarPercentualReducao(idCltr: number, idTributo: number, data: string): Dec {
    const rows = (this.d.percentuaisReducao.get(`${idCltr}:${idTributo}`) ?? []).filter((r) =>
      vigente(r.PERE_INICIO_VIGENCIA, r.PERE_FIM_VIGENCIA, data),
    );
    const r = unico(rows);
    const v = r ? dec(r.PERE_VALOR) : null;
    if (v === null) throw ex.percentualReducaoNaoEncontrado(idCltr, data);
    return v;
  }
  buscarAliquotaReferencia(idTributo: number, data: string): Dec {
    const rows = this.d.aliquotaReferencia.filter(
      (r) => r.ALRE_TBTO_ID === idTributo && entre(r.ALRE_INICIO_VIGENCIA, r.ALRE_FIM_VIGENCIA, data),
    );
    const r = unico(rows);
    const v = r ? dec(r.ALRE_VALOR) : null;
    if (v === null) throw ex.aliquotaReferenciaNaoEncontrada(idTributo, data);
    return v;
  }
  /** AliquotaPadraoRepository.buscarAliquota + AliquotaResultadoDTO.valorAplicavel(). */
  buscarAliquotaPadrao(idTributo: number, codigoUf: number | null, municipio: number | null, data: string): AliquotaResultadoDTO {
    const linhas: Array<{ ref: Row; padrao: Row | null }> = [];
    for (const r of this.d.aliquotaReferencia) {
      if (r.ALRE_TBTO_ID !== idTributo || !vigente(r.ALRE_INICIO_VIGENCIA, r.ALRE_FIM_VIGENCIA, data)) continue;
      const ps = this.d.aliquotaPadrao.filter(
        (p) =>
          p.ALPA_ALRE_ID === r.ALRE_ID &&
          (municipio === null ? p.ALPA_MUNI_CD === null : p.ALPA_MUNI_CD === municipio) &&
          (codigoUf === null ? p.ALPA_UF_CD === null : p.ALPA_UF_CD === codigoUf) &&
          vigente(p.ALPA_INICIO_VIGENCIA, p.ALPA_FIM_VIGENCIA, data),
      );
      if (ps.length === 0) linhas.push({ ref: r, padrao: null });
      else for (const p of ps) linhas.push({ ref: r, padrao: p });
    }
    const l = unico(linhas);
    if (!l) throw ex.aliquotaNaoEncontrada(idTributo, codigoUf, municipio, data);
    // new AliquotaResultadoDTO(valorReferencia, valorPadrao, formaAplicacao)
    const ref = dec(l.ref.ALRE_VALOR);
    if (ref === null) throw ex.aliquotaReferenciaNaoEncontradaSemArgs();
    if (ref.isNegative()) throw ex.aliquotaNegativa("referencia");
    let padrao = l.padrao ? dec(l.padrao.ALPA_VALOR) : null;
    const forma: string | null = l.padrao?.ALPA_FORMA_APLICACAO ?? null;
    if (padrao !== null) {
      if (padrao.isNegative()) throw ex.aliquotaNegativa("padrao");
      if (forma === null) throw new RtcException("FormaAplicacaoNaoDefinida", "Forma de aplicação da alíquota própria não definida");
      if (forma === "ACRESCIMO") padrao = ref.plus(padrao);
      else if (forma === "DECRESCIMO") padrao = ref.minus(padrao);
      else if (forma !== "SUBSTITUICAO") {
        throw new RtcException("FormaAplicacaoNaoTratada", "Forma de aplicação da alíquota própria não tratada");
      }
      if (padrao.isNegative()) throw ex.aliquotaNegativa("aplicavel");
    } else if (forma !== null) {
      throw new RtcException("AliquotaPadraoNaoEncontrada", "Alíquota padrão não encontrada");
    }
    return { valorAplicavel: padrao ?? ref };
  }
  buscarRedutorCompraGov(data: string): Dec {
    const rows = this.d.redutorCompraGov.filter((r) => vigente(r.RCGO_INICIO_VIGENCIA, r.RCGO_FIM_VIGENCIA, data));
    const r = unico(rows);
    const v = r ? dec(r.RCGO_VALOR) : null;
    if (v === null) throw ex.sistema("Redutor de compra governamental não encontrada.");
    return v;
  }
  /** RedutorCompraGovernamentalService.buscarValorRedutor. */
  buscarValorRedutor(tpEnteGov: number | null, data: string): Dec {
    if (tpEnteGov === null) return ZERO;
    return this.buscarRedutorCompraGov(data);
  }
  buscarPercentualTransferenciaCbs(data: string): Dec {
    const rows = this.d.transferenciaCbs.filter((r) => vigente(r.TCEG_INICIO_VIGENCIA, r.TCEG_FIM_VIGENCIA, data));
    const r = unico(rows);
    const v = r ? dec(r.TCEG_VALOR) : null;
    if (v === null) throw ex.sistema("Percentual de transferência de CBS para ente federativo não encontrada.");
    return v;
  }

  // ── Alíquotas ad valorem/ad rem (IS e alíquotas fixas/setoriais)
  /** AliquotaAdValoremServicoRepository.buscarAliquotaAdValoremPorClassificacaoTributaria (SQL nativo). */
  buscarAdValoremPorClassificacao(idTributo: number, idCltr: number, data: string): Dec | null {
    const rows = this.d.aliquotaAdValoremPorCltr.filter(
      (r) =>
        r.AADV_TBTO_ID === idTributo && r.AADV_CLTR_ID === idCltr && entre(r.AADV_INICIO_VIGENCIA, r.AADV_FIM_VIGENCIA, data),
    );
    if (rows.length > 1) {
      throw ex.erroGenerico("Consulta retornou múltiplos valores quando apenas um era esperado.");
    }
    return rows[0] ? dec(rows[0].AADV_VALOR) : null;
  }
  private nbsExiste(nbs: string): boolean {
    return this.d.nbs.has(nbs);
  }
  private ncmExiste(ncm: string): boolean {
    return this.d.ncm.has(ncm);
  }
  /** AliquotaAdValoremServicoRepository.buscarAliquotaAdValoremDto/existeNbsAdValorem (tabelas de serviço). */
  private adValoremServico(nbs: string | null, idTributo: number | null, idCltr: number | null, data: string): Row[] {
    if (nbs === null || !this.nbsExiste(nbs)) return [];
    const out: Row[] = [];
    for (const a of this.d.adValoremServico) {
      if (!prefixo(a.AAVS_NBS_CD, nbs)) continue;
      const ad = this.d.aliquotaAdValorem.get(a.AAVS_AADV_ID);
      if (!ad) continue;
      if (idTributo !== null && ad.AADV_TBTO_ID !== idTributo) continue;
      if (idCltr !== null && ad.AADV_CLTR_ID !== idCltr) continue;
      if (!entre(a.AAVS_INICIO_VIGENCIA, a.AAVS_FIM_VIGENCIA, data)) continue;
      const exc = this.d.excecaoAdValoremServico.get(a.AAVS_ID) ?? [];
      const bloqueada = exc.some(
        (e) => entre(e.EAVS_INICIO_VIGENCIA, e.EAVS_FIM_VIGENCIA, data) && (prefixo(e.EAVS_NBS_CD, nbs) || prefixo(e.EAVS_NBS_CD, a.AAVS_NBS_CD)),
      );
      if (bloqueada) continue;
      out.push({ ...a, _valor: ad.AADV_VALOR });
    }
    out.sort((x, y) => (y.AAVS_NBS_CD as string).length - (x.AAVS_NBS_CD as string).length);
    return out;
  }
  buscarAdValoremServico(nbs: string | null, idTributo: number, idCltr: number | null, data: string): Dec | null {
    const rows = this.adValoremServico(nbs, idTributo, idCltr, data);
    if (rows.length > 1) {
      throw ex.erroGenerico("Consulta retornou múltiplos valores quando apenas um era esperado.");
    }
    return rows[0] ? dec(rows[0]._valor) : null;
  }
  existeNbsAdValorem(nbs: string, idTributo: number, data: string): boolean {
    return this.adValoremServico(nbs, idTributo, null, data).length > 0;
  }
  /** AliquotaAdValoremProdutoRepository.buscarAliquotaAdValorem (LIMIT 1, mais específico primeiro). */
  buscarAdValoremProduto(ncm: string, idTributo: number, data: string): AliquotaAdValoremDTO | null {
    const r = this.adValoremProdutoCandidatas(ncm, idTributo, data)[0];
    return r ? { valor: dec(r._valor) } : null;
  }
  existeNcmAdValorem(ncm: string, idTributo: number, data: string): boolean {
    return this.adValoremProdutoCandidatas(ncm, idTributo, data).length > 0;
  }
  private adValoremProdutoCandidatas(ncm: string, idTributo: number, data: string): Row[] {
    if (!this.ncmExiste(ncm)) return [];
    const out: Row[] = [];
    for (const a of this.d.adValoremProduto) {
      if (!prefixo(a.AAVP_NCM_CD, ncm)) continue;
      const ad = this.d.aliquotaAdValorem.get(a.AAVP_AADV_ID);
      if (!ad || ad.AADV_TBTO_ID !== idTributo) continue;
      if (!entre(a.AAVP_INICIO_VIGENCIA, a.AAVP_FIM_VIGENCIA, data)) continue;
      const exc = this.d.excecaoAdValoremProduto.get(a.AAVP_ID) ?? [];
      const bloqueada = exc.some(
        (e) => entre(e.EAVP_INICIO_VIGENCIA, e.EAVP_FIM_VIGENCIA, data) && (prefixo(e.EAVP_NCM_CD, ncm) || prefixo(e.EAVP_NCM_CD, a.AAVP_NCM_CD)),
      );
      if (bloqueada) continue;
      out.push({ ...a, _valor: ad.AADV_VALOR });
    }
    out.sort((x, y) => (y.AAVP_NCM_CD as string).length - (x.AAVP_NCM_CD as string).length);
    return out;
  }
  /** AliquotaAdRemProdutoRepository.buscarAliquotaAdRem. */
  buscarAdRemProduto(ncm: string, idTributo: number, data: string): AliquotaAdRemDTO | null {
    if (!this.ncmExiste(ncm)) return null;
    const out: Row[] = [];
    for (const a of this.d.adRemProduto) {
      if (!prefixo(a.AARP_NCM_CD, ncm)) continue;
      const ad = this.d.aliquotaAdRem.get(a.AARP_AARE_ID);
      if (!ad || ad.AARE_TBTO_ID !== idTributo) continue;
      if (!entre(a.AARP_INICIO_VIGENCIA, a.AARP_FIM_VIGENCIA, data)) continue;
      const exc = this.d.excecaoAdRemProduto.get(a.AARP_ID) ?? [];
      const bloqueada = exc.some(
        (e) => entre(e.EARP_INICIO_VIGENCIA, e.EARP_FIM_VIGENCIA, data) && (prefixo(e.EARP_NCM_CD, ncm) || prefixo(e.EARP_NCM_CD, a.AARP_NCM_CD)),
      );
      if (bloqueada) continue;
      out.push({ ...a, _ad: ad });
    }
    out.sort((x, y) => (y.AARP_NCM_CD as string).length - (x.AARP_NCM_CD as string).length);
    const r = out[0];
    if (!r) return null;
    const um = this.d.unidadesMedida.get(r._ad.AARE_UNMD_ID);
    return { valor: dec(r._ad.AARE_VALOR), unidadeMedida: um?.UNMD_SIGLA };
  }

  // ── NCM / NBS
  existeNcm(ncm: string, data: string): boolean {
    return (this.d.ncm.get(ncm) ?? []).some((r) => entre(r.NCM_INICIO_VIGENCIA, r.NCM_FIM_VIGENCIA, data));
  }
  existeNbs(nbs: string, data: string): boolean {
    return (this.d.nbs.get(nbs) ?? []).some((r) => entre(r.NBS_INICIO_VIGENCIA, r.NBS_FIM_VIGENCIA, data));
  }

  // ── Anexos NCM/NBS aplicáveis (NcmAplicavelRepository / NbsAplicavelRepository)
  ncmAplicavelTem(idCltr: number, data: string): boolean {
    return (this.d.ncmAplicavel.get(idCltr) ?? []).some((n) => entre(n.NCMA_INICIO_VIGENCIA, n.NCMA_FIM_VIGENCIA, data));
  }
  temNcmAplicavel(ncm: string, idCltr: number, data: string): boolean {
    return (this.d.ncmAplicavel.get(idCltr) ?? []).some(
      (n) => prefixo(n.NCMA_NCM_CD, ncm) && entre(n.NCMA_INICIO_VIGENCIA, n.NCMA_FIM_VIGENCIA, data),
    );
  }
  temExcecaoNcmAplicavel(ncm: string, idCltr: number, data: string): boolean {
    for (const n of this.d.ncmAplicavel.get(idCltr) ?? []) {
      if (!prefixo(n.NCMA_NCM_CD, ncm)) continue;
      for (const e of this.d.excecaoNcmAplicavel.get(n.NCMA_ID) ?? []) {
        if (prefixo(e.ENCM_NCM_CD, ncm) && entre(e.ENCM_INICIO_VIGENCIA, e.ENCM_FIM_VIGENCIA, data)) return true;
      }
    }
    return false;
  }
  temNcmAplicavelSemExcecao(ncm: string, idCltr: number, data: string): boolean {
    for (const n of this.d.ncmAplicavel.get(idCltr) ?? []) {
      if (!prefixo(n.NCMA_NCM_CD, ncm) || !entre(n.NCMA_INICIO_VIGENCIA, n.NCMA_FIM_VIGENCIA, data)) continue;
      const exc = this.d.excecaoNcmAplicavel.get(n.NCMA_ID) ?? [];
      if (exc.length === 0) return true; // LEFT JOIN sem exceção (e.id IS NULL)
      if (exc.some((e) => !entre(e.ENCM_INICIO_VIGENCIA, e.ENCM_FIM_VIGENCIA, data))) return true;
    }
    return false;
  }
  nbsAplicavelTem(idCltr: number, data: string): boolean {
    return (this.d.nbsAplicavel.get(idCltr) ?? []).some((n) => entre(n.NBSA_INICIO_VIGENCIA, n.NBSA_FIM_VIGENCIA, data));
  }
  temNbsAplicavel(nbs: string, idCltr: number, data: string): boolean {
    return (this.d.nbsAplicavel.get(idCltr) ?? []).some(
      (n) => prefixo(n.NBSA_NBS_CD, nbs) && entre(n.NBSA_INICIO_VIGENCIA, n.NBSA_FIM_VIGENCIA, data),
    );
  }
  temExcecaoNbsAplicavel(nbs: string, idCltr: number, data: string): boolean {
    for (const n of this.d.nbsAplicavel.get(idCltr) ?? []) {
      if (!prefixo(n.NBSA_NBS_CD, nbs)) continue;
      for (const e of this.d.excecaoNbsAplicavel.get(n.NBSA_ID) ?? []) {
        if (prefixo(e.ENBS_NBS_CD, nbs) && entre(e.ENBS_INICIO_VIGENCIA, e.ENBS_FIM_VIGENCIA, data)) return true;
      }
    }
    return false;
  }
  temNbsAplicavelSemExcecao(nbs: string, idCltr: number, data: string): boolean {
    for (const n of this.d.nbsAplicavel.get(idCltr) ?? []) {
      if (!prefixo(n.NBSA_NBS_CD, nbs) || !entre(n.NBSA_INICIO_VIGENCIA, n.NBSA_FIM_VIGENCIA, data)) continue;
      const exc = this.d.excecaoNbsAplicavel.get(n.NBSA_ID) ?? [];
      if (exc.length === 0) return true;
      if (exc.some((e) => !entre(e.ENBS_INICIO_VIGENCIA, e.ENBS_FIM_VIGENCIA, data))) return true;
    }
    return false;
  }

  // ── Fundamentação (FundamentacaoClassificacaoRepository)
  buscarFundamentacao(idCltr: number, data: string): FundamentacaoDTO {
    const rows = (this.d.fundamentacaoClassificacao.get(idCltr) ?? []).filter((r) =>
      entre(r.FDCL_INICIO_VIGENCIA, r.FDCL_FIM_VIGENCIA, data),
    );
    const r = unico(rows);
    if (!r) throw ex.fundamentacaoNaoEncontrada(idCltr, data);
    return {
      textoCurto: this.d.fundamentacoes.get(r.FDCL_FDLG_ID)?.FDLG_TEXTO_CURTO ?? null,
      memoriaCalculo: this.d.classificacoes.get(idCltr)?.CLTR_MEMORIA_CALCULO ?? null,
    };
  }
}
