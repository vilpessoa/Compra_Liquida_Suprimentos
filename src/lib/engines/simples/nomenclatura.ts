import { CODIGOS_VSN, type CodigoValidacaoSimples } from "./codigos";
import type { ItemCollector } from "./collector";
import { carregarNbs, carregarNcm, existeNaTabela, vigente, type ClassificacaoTributaria, type DadosBase } from "./data";
import { isBlank } from "./java-compat";

/**
 * Port de `ValidacaoNomenclaturaAdapter`, `ValidacaoNomenclaturaService`, `NomenclaturaService`,
 * `NcmAplicavelService`, `NbsAplicavelService` e dos repositórios de vínculo NCM/NBS do motor oficial.
 * A hierarquia de exceções vira `ErroNomenclatura` com o mesmo texto.
 */

type TipoErro =
  | "NCM_NBS_SIMULTANEAS"
  | "NCM_NAO_ENCONTRADA"
  | "NBS_NAO_ENCONTRADA"
  | "NCM_COMPLETO"
  | "NBS_COMPLETO"
  | "OBRIGATORIA"
  | "INCOMPATIVEL"
  | "NAO_PERMITIDA"
  | "NCM_NAO_VINCULADA"
  | "NBS_NAO_VINCULADA"
  | "FORMATO"
  /** Qualquer outra exceção (falha técnica, VSN-999). */
  | "TECNICA";

class ErroNomenclatura extends Error {
  constructor(
    readonly tipo: TipoErro,
    mensagem: string,
    readonly campo: string | null = null,
  ) {
    super(mensagem);
  }
}

/** `SiglasDFeEnum`: nome da constante -> sigla de exibição. */
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

const TRIO_RIGIDO = new Set(["NFE", "NFCE", "NFSE"]);
const EXCEPTION_CLASSIFICACOES = new Set(["200038"]);

/** `SiglasDFeEnum.normalizarSigla`. */
function normalizarSigla(sigla: string | null): string {
  if (sigla == null) return "";
  return sigla.toUpperCase().replace(/[ \t\n\u000B\f\r\-_]/g, "");
}

/** `SiglasDFeEnum.getPorSiglaNormalizada` -> nome da constante. */
function siglaPorNormalizada(sigla: string): string {
  const n = normalizarSigla(sigla);
  if (!(n in SIGLAS)) throw new ErroNomenclatura("TECNICA", `Sigla DFe inválida: ${sigla}`);
  return n;
}

const ncmAplicavelSigla = (s: string) => ["NFSE", "NFE", "NFCE"].includes(normalizarSigla(s));
const nbsAplicavelSigla = (s: string) => normalizarSigla(s) === "NFSE";

// ─── Repositórios de vínculo (NCM_APLICAVEL / NBS_APLICAVEL) ─────────────────

type Tipo = "ncm" | "nbs";

function lista(d: DadosBase, t: Tipo) {
  return t === "ncm" ? { v: d.ncmAplicavel, e: d.excecaoNcm } : { v: d.nbsAplicavel, e: d.excecaoNbs };
}

/** `tem(idClassificacaoTributaria, data)`. */
function temVinculo(d: DadosBase, t: Tipo, cltrId: number, data: string): boolean {
  return lista(d, t).v.some((n) => n.cltrId === cltrId && vigente(data, n.inicio, n.fim));
}

/** `temNcmAplicavel`/`temNbsAplicavel`: prefixo do código no vínculo vigente. */
function temAplicavel(d: DadosBase, t: Tipo, codigo: string, cltrId: number, data: string): boolean {
  return lista(d, t).v.some(
    (n) => n.cltrId === cltrId && codigo.startsWith(n.codigo) && vigente(data, n.inicio, n.fim),
  );
}

/** `temExcecao...`: exceção vigente (prefixo na exceção e no vínculo; vigência só da exceção). */
function temExcecao(d: DadosBase, t: Tipo, codigo: string, cltrId: number, data: string): boolean {
  const { v, e } = lista(d, t);
  return e.some((x) => {
    if (!codigo.startsWith(x.codigo) || !vigente(data, x.inicio, x.fim)) return false;
    const n = v.find((nn) => nn.id === x.vinculoId);
    return !!n && codigo.startsWith(n.codigo) && n.cltrId === cltrId;
  });
}

/** `temNcmAplicavelSemExcecao`: LEFT JOIN da exceção pelo id do vínculo (a exceção NÃO é filtrada pelo prefixo). */
function temAplicavelSemExcecao(d: DadosBase, t: Tipo, codigo: string, cltrId: number, data: string): boolean {
  const { v, e } = lista(d, t);
  return v.some((n) => {
    if (n.cltrId !== cltrId || !codigo.startsWith(n.codigo) || !vigente(data, n.inicio, n.fim)) return false;
    const exc = e.filter((x) => x.vinculoId === n.id);
    return exc.length === 0 || exc.some((x) => !vigente(data, x.inicio, x.fim));
  });
}

