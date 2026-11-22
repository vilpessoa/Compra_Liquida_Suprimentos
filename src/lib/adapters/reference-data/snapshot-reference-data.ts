/**
 * ReferenceDataPort sobre o snapshot oficial da RFB (src/data/rtc/*.json), via `RtcRepos` do motor local.
 *
 * Nada é digitado aqui: NCM/NBS, UF/MUNICIPIO, CLASSIFICACAO_TRIBUTARIA, PERCENTUAL_REDUCAO, fundamentações e
 * vínculos vêm dos JSON; a vigência usa a mesma comparação textual de datas ISO do motor (`entre`).
 *
 * VÍNCULO NCM/NBS <-> cClassTrib (`classificacoesPorNcmNbs`)
 * Reproduz a regra de `ProcessamentoItemService.obterTratamentoClassificacao` quando o `tpDoc` é informado
 * (aqui 55 = NF-e para NCM; 91 = NFS-e para NBS, os documentos naturais de bens e de serviços), usando os
 * métodos oficiais portados em `RtcRepos` (buscarClassificacaoCbsIbs, tiposDfeVinculados, ncmAplicavelTem,
 * temNcmAplicavel, temExcecaoNcmAplicavel, temNcmAplicavelSemExcecao e equivalentes de NBS):
 *   1. a classificação (CBS/IBS) deve estar vigente na data, com situação tributária vigente e tratamento
 *      vigente (senão o motor devolve erro e o item não calcula);
 *   2. deve estar vinculada ao tipo de DFe (`validarVinculoTipoDfe`);
 *   3. nomenclatura (`NomenclaturaService.determinarNomenclatura`): NF-e: NCM se a classificação tem anexo
 *      de NCM, senão SEM; NFS-e: MISTO/NCM/NBS/SEM conforme os anexos; cClassTrib 200038 e 515001 são
 *      "exceção" (NCM na NF-e, NBS na NFS-e);
 *   4. crítica contra o anexo (`NcmAplicavelService`/`NbsAplicavelService`): se a classificação tem anexo, o
 *      código precisa estar nele (prefixo) e não pode cair em exceção sem outra entrada sem exceção.
 * As funções de orquestração acima são privadas no motor (e src/lib/engines/** não pode ser alterado), então a
 * composição está espelhada AQUI com o mesmo código e fontes Java citadas; o teste `snapshot-reference-data.test.ts`
 * confronta o resultado com o próprio motor (para vários NCM/NBS, toda classificação candidata) para garantir que
 * não há divergência.
 */
import type { Indeterminado, Proveniencia } from "@/lib/ports/common";
import type {
  ClassificacaoTributaria,
  ClassificacoesVinculadas,
  FundamentacaoLegalOficial,
  Municipio,
  NcmNbs,
  ReferenceDataPort,
  Uf,
} from "@/lib/ports/reference-data";
import { getRtcRepos } from "@/lib/engines/rtc";
import meta from "@/data/rtc/meta.json";
import versaoBase from "@/data/rtc/versao-base.json";
import type { RtcRepos } from "@/lib/engines/rtc/data";

/** NomenclaturaService.java:44 (EXCEPTION_CLASSIFICACOES). */
const CLASSIFICACOES_EXCECAO = new Set(["200038", "515001"]);
const TP_DOC_NFE = 55;
const TP_DOC_NFSE = 91;
const ID_TRIBUTO_CBS = 2;
const ID_TRIBUTO_IBS_UF = 3;
const ID_TRIBUTO_IBS_MUN = 4;

const entre = (inicio: string | null, fim: string | null, data: string) =>
  inicio !== null && data >= inicio && data <= (fim ?? data);

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Row = Record<string, unknown>;

const flag = (v: unknown): boolean => v === 1 || v === true;

export const FONTE_OFICIAL = "ReceitaFederal/calculadora-rtc-regime-regular";

export class SnapshotReferenceData implements ReferenceDataPort {
  readonly id = "snapshot";
  private readonly prov: Proveniencia = (() => {
    const sha = meta.sources.find((x) => x.repo === "calculadora-rtc-regime-regular")?.sha ?? "desconhecido";
    const linhas = versaoBase.VERSAO_BASE_DADO.rows as Array<{ VRBD_ID: number; VRBD_VERSAO_BASE_DADO: string }>;
    const ultima = linhas.reduce((x, y) => (y.VRBD_ID > x.VRBD_ID ? y : x));
    return { fonte: FONTE_OFICIAL, versao: `${sha}+base:${ultima.VRBD_VERSAO_BASE_DADO}`, adapter: "snapshot" };
  })();

  private async repos(): Promise<RtcRepos> {
    return getRtcRepos();
  }

  proveniencia(): Proveniencia {
    return this.prov;
  }