function criticar(
  d: DadosBase,
  t: Tipo,
  codigo: string,
  cltrId: number,
  cClassTrib: string,
  data: string,
  tributos: string,
  temClassificacao: boolean,
): void {
  if (!temClassificacao) return; // classificação sem anexo: aceitar sem crítica
  const nome = t === "ncm" ? "NCM" : "NBS";
  const naoVinculada = () =>
    new ErroNomenclatura(
      t === "ncm" ? "NCM_NAO_VINCULADA" : "NBS_NAO_VINCULADA",
      `${nome} de código ${codigo} não vinculada à Classificação Tributária de código ${cClassTrib} (${tributos})`,
    );
  if (!temAplicavel(d, t, codigo, cltrId, data)) throw naoVinculada();
  if (temExcecao(d, t, codigo, cltrId, data) && !temAplicavelSemExcecao(d, t, codigo, cltrId, data)) {
    throw naoVinculada();
  }
}

/** `validarNcmAplicavel`/`validarNbsAplicavel` (modo PERMISSIVO, fora do trio rígido). */
function validarAplicavel(
  d: DadosBase,
  t: Tipo,
  codigo: string,
  cltrId: number,
  cClassTrib: string,
  data: string,
  tributos: string,
): void {
  const tamanho = t === "ncm" ? 8 : 9;
  const completo = codigo.length === tamanho;
  const tem = temVinculo(d, t, cltrId, data);
  if (tem && !completo) {
    throw new ErroNomenclatura(t === "ncm" ? "NCM_COMPLETO" : "NBS_COMPLETO", t === "ncm" ? "NCM completo não informado" : "NBS completo não informado");
  }
  if (completo) criticar(d, t, codigo, cltrId, cClassTrib, data, tributos, tem);
}

// ─── NomenclaturaService.determinarNomenclatura ──────────────────────────────

type Resultado = "SEM" | "NCM" | "NBS" | "MISTO" | "EXCECAO_NCM" | "EXCECAO_NBS";

function classificacaoCbsIbs(d: DadosBase, codigo: string, data: string): { id: number } {
  // ClassificacaoTributariaService.buscarClassificacaoTributariaCbsIbs
  const achadas: ClassificacaoTributaria[] = [];
  for (const ct of d.classificacoes) {
    if (ct.codigo !== codigo || !vigente(data, ct.inicio, ct.fim)) continue;
    const st = d.situacoes.find((s) => s.id === ct.sitrId);
    if (!st || !vigente(data, st.inicio, st.fim)) continue;
    for (const tst of d.tributoSituacoes) {
      if (tst.sitrId !== st.id || tst.tributoId !== 2 || !vigente(data, tst.inicio, tst.fim)) continue;
      const tb = d.tributos.find((x) => x.id === tst.tributoId);
      if (!tb || !vigente(data, tb.inicio, tb.fim)) continue;
      achadas.push(ct);
    }
  }
  if (achadas.length === 0) {
    throw new ErroNomenclatura(
      "TECNICA",
      `Classificação tributária não encontrada para código ${codigo} e data ${data} (CBS e IBS)`,
    );
  }
  if (achadas.length > 1) {
    throw new ErroNomenclatura("TECNICA", `Incorrect result size: expected 1, actual ${achadas.length}`);
  }
  return { id: achadas[0].id };
}

function determinarNomenclatura(d: DadosBase, siglaChave: string, cClassTrib: string, data: string): Resultado {
  const { id } = classificacaoCbsIbs(d, cClassTrib, data);

  // siglaDfeCompativel
  const tipos = d.tiposDfeClassificacao.filter((t) => t.cltrId === id && vigente(data, t.inicio, t.fim));
  const normalizada = siglaPorNormalizada(siglaChave);
  const compativel = tipos.some((t) => {
    const dfe = d.tiposDfe.find((x) => x.id === t.tipoDfeId);
    return !!dfe && normalizada === normalizarSigla(dfe.sigla);
  });
  if (!compativel) return "SEM";

  const ncm = temVinculo(d, "ncm", id, data);
  const nbs = temVinculo(d, "nbs", id, data);

  if (EXCEPTION_CLASSIFICACOES.has(cClassTrib)) {
    if (normalizada === "NFE" || normalizada === "NFCE") return "EXCECAO_NCM";
    if (normalizada === "NFSE") return "EXCECAO_NBS";
    return "SEM";
  }
  if (ncmAplicavelSigla(siglaChave) && !nbsAplicavelSigla(siglaChave)) return ncm ? "NCM" : "SEM";
  if (nbsAplicavelSigla(siglaChave)) {
    if (ncm && nbs) return "MISTO";
    if (ncm) return "NCM";
    if (nbs) return "NBS";
    return "SEM";
  }
  return "SEM";
}