  // ───────────── NCM / NBS ─────────────

  private linhasVigentes(tipo: "NCM" | "NBS", r: RtcRepos, data: string): NcmNbs[] {
    const out: NcmNbs[] = [];
    const mapa = (tipo === "NCM" ? r.d.ncm : r.d.nbs) as Map<string, Row[]>;
    const pref = tipo === "NCM" ? "NCM" : "NBS";
    for (const rows of mapa.values()) {
      for (const x of rows) {
        const ini = x[`${pref}_INICIO_VIGENCIA`] as string | null;
        const fim = x[`${pref}_FIM_VIGENCIA`] as string | null;
        if (!entre(ini, fim, data)) continue;
        const codigo = x[`${pref}_CD`] as string;
        out.push({
          codigo,
          descricao: (x[`${pref}_DESCRICAO`] as string) ?? "",
          tipo,
          completo: codigo.length === (tipo === "NCM" ? 8 : 9),
          inicioVigencia: ini ?? undefined,
          fimVigencia: fim,
        });
        break;
      }
    }
    return out;
  }

  async buscarNcmNbs(termo: string, data: string, limite = 20, tipo?: "NCM" | "NBS"): Promise<NcmNbs[]> {
    const r = await this.repos();
    const t = termo.trim();
    if (t === "") return [];
    const digitos = t.replace(/[.\s-]/g, "");
    const porCodigo = /^\d+$/.test(digitos);
    const tokens = semAcento(t).split(/\s+/).filter(Boolean);
    const tipos: Array<"NCM" | "NBS"> = tipo ? [tipo] : ["NCM", "NBS"];
    const achados: NcmNbs[] = [];
    for (const tp of tipos) {
      for (const x of this.linhasVigentes(tp, r, data)) {
        if (porCodigo) {
          if (x.codigo.startsWith(digitos)) achados.push(x);
        } else {
          const d = semAcento(x.descricao);
          if (tokens.every((k) => d.includes(k))) achados.push(x);
        }
      }
    }
    // Código exato primeiro, depois códigos completos (selecionáveis), depois por código.
    achados.sort((a, b) => {
      const ea = a.codigo === digitos ? 0 : 1;
      const eb = b.codigo === digitos ? 0 : 1;
      if (ea !== eb) return ea - eb;
      if (a.completo !== b.completo) return a.completo ? -1 : 1;
      return a.codigo.localeCompare(b.codigo) || a.tipo.localeCompare(b.tipo);
    });
    return achados.slice(0, Math.max(1, limite));
  }

  async obterNcmNbs(codigo: string, data: string): Promise<NcmNbs | null> {
    const r = await this.repos();
    const c = codigo.trim();
    for (const tp of ["NCM", "NBS"] as const) {
      if (tp === "NCM" && !/^\d{2,8}$/.test(c)) continue;
      if (tp === "NBS" && !/^\d{1,9}$/.test(c)) continue;
      const mapa = (tp === "NCM" ? r.d.ncm : r.d.nbs) as Map<string, Row[]>;
      for (const x of mapa.get(c) ?? []) {
        const ini = x[`${tp}_INICIO_VIGENCIA`] as string | null;
        const fim = x[`${tp}_FIM_VIGENCIA`] as string | null;
        if (!entre(ini, fim, data)) continue;
        return {
          codigo: c,
          descricao: (x[`${tp}_DESCRICAO`] as string) ?? "",
          tipo: tp,
          completo: c.length === (tp === "NCM" ? 8 : 9),
          inicioVigencia: ini ?? undefined,
          fimVigencia: fim,
        };
      }
    }
    return null;
  }

  // ───────────── Classificações ─────────────