// ─── ValidacaoNomenclaturaService.validar ────────────────────────────────────

function incompativel(nomenclatura: string, cClassTrib: string, sigla: string): ErroNomenclatura {
  return new ErroNomenclatura(
    "INCOMPATIVEL",
    `${nomenclatura} não permitida para a Classificação Tributária de código ${cClassTrib} no tipo de documento ${SIGLAS[sigla]}`,
  );
}

const ncmCompleto = () => new ErroNomenclatura("NCM_COMPLETO", "NCM completo não informado");
const nbsCompleto = () => new ErroNomenclatura("NBS_COMPLETO", "NBS completo não informado");

function validarNomenclatura(
  d: DadosBase,
  sigla: string,
  cltrId: number,
  cClassTrib: string,
  ncm: string | null,
  nbs: string | null,
  data: string,
  tributos: string,
): void {
  const resultado = determinarNomenclatura(d, sigla, cClassTrib, data);
  const len = (s: string | null) => (s == null ? 0 : s.length);
  const ncmInformado = !isBlank(ncm);
  const nbsInformado = !isBlank(nbs);

  switch (resultado) {
    case "NCM":
    case "EXCECAO_NCM":
      if (nbsInformado) throw incompativel("NBS", cClassTrib, sigla);
      if (len(ncm) !== 8) throw ncmCompleto();
      criticar(d, "ncm", ncm as string, cltrId, cClassTrib, data, tributos, temVinculo(d, "ncm", cltrId, data));
      return;
    case "NBS":
    case "EXCECAO_NBS":
      if (ncmInformado) throw incompativel("NCM", cClassTrib, sigla);
      if (len(nbs) !== 9) throw nbsCompleto();
      criticar(d, "nbs", nbs as string, cltrId, cClassTrib, data, tributos, temVinculo(d, "nbs", cltrId, data));
      return;
    case "MISTO":
      if (ncmInformado) {
        if (len(ncm) !== 8) throw ncmCompleto();
        criticar(d, "ncm", ncm as string, cltrId, cClassTrib, data, tributos, temVinculo(d, "ncm", cltrId, data));
      } else if (nbsInformado) {
        if (len(nbs) !== 9) throw nbsCompleto();
        criticar(d, "nbs", nbs as string, cltrId, cClassTrib, data, tributos, temVinculo(d, "nbs", cltrId, data));
      } else {
        throw new ErroNomenclatura(
          "OBRIGATORIA",
          `A Classificação Tributária de código ${cClassTrib} exige NCM ou NBS completo para o tipo de documento ${SIGLAS[sigla]}`,
        );
      }
      return;
    case "SEM":
      if (!ncmInformado && !nbsInformado) return;
      if (TRIO_RIGIDO.has(sigla)) {
        // Dentro do trio a regra é sempre rígida: só a nomenclatura natural do documento é admitida.
        if (sigla === "NFSE") {
          if (ncmInformado) throw incompativel("NCM", cClassTrib, sigla);
        } else if (nbsInformado) {
          throw incompativel("NBS", cClassTrib, sigla);
        }
        return;
      }
      // Modo PERMISSIVO (único usado pelo Simples): critica contra o anexo, sem bloquear.
      if (ncmInformado) validarAplicavel(d, "ncm", ncm as string, cltrId, cClassTrib, data, tributos);
      else validarAplicavel(d, "nbs", nbs as string, cltrId, cClassTrib, data, tributos);
      return;
  }
}

// ─── ValidacaoNomenclaturaAdapter ────────────────────────────────────────────

const isNullOrEmpty = (s: string | null) => s == null || s.length === 0;