  private montarClassificacao(r: RtcRepos, cd: string, data: string): ClassificacaoTributaria | null {
    let basico;
    try {
      basico = r.buscarClassificacaoCbsIbs(cd, data);
    } catch {
      return null; // inexistente/ambígua na data: o motor também não calcula
    }
    const row = r.d.classificacoes.get(basico.id) as Row;
    const reducao = (idTributo: number): string | null => {
      const linhas = ((r.d.percentuaisReducao.get(`${basico.id}:${idTributo}`) ?? []) as Row[]).filter((p) =>
        // `vigente` do motor: inicio <= data e (fim nulo ou fim >= data)
        (p.PERE_INICIO_VIGENCIA as string | null) !== null &&
        (p.PERE_INICIO_VIGENCIA as string) <= data &&
        (p.PERE_FIM_VIGENCIA === null || (p.PERE_FIM_VIGENCIA as string) >= data),
      );
      return linhas.length === 1 && linhas[0].PERE_VALOR !== null ? String(linhas[0].PERE_VALOR) : null;
    };
    const fundamentacao: FundamentacaoLegalOficial[] = [];
    for (const f of (r.d.fundamentacaoClassificacao.get(basico.id) ?? []) as Row[]) {
      if (!entre(f.FDCL_INICIO_VIGENCIA as string | null, f.FDCL_FIM_VIGENCIA as string | null, data)) continue;
      const fl = r.d.fundamentacoes.get(f.FDCL_FDLG_ID as number) as Row | undefined;
      if (!fl) continue;
      fundamentacao.push({
        textoCurto: (fl.FDLG_TEXTO_CURTO as string | null) ?? null,
        texto: (fl.FDLG_TEXTO as string | null) ?? null,
        referenciaNormativa: (fl.FDLG_REFERENCIA_NORMATIVA as string | null) ?? null,
      });
    }
    let exigeGrupoReg = false;
    let implementado = true;
    try {
      const tc = r.buscarTratamentoClassificacao(basico.id, data);
      exigeGrupoReg = tc.inExigeGrupoDesoneracao;
      implementado = !r.buscarTratamentoTributario(tc.idTratamentoTributario).inPossuiAjuste;
    } catch {
      return null; // sem tratamento vigente único: o motor devolve erro
    }
    return {
      cClassTrib: basico.codigo,
      cst: basico.cst,
      descricao: (row.CLTR_DESCRICAO as string) ?? basico.nomenclatura ?? "",
      tipoAliquota: (row.CLTR_TIPO_ALIQUOTA as string | null) ?? null,
      nomenclatura: (row.CLTR_NOMENCLATURA as string | null) ?? null,
      percentuaisReducao: { cbs: reducao(ID_TRIBUTO_CBS), ibsUf: reducao(ID_TRIBUTO_IBS_UF), ibsMun: reducao(ID_TRIBUTO_IBS_MUN) },
      flagsCredito: {
        apropriacaoCreditoAdquirenteCbs: flag(row.CLTR_IN_APROPRIACAO_CREDITOS_ADQUIRENTES_CBS),
        apropriacaoCreditoAdquirenteIbs: flag(row.CLTR_IN_APROPRIACAO_CREDITOS_ADQUIRENTES_IBS),
        creditoPresumidoAdquirente: flag(row.CLTR_IN_CREDITO_PRESUMIDO_ADQUIRENTE),
        creditoPresumidoFornecedor: flag(row.CLTR_IN_CREDITO_PRESUMIDO_FORNECEDOR),
        creditoOperacaoAntecedente: (row.CLTR_CREDITO_OPERACAO_ANTECEDENTE as string | null) ?? null,
      },
      fundamentacaoLegal: fundamentacao,
      exigeGrupoTributacaoRegular: exigeGrupoReg,
      calculoImplementado: implementado,
      inicioVigencia: (row.CLTR_INICIO_VIGENCIA as string | null) ?? undefined,
      fimVigencia: (row.CLTR_FIM_VIGENCIA as string | null) ?? null,
    };
  }

  async obterClassificacao(cClassTrib: string, data: string): Promise<ClassificacaoTributaria | null> {
    const r = await this.repos();
    return this.montarClassificacao(r, cClassTrib.trim(), data);
  }

  /**
   * Regra oficial de vínculo de UMA classificação com um NCM (NF-e) ou NBS (NFS-e).
   * Espelha `validarVinculoTipoDfe` + `NomenclaturaService.determinarNomenclatura` +
   * `ValidacaoNomenclaturaService.validarNomenclatura` (ver cabeçalho do arquivo).
   */
  private vinculada(
    r: RtcRepos,
    tipo: "NCM" | "NBS",
    codigo: string,
    cltr: { id: number; codigo: string },
    tipoDfeId: number,
    data: string,
  ): boolean {
    // validarVinculoTipoDfe
    if (!r.tiposDfeVinculados(cltr.id, data).some((t) => t.id === tipoDfeId)) return false;
    const ncmAplicavel = r.ncmAplicavelTem(cltr.id, data);
    const nbsAplicavel = r.nbsAplicavelTem(cltr.id, data);
    const excecao = CLASSIFICACOES_EXCECAO.has(cltr.codigo);

    const criticaNcm = () =>
      !ncmAplicavel ||
      (r.temNcmAplicavel(codigo, cltr.id, data) &&
        !(r.temExcecaoNcmAplicavel(codigo, cltr.id, data) && !r.temNcmAplicavelSemExcecao(codigo, cltr.id, data)));
    const criticaNbs = () =>
      !nbsAplicavel ||
      (r.temNbsAplicavel(codigo, cltr.id, data) &&
        !(r.temExcecaoNbsAplicavel(codigo, cltr.id, data) && !r.temNbsAplicavelSemExcecao(codigo, cltr.id, data)));

    if (tipo === "NCM") {
      // NF-e: "NCM" se há anexo de NCM; exceção => EXCECAO_NCM; senão SEM (NCM aceito sem crítica).
      if (excecao || ncmAplicavel) return criticaNcm();
      return true;
    }
    // NFS-e (NBS informado, NCM em branco)
    if (excecao) return criticaNbs(); // EXCECAO_NBS
    if (ncmAplicavel && nbsAplicavel) return criticaNbs(); // MISTO com NBS
    if (ncmAplicavel) return false; // NCM: NBS é nomenclatura incompatível
    if (nbsAplicavel) return criticaNbs(); // NBS
    return true; // SEM: NBS é a nomenclatura natural da NFS-e
  }

  async classificacoesPorNcmNbs(codigo: string, data: string): Promise<ClassificacoesVinculadas> {
    const prov = this.prov;
    const r = await this.repos();
    const c = codigo.trim();
    const ind = (cod: string, mensagem: string, acao: string): Indeterminado => ({ status: "INDETERMINADO", codigo: cod, mensagem, acao });
    if (!/^\d{8}$/.test(c) && !/^\d{9}$/.test(c)) {
      return ind(
        "NCM_NBS_FORMATO_INVALIDO",
        `"${c}" não é um NCM completo (8 dígitos) nem um NBS completo (9 dígitos); o vínculo oficial exige o código completo.`,
        "Selecione um NCM (8 dígitos) ou NBS (9 dígitos) completo.",
      );
    }
    const tipo: "NCM" | "NBS" = c.length === 8 ? "NCM" : "NBS";
    const existe = tipo === "NCM" ? r.existeNcm(c, data) : r.existeNbs(c, data);
    if (!existe) {
      return ind(
        tipo === "NCM" ? "NCM_NAO_ENCONTRADO" : "NBS_NAO_ENCONTRADO",
        `${tipo} ${c} não existe ou não está vigente em ${data} na tabela oficial.`,
        `Conferir o ${tipo} ou a data do fato gerador.`,
      );
    }
    const tpDoc = tipo === "NCM" ? TP_DOC_NFE : TP_DOC_NFSE;
    let tipoDfeId: number;
    try {
      const t = r.buscarTipoDfe(tpDoc, data);
      tipoDfeId = t!.id;
    } catch {
      return ind(
        "TIPO_DFE_NAO_VIGENTE",
        `O tipo de documento ${tpDoc} não está vigente em ${data} na base oficial.`,
        "Conferir a data do fato gerador (a base oficial começa em 2026-01-01).",
      );
    }
    const classificacoes: ClassificacaoTributaria[] = [];
    for (const cd of [...r.d.classificacoesPorCd.keys()].sort()) {
      const cltr = this.montarClassificacao(r, cd, data);
      if (!cltr) continue;
      const basico = r.buscarClassificacaoCbsIbs(cd, data);
      if (this.vinculada(r, tipo, c, basico, tipoDfeId, data)) classificacoes.push(cltr);
    }
    if (classificacoes.length === 0) {
      return ind(
        "SEM_CLASSIFICACAO_VINCULADA",
        `Nenhuma cClassTrib da base oficial está vinculada ao ${tipo} ${c} em ${data}.`,
        "Bloquear a decisão; conferir o código e a data, ou consultar a RFB.",
      );
    }
    return { status: "OK", codigo: c, tipo, tpDoc, data, classificacoes, proveniencia: prov };
  }

  // ───────────── Localidades ─────────────

  async listarUfs(): Promise<Uf[]> {
    const r = await this.repos();
    return (r.d.ufs as Row[])
      .map((u) => ({ codigo: u.UF_CD as number, sigla: u.UF_SIGLA as string, nome: u.UF_NOME as string }))
      .sort((a, b) => a.sigla.localeCompare(b.sigla));
  }

  private municipio(r: RtcRepos, m: Row): Municipio {
    const uf = (r.d.ufs as Row[]).find((u) => u.UF_CD === m.MUNI_UF_CD);
    return { codigoIbge: m.MUNI_CD as number, nome: m.MUNI_NOME as string, uf: (uf?.UF_SIGLA as string) ?? "" };
  }

  async listarMunicipios(uf: string): Promise<Municipio[]> {
    const r = await this.repos();
    const ufRow = (r.d.ufs as Row[]).find((u) => (u.UF_SIGLA as string) === uf.trim().toUpperCase());
    if (!ufRow) return [];
    return [...(r.d.municipios as Map<number, Row>).values()]
      .filter((m) => m.MUNI_UF_CD === ufRow.UF_CD)
      .map((m) => this.municipio(r, m))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }

  async obterMunicipio(codigoIbge: number): Promise<Municipio | null> {
    const r = await this.repos();
    const m = (r.d.municipios as Map<number, Row>).get(codigoIbge);
    return m ? this.municipio(r, m) : null;
  }
}