function traduzir(ex: ErroNomenclatura, ncm: string | null, nbs: string | null, collector: ItemCollector): boolean {
  let codigo: CodigoValidacaoSimples;
  let campo: string | null = null;
  switch (ex.tipo) {
    case "NCM_NBS_SIMULTANEAS":
      codigo = CODIGOS_VSN.NCM_NBS_SIMULTANEOS;
      campo = "ncm";
      break;
    case "NCM_NAO_ENCONTRADA":
      codigo = CODIGOS_VSN.NCM_NAO_ENCONTRADO;
      campo = "ncm";
      break;
    case "NBS_NAO_ENCONTRADA":
      codigo = CODIGOS_VSN.NBS_NAO_ENCONTRADO;
      campo = "nbs";
      break;
    case "NCM_COMPLETO":
      codigo = CODIGOS_VSN.NCM_INCOMPLETO;
      campo = "ncm";
      break;
    case "NBS_COMPLETO":
      codigo = CODIGOS_VSN.NBS_INCOMPLETO;
      campo = "nbs";
      break;
    case "OBRIGATORIA":
      codigo = CODIGOS_VSN.NOMENCLATURA_OBRIGATORIA;
      break;
    case "INCOMPATIVEL":
      codigo = CODIGOS_VSN.NOMENCLATURA_INCOMPATIVEL;
      campo = !isNullOrEmpty(ncm) ? "ncm" : !isNullOrEmpty(nbs) ? "nbs" : null;
      break;
    case "NAO_PERMITIDA":
      codigo = CODIGOS_VSN.NOMENCLATURA_NAO_PERMITIDA;
      break;
    case "NCM_NAO_VINCULADA":
      codigo = CODIGOS_VSN.NCM_NAO_APLICAVEL;
      campo = "ncm";
      break;
    case "NBS_NAO_VINCULADA":
      codigo = CODIGOS_VSN.NBS_NAO_APLICAVEL;
      campo = "nbs";
      break;
    case "FORMATO":
      codigo = CODIGOS_VSN.NOMENCLATURA_FORMATO_INVALIDO;
      campo = ex.campo;
      break;
    default:
      return false;
  }
  collector.addErroValidacao(codigo, campo, ex.message);
  return true;
}

function registrar(ex: unknown, ncm: string | null, nbs: string | null, collector: ItemCollector): void {
  if (ex instanceof ErroNomenclatura && traduzir(ex, ncm, nbs, collector)) return;
  collector.addFalhaTecnica(ex instanceof Error ? ex.message : String(ex));
}

/** Pré-carrega, quando algum item informa NCM/NBS, os índices de existência (sob demanda). */
export interface Indices {
  ncm: Map<string, import("./data").Vig[]> | null;
  nbs: Map<string, import("./data").Vig[]> | null;
}

export async function prepararIndices(itens: Array<{ NCM: string | null; NBS: string | null }>): Promise<Indices> {
  const precisaNcm = itens.some((i) => !isNullOrEmpty(i.NCM));
  const precisaNbs = itens.some((i) => !isNullOrEmpty(i.NBS));
  return {
    ncm: precisaNcm ? await carregarNcm() : null,
    nbs: precisaNbs ? await carregarNbs() : null,
  };
}

/** Validação estrutural de origem; `false` indica falha já registrada no item. */
export function validarEstrutural(
  ind: Indices,
  ncm: string | null,
  nbs: string | null,
  data: string,
  collector: ItemCollector,
): boolean {
  try {
    if (!isNullOrEmpty(ncm) && !isNullOrEmpty(nbs)) {
      throw new ErroNomenclatura("NCM_NBS_SIMULTANEAS", "Não é permitido informar NCM e NBS simultaneamente para um item");
    }
    if (!isNullOrEmpty(ncm) && !/^[0-9]{8}$/.test(ncm as string)) {
      throw new ErroNomenclatura("FORMATO", "O NCM deve conter exclusivamente 8 dígitos ASCII, sem espaços ou símbolos.", "ncm");
    }
    if (!isNullOrEmpty(nbs) && !/^[0-9]{9}$/.test(nbs as string)) {
      throw new ErroNomenclatura("FORMATO", "O NBS deve conter exclusivamente 9 dígitos ASCII, sem espaços ou símbolos.", "nbs");
    }
    if (!isNullOrEmpty(ncm) && !(ind.ncm && existeNaTabela(ind.ncm, ncm as string, data))) {
      throw new ErroNomenclatura("NCM_NAO_ENCONTRADA", `NCM de código ${ncm} não encontrada para a data ${data}`);
    }
    if (!isNullOrEmpty(nbs) && !(ind.nbs && existeNaTabela(ind.nbs, nbs as string, data))) {
      throw new ErroNomenclatura("NBS_NAO_ENCONTRADA", `NBS de código ${nbs} não encontrada para a data ${data}`);
    }
    return true;
  } catch (ex) {
    registrar(ex, ncm, nbs, collector);
    return false;
  }
}

/** Validação dirigida pela classificação CBS/IBS, depois da resolução do cClassTrib. */
export function validarPorClassificacao(
  d: DadosBase,
  ncm: string | null,
  nbs: string | null,
  data: string,
  siglaDfe: string | null,
  classificacao: ClassificacaoTributaria | null,
  estruturaValida: boolean,
  collector: ItemCollector,
): void {
  if (!estruturaValida || collector.hasErros() || classificacao == null) return;
  try {
    if (siglaDfe == null) {
      throw new ErroNomenclatura("TECNICA", "Sigla TIPO_DFE ausente para o documento habilitado na data");
    }
    validarNomenclatura(d, siglaPorNormalizada(siglaDfe), classificacao.id, classificacao.codigo, ncm, nbs, data, "CBS e IBS");
  } catch (ex) {
    registrar(ex, ncm, nbs, collector);
  }
}
