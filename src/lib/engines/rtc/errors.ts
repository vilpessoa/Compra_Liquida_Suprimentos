/**
 * Catálogo de exceções do motor oficial e sua tradução para respostas.
 *
 * Fontes (.rfb/calculadora-rtc-regime-regular/src/main/java/br/gov/serpro/rtc):
 *  - domain/service/exception/*.java                       (classes e mensagens)
 *  - api/exceptionhandler/enumeration/ProblemType.java      (REG-*, CAL-*: código, campo, estado — observabilidade)
 *  - api/exceptionhandler/ProblemType.java                  (título/URI dos erros HTTP de /regime-geral)
 *  - api/exceptionhandler/ApiExceptionHandler.java          (422 ValidacaoException, 400 CampoInvalido, 404 EntidadeNaoEncontrada, 500)
 *  - api/exceptionhandler/enumeration/CodigoValidacao.java  (VAL-*)
 *  - domain/service/collector/ItemCollector.java            (montagem de ErroDetalhe por item)
 */
import type { EstadoItem } from "./official-types";

/** Nome (sem sufixo) da classe Java de cada exceção; o nome identifica o mapeamento em ProblemType.from(). */
export type ExceptionKind =
  | "AliquotaAdRemNaoEncontrada"
  | "AliquotaImpostoSeletivoNaoInformada"
  | "AliquotaNaoEncontrada"
  | "AliquotaNegativa"
  | "AliquotaPadraoNaoEncontrada"
  | "AliquotaReferenciaNaoEncontrada"
  | "AliquotasNominaisInformadasIndevidamente"
  | "AliquotasNominaisNaoInformadas"
  | "BaseCalculoComponentesInconsistente"
  | "BaseCalculoInconsistente"
  | "BaseCalculoMenorBaseCalculoImpostoSeletivo"
  | "BaseCalculoNaoInformada"
  | "ClassificacaoTributariaNaoEncontrada"
  | "ClassificacaoTributariaNaoVinculadaSituacaoTributaria"
  | "ClassificacaoTributariaNaoVinculadaTipoDfe"
  | "DataFatoGeradorNaoInformada"
  | "ErroAvaliadorExpressaoAritmetica"
  | "ErroFaltaImplementacao"
  | "ErroGenericoValidacao"
  | "FormaAplicacaoNaoDefinida"
  | "FormaAplicacaoNaoTratada"
  | "FundamentacaoClassificacaoNaoEncontrada"
  | "ImpostoSeletivoInformadoIndevidamente"
  | "ImpostoSeletivoNaoAdmitidoTipoDfe"
  | "ImpostoSeletivoNaoInformado"
  | "IncompatibilidadeSuspensao"
  | "MunicipioNaoEncontrado"
  | "MunicipioNaoPertencente"
  | "NbsCompletoNaoInformado"
  | "NbsNaoEncontrada"
  | "NbsNaoVinculada"
  | "NcmCompletoNaoInformado"
  | "NcmNaoEncontrada"
  | "NcmNaoVinculada"
  | "NcmNbsSimultaneas"
  | "NomenclaturaIncompativelTipoDfe"
  | "NomenclaturaNaoPermitidaTipoDfe"
  | "NomenclaturaObrigatoriaNaoInformada"
  | "PercentualReducaoNaoEncontrado"
  | "SiglaDFeNaoEncontrada"
  | "SituacaoTributariaNaoEncontrada"
  | "TipoAliquotaDesconhecido"
  | "TipoDfeNaoEncontrado"
  | "TipoDfeNaoTratado"
  | "TratamentoClassificacaoNaoEncontrado"
  | "TratamentoTributarioNaoEncontrado"
  | "TributacaoRegularInformadaIndevidamente"
  | "TributacaoRegularNaoInformada"
  | "UfNaoEncontrada"
  /** java.lang.RuntimeException / NullPointerException / ArithmeticException etc.: ProblemType.ERRO_SISTEMA. */
  | "ErroSistema";

/** Hierarquia Java -> status HTTP do ApiExceptionHandler. */
type Categoria = "validacao" | "campoInvalido" | "naoEncontrada" | "interno";

interface ObsEntry {
  codigo: string;
  campoDefault: string | null;
  estado: EstadoItem;
  titulo: string;
}
interface HttpEntry {
  titulo: string;
  path: string;
}
interface KindInfo {
  categoria: Categoria;
  /** ProblemType (observabilidade) -> ErroDetalhe. Ausente => ERRO_SISTEMA / CAL-999. */
  obs?: ObsEntry;
  /** ProblemType (HTTP). Ausente => ERRO_SISTEMA. */
  http?: HttpEntry;
}

const INC: EstadoItem = "INCONSISTENCIA_ENTRADA";
const FT: EstadoItem = "FALHA_TECNICA";

export const KINDS: Record<ExceptionKind, KindInfo> = {
  AliquotaAdRemNaoEncontrada: {
    categoria: "naoEncontrada",
    obs: { codigo: "CAL-004", campoDefault: null, estado: FT, titulo: "Alíquota ad rem não encontrada" },
    http: { titulo: "Alíquota ad rem não encontrada", path: "aliquota-ad-rem-nao-encontrada" },
  },
  AliquotaImpostoSeletivoNaoInformada: {
    categoria: "validacao",
    obs: {
      codigo: "REG-035",
      campoDefault: "aliquotasNominais/impostoSeletivo",
      estado: INC,
      titulo: "Alíquota do Imposto Seletivo não informada",
    },
    http: { titulo: "Alíquota do Imposto Seletivo não informada", path: "aliquota-imposto-seletivo-nao-informada" },
  },
  AliquotaNaoEncontrada: {
    categoria: "naoEncontrada",
    obs: { codigo: "CAL-001", campoDefault: null, estado: FT, titulo: "Alíquota não encontrada" },
  },
  AliquotaNegativa: {
    categoria: "validacao",
    obs: { codigo: "CAL-005", campoDefault: null, estado: FT, titulo: "Alíquota negativa" },
  },
  AliquotaPadraoNaoEncontrada: {
    categoria: "naoEncontrada",
    obs: { codigo: "CAL-002", campoDefault: null, estado: FT, titulo: "Alíquota padrão não encontrada" },
  },
  AliquotaReferenciaNaoEncontrada: {
    categoria: "naoEncontrada",
    obs: { codigo: "CAL-003", campoDefault: null, estado: FT, titulo: "Alíquota de referência não encontrada" },
    http: { titulo: "Alíquota de referência não encontrada", path: "aliquota-referencia-nao-encontrada" },
  },
  AliquotasNominaisInformadasIndevidamente: {
    categoria: "validacao",
    obs: {
      codigo: "REG-036",
      campoDefault: "aliquotasNominais",
      estado: INC,
      titulo: "Alíquotas nominais informadas indevidamente",
    },
    http: { titulo: "Alíquotas nominais informadas indevidamente", path: "aliquotas-nominais-informadas-indevidamente" },
  },
  AliquotasNominaisNaoInformadas: {
    categoria: "validacao",
    obs: {
      codigo: "REG-037",
      campoDefault: "aliquotasNominais",
      estado: INC,
      titulo: "Alíquotas nominais não informadas",
    },
    http: { titulo: "Alíquotas nominais não informadas", path: "aliquotas-nominais-nao-informadas" },
  },
  BaseCalculoComponentesInconsistente: {
    categoria: "validacao",
    obs: { codigo: "REG-034", campoDefault: "baseCalculo", estado: INC, titulo: "Base de cálculo inconsistente" },
  },
  BaseCalculoInconsistente: {
    categoria: "validacao",
    obs: { codigo: "REG-026", campoDefault: "baseCalculo", estado: INC, titulo: "Base de cálculo inconsistente" },
    http: { titulo: "Base de cálculo inconsistente", path: "base-calculo-inconsistente" },
  },
  BaseCalculoMenorBaseCalculoImpostoSeletivo: {
    categoria: "validacao",
    obs: {
      codigo: "REG-027",
      campoDefault: "baseCalculo",
      estado: INC,
      titulo: "Base de cálculo menor que a base de cálculo do Imposto Seletivo",
    },
    http: {
      titulo: "Base de cálculo menor que a base de cálculo do Imposto Seletivo",
      path: "base-calculo-menor-base-calculo-imposto-seletivo",
    },
  },
  BaseCalculoNaoInformada: {
    categoria: "validacao",
    obs: { codigo: "REG-025", campoDefault: "baseCalculo", estado: INC, titulo: "Base de cálculo não informada" },
    http: { titulo: "Base de cálculo não informada", path: "base-calculo-nao-informada" },
  },
  ClassificacaoTributariaNaoEncontrada: {
    categoria: "naoEncontrada",
    obs: {
      codigo: "REG-005",
      campoDefault: "cClassTrib",
      estado: INC,
      titulo: "Classificação tributária não encontrada",
    },
    http: { titulo: "Classificação tributária não encontrada", path: "classificacao-tributaria-nao-encontrada" },
  },
  ClassificacaoTributariaNaoVinculadaSituacaoTributaria: {
    categoria: "validacao",
    obs: {
      codigo: "REG-006",
      campoDefault: "cClassTrib",
      estado: INC,
      titulo: "Classificação tributária não vinculada à situação tributária",
    },
    http: {
      titulo: "Classificação tributária não vinculada à situação tributária",
      path: "classificacao-tributaria-nao-vinculada-situacao-tributaria",
    },
  },
  ClassificacaoTributariaNaoVinculadaTipoDfe: {
    categoria: "validacao",
    obs: {
      codigo: "REG-029",
      campoDefault: "cClassTrib",
      estado: INC,
      titulo: "Classificação tributária não vinculada ao tipo de documento",
    },
  },
  DataFatoGeradorNaoInformada: {
    categoria: "campoInvalido",
    obs: { codigo: "REG-021", campoDefault: null, estado: INC, titulo: "Data do fato gerador não informada" },
    http: { titulo: "Data do fato gerador não informada", path: "fato-gerador-nao-informada" },
  },
  ErroAvaliadorExpressaoAritmetica: {
    categoria: "validacao",
    obs: { codigo: "CAL-008", campoDefault: null, estado: FT, titulo: "Erro no avaliador de expressão aritmética" },
  },
  ErroFaltaImplementacao: {
    categoria: "validacao",
    obs: {
      codigo: "CAL-007",
      campoDefault: "cClassTrib",
      estado: "NAO_IMPLEMENTADO",
      titulo: "Classificação tributária em desenvolvimento",
    },
    http: { titulo: "Classificação tributária em desenvolvimento", path: "erro-falta-implementacao" },
  },
  ErroGenericoValidacao: {
    categoria: "validacao",
    obs: { codigo: "REG-023", campoDefault: null, estado: INC, titulo: "Erro genérico de validação" },
  },
  FormaAplicacaoNaoDefinida: {
    categoria: "interno",
    http: { titulo: "Forma de Aplicação de Percentual não definida", path: "forma-aplicacao-percentual-nao-definida" },
  },
  FormaAplicacaoNaoTratada: { categoria: "interno" },
  FundamentacaoClassificacaoNaoEncontrada: {
    categoria: "naoEncontrada",
    obs: { codigo: "CAL-011", campoDefault: null, estado: FT, titulo: "Fundamentação não encontrada" },
  },
  ImpostoSeletivoInformadoIndevidamente: {
    categoria: "validacao",
    obs: {
      codigo: "REG-014",
      campoDefault: "impostoSeletivo",
      estado: INC,
      titulo: "Dados do Imposto Seletivo informados indevidamente",
    },
    http: {
      titulo: "Dados do Imposto Seletivo informados indevidamente",
      path: "dados-imposto-seletivo-informados-indevidamente",
    },
  },
  ImpostoSeletivoNaoAdmitidoTipoDfe: {
    categoria: "validacao",
    obs: {
      codigo: "REG-032",
      campoDefault: "impostoSeletivo",
      estado: INC,
      titulo: "Imposto Seletivo não admitido pelo tipo de documento",
    },
  },
  ImpostoSeletivoNaoInformado: {
    categoria: "validacao",
    obs: {
      codigo: "REG-013",
      campoDefault: "impostoSeletivo",
      estado: INC,
      titulo: "Dados do Imposto Seletivo não informados",
    },
    http: { titulo: "Dados do Imposto Seletivo não informados", path: "dados-imposto-seletivo-nao-informados" },
  },
  IncompatibilidadeSuspensao: {
    categoria: "validacao",
    obs: {
      codigo: "REG-010",
      campoDefault: "tributacaoRegular/cClassTrib",
      estado: INC,
      titulo: "Incompatibilidade com suspensão",
    },
    http: { titulo: "Incompatibilidade com suspensão", path: "incompatibilidade-suspensao" },
  },
  MunicipioNaoEncontrado: {
    categoria: "naoEncontrada",
    obs: { codigo: "REG-019", campoDefault: null, estado: INC, titulo: "Município não encontrado" },
    http: { titulo: "Município não encontrado", path: "municipio-nao-encontrado" },
  },
  MunicipioNaoPertencente: {
    categoria: "validacao",
    obs: { codigo: "REG-018", campoDefault: null, estado: INC, titulo: "Município não pertencente à UF" },
    http: { titulo: "Município não pertencente à UF", path: "municipio-nao-pertencente-uf" },
  },
  NbsCompletoNaoInformado: {
    categoria: "validacao",
    obs: { codigo: "REG-016", campoDefault: "nbs", estado: INC, titulo: "NBS completo não informado" },
    http: { titulo: "NBS completo não informado", path: "nbs-completo-nao-informado" },
  },
  NbsNaoEncontrada: {
    categoria: "naoEncontrada",
    obs: { codigo: "REG-003", campoDefault: "nbs", estado: INC, titulo: "NBS não encontrada" },
    http: { titulo: "NBS não encontrada", path: "nbs-nao-encontrada" },
  },
  NbsNaoVinculada: {
    categoria: "validacao",
    obs: { codigo: "REG-012", campoDefault: "nbs", estado: INC, titulo: "NBS não vinculada" },
    http: { titulo: "NBS não vinculada", path: "nbs-nao-vinculada" },
  },
  NcmCompletoNaoInformado: {
    categoria: "validacao",
    obs: { codigo: "REG-015", campoDefault: "ncm", estado: INC, titulo: "NCM completo não informado" },
    http: { titulo: "NCM completo não informado", path: "ncm-completo-nao-informado" },
  },
  NcmNaoEncontrada: {
    categoria: "naoEncontrada",
    obs: { codigo: "REG-002", campoDefault: "ncm", estado: INC, titulo: "NCM não encontrada" },
    http: { titulo: "NCM não encontrada", path: "ncm-nao-encontrada" },
  },
  NcmNaoVinculada: {
    categoria: "validacao",
    obs: { codigo: "REG-011", campoDefault: "ncm", estado: INC, titulo: "NCM não vinculada" },
    http: { titulo: "NCM não vinculada", path: "ncm-nao-vinculada" },
  },
  NcmNbsSimultaneas: {
    categoria: "validacao",
    obs: { codigo: "REG-001", campoDefault: null, estado: INC, titulo: "NCM e NBS informadas simultaneamente" },
    http: { titulo: "NCM e NBS informadas simultaneamente", path: "ncm-nbs-simultaneas" },
  },
  NomenclaturaIncompativelTipoDfe: {
    categoria: "validacao",
    obs: { codigo: "REG-030", campoDefault: null, estado: INC, titulo: "Nomenclatura incompatível com o tipo de documento" },
  },
  NomenclaturaNaoPermitidaTipoDfe: {
    categoria: "validacao",
    obs: { codigo: "REG-031", campoDefault: null, estado: INC, titulo: "Nomenclatura não permitida para o tipo de documento" },
  },
  NomenclaturaObrigatoriaNaoInformada: {
    categoria: "validacao",
    obs: { codigo: "REG-033", campoDefault: null, estado: INC, titulo: "Nomenclatura obrigatória não informada" },
  },
  PercentualReducaoNaoEncontrado: {
    categoria: "naoEncontrada",
    obs: { codigo: "CAL-010", campoDefault: null, estado: FT, titulo: "Percentual de redução não encontrado" },
  },
  SiglaDFeNaoEncontrada: {
    categoria: "validacao",
    http: { titulo: "Sigla DFe não reconhecida", path: "sigla-dfe-nao-reconhecida" },
  },
  SituacaoTributariaNaoEncontrada: {
    categoria: "naoEncontrada",
    obs: { codigo: "REG-004", campoDefault: "cst", estado: INC, titulo: "Situação tributária não encontrada" },
    http: { titulo: "Situação tributária não encontrada", path: "situacao-tributaria-nao-encontrada" },
  },
  TipoAliquotaDesconhecido: {
    categoria: "validacao",
    obs: { codigo: "CAL-006", campoDefault: null, estado: FT, titulo: "Tipo de alíquota desconhecido" },
  },
  TipoDfeNaoEncontrado: {
    categoria: "validacao",
    obs: { codigo: "REG-028", campoDefault: "tpDoc", estado: INC, titulo: "Tipo de documento fiscal não encontrado" },
  },
  TipoDfeNaoTratado: {
    categoria: "validacao",
    obs: { codigo: "REG-038", campoDefault: "tpDoc", estado: INC, titulo: "Tipo de documento fiscal não tratado" },
  },
  TratamentoClassificacaoNaoEncontrado: {
    categoria: "naoEncontrada",
    obs: { codigo: "REG-008", campoDefault: "cClassTrib", estado: INC, titulo: "Tratamento de classificação não encontrado" },
  },
  TratamentoTributarioNaoEncontrado: {
    categoria: "naoEncontrada",
    obs: { codigo: "CAL-009", campoDefault: null, estado: FT, titulo: "Tratamento tributário não encontrado" },
  },
  TributacaoRegularInformadaIndevidamente: {
    categoria: "validacao",
    obs: {
      codigo: "REG-022",
      campoDefault: "tributacaoRegular",
      estado: INC,
      titulo: "Grupo de tributação regular informado indevidamente",
    },
    http: {
      titulo: "Grupo de tributação regular informado indevidamente",
      path: "grupo-tributacao-regular-informado-indevidamente",
    },
  },
  TributacaoRegularNaoInformada: {
    categoria: "validacao",
    obs: {
      codigo: "REG-009",
      campoDefault: "tributacaoRegular",
      estado: INC,
      titulo: "Grupo de tributação regular não informado",
    },
    http: { titulo: "Grupo de tributação regular não informado", path: "grupo-tributacao-regular-nao-informado" },
  },
  UfNaoEncontrada: {
    categoria: "naoEncontrada",
    obs: { codigo: "REG-020", campoDefault: null, estado: INC, titulo: "UF não encontrada" },
    http: { titulo: "UF não encontrada", path: "uf-nao-encontrada" },
  },
  ErroSistema: { categoria: "interno" },
};

export const ERRO_SISTEMA_TITULO = "Erro de sistema não previsto";
export const ERRO_SISTEMA_PATH = "erro-de-sistema-nao-previsto";

/** Exceção do motor, equivalente à hierarquia de exceções Java (a classe vira `kind`). */
export class RtcException extends Error {
  constructor(
    readonly kind: ExceptionKind,
    message: string,
  ) {
    super(message);
    this.name = `${kind}Exception`;
  }
}

export function httpStatusOf(kind: ExceptionKind): number {
  switch (KINDS[kind].categoria) {
    case "validacao":
      return 422;
    case "campoInvalido":
      return 400;
    case "naoEncontrada":
      return 404;
    default:
      return 500;
  }
}

/** Lançada pelo LocalRtcEngine quando a entrada cai numa combinação não validada contra o corpus oficial. */
export class MotorLocalNaoValidadoError extends Error {
  constructor(
    readonly combinacao: { cst?: string; cClassTrib?: string; condicao: string },
    message?: string,
  ) {
    super(
      message ??
        `Motor local não validado para esta combinação (cst=${combinacao.cst ?? "*"}, cClassTrib=${combinacao.cClassTrib ?? "*"}, condição=${combinacao.condicao}). Encaminhe ao motor oficial (RFB HTTP).`,
    );
    this.name = "MotorLocalNaoValidadoError";
  }
}

// ───────────────────────────── Mensagens (fábricas) ─────────────────────────────
// Texto idêntico ao das classes Java (String.format com %s/%d).

export const ex = {
  aliquotaImpostoSeletivoNaoInformada: (tipo: string, codigo: string, data: string) =>
    new RtcException(
      "AliquotaImpostoSeletivoNaoInformada",
      `A alíquota do Imposto Seletivo deve ser informada em aliquotasNominais.impostoSeletivo para ${tipo} ${codigo} e data ${data}, pois ainda não foi definida em lei`,
    ),
  aliquotaNaoEncontrada: (idTributo: number, uf: number | null, mun: number | null, data: string) =>
    new RtcException(
      "AliquotaNaoEncontrada",
      `Alíquota de referencia ou padrão não encontrada para o tributo com id ${idTributo}, UF ${uf}, município ${mun} e data ${data}`,
    ),
  aliquotaReferenciaNaoEncontrada: (idTributo: number, data: string) =>
    new RtcException(
      "AliquotaReferenciaNaoEncontrada",
      `Alíquota de referência não encontrada para o tributo com id ${idTributo} e data ${data}`,
    ),
  aliquotaReferenciaNaoEncontradaSemArgs: () =>
    new RtcException("AliquotaReferenciaNaoEncontrada", "Alíquota de referência não encontrada"),
  aliquotasNominaisInformadasIndevidamente: () =>
    new RtcException(
      "AliquotasNominaisInformadasIndevidamente",
      "As alíquotas nominais não podem ser informadas para operações com fato gerador anterior a 01/01/2027, pois a calculadora resolve as alíquotas vigentes",
    ),
  aliquotasNominaisNaoInformadas: () =>
    new RtcException(
      "AliquotasNominaisNaoInformadas",
      "As alíquotas nominais (os três campos cbs, ibsEstadual e ibsMunicipal) devem ser informadas para operações com fato gerador a partir de 01/01/2027",
    ),
  baseCalculoNaoInformada: () =>
    new RtcException(
      "BaseCalculoNaoInformada",
      "A base de cálculo de CBS e IBS deve ser informada quando o grupo do Imposto Seletivo não é informado",
    ),
  baseCalculoInconsistente: (bc: string, bcIs: string, isInf: string) =>
    new RtcException(
      "BaseCalculoInconsistente",
      `A base de cálculo de CBS e IBS informada ${bc} difere da soma da base de cálculo do Imposto Seletivo ${bcIs} com o Imposto Seletivo informado ${isInf}`,
    ),
  baseCalculoMenor: (bc: string, bcIs: string) =>
    new RtcException(
      "BaseCalculoMenorBaseCalculoImpostoSeletivo",
      `A base de cálculo de CBS e IBS informada ${bc} é menor que a base de cálculo do Imposto Seletivo ${bcIs}`,
    ),
  classificacaoNaoEncontrada: (codigo: string, tributo: string, data: string) =>
    new RtcException(
      "ClassificacaoTributariaNaoEncontrada",
      `Classificação tributária não encontrada para código ${codigo} e data ${data} (${tributo})`,
    ),
  classificacaoNaoEncontradaId: (id: number) =>
    new RtcException("ClassificacaoTributariaNaoEncontrada", `Classificação tributária não encontrada para id ${id}`),
  classificacaoNaoVinculadaCst: (cClassTrib: string, cst: string, tributo: string) =>
    new RtcException(
      "ClassificacaoTributariaNaoVinculadaSituacaoTributaria",
      `Classificação tributária (cClassTrib) de código ${cClassTrib} não está vinculada à situação tributária (CST) de código ${cst} (${tributo})`,
    ),
  classificacaoNaoVinculadaTipoDfe: (cClassTrib: string, tpDoc: number, tributos: string) =>
    new RtcException(
      "ClassificacaoTributariaNaoVinculadaTipoDfe",
      `Classificação Tributária de código ${cClassTrib} não vinculada ao tipo de documento fiscal (tpDoc) ${tpDoc} (${tributos})`,
    ),
  dataFatoGeradorNaoInformada: () =>
    new RtcException("DataFatoGeradorNaoInformada", "A data do fato gerador não foi informada."),
  erroFaltaImplementacao: (cClassTrib: string) =>
    new RtcException(
      "ErroFaltaImplementacao",
      `A classificação tributária ${cClassTrib} ainda não possui tratamento tributário implementado na Calculadora. Essa funcionalidade está prevista no roadmap e será disponibilizada em versão futura.`,
    ),
  erroGenerico: (msg: string) => new RtcException("ErroGenericoValidacao", msg),
  fundamentacaoNaoEncontrada: (id: number, data: string) =>
    new RtcException(
      "FundamentacaoClassificacaoNaoEncontrada",
      `Fundamentação legal não encontrada para classificação tributária de id ${id} e data ${data}`,
    ),
  impostoSeletivoNaoAdmitidoTipoDfe: (tpDoc: number, nomenclatura: string, codigo: string) =>
    new RtcException(
      "ImpostoSeletivoNaoAdmitidoTipoDfe",
      `O tipo de documento fiscal (tpDoc) ${tpDoc} não admite Imposto Seletivo, exigido para ${nomenclatura} de código ${codigo}`,
    ),
  impostoSeletivoNaoInformado: (tipo: string, codigo: string, data: string) =>
    new RtcException(
      "ImpostoSeletivoNaoInformado",
      `Dados do Imposto Seletivo devem ser informados para ${tipo} ${codigo} e data ${data}`,
    ),
  incompatibilidadeSuspensao: (cClassTrib: string, cst: string) =>
    new RtcException(
      "IncompatibilidadeSuspensao",
      `Classificação tributária (cClassTrib) ${cClassTrib} e situação tributária (CST) ${cst} incompatíveis com suspensão`,
    ),
  municipioNaoEncontrado: (id: number) =>
    new RtcException("MunicipioNaoEncontrado", `Município de código ${id} não encontrado`),
  municipioNaoPertencente: (id: number, uf: string) =>
    new RtcException("MunicipioNaoPertencente", `Município de código ${id} não pertence à UF de sigla ${uf}`),
  nbsCompletoNaoInformado: () => new RtcException("NbsCompletoNaoInformado", "NBS completo não informado"),
  nbsNaoEncontrada: (nbs: string, data: string) =>
    new RtcException("NbsNaoEncontrada", `NBS de código ${nbs} não encontrada para a data ${data}`),
  nbsNaoVinculada: (nbs: string, cClassTrib: string, tributo: string) =>
    new RtcException(
      "NbsNaoVinculada",
      `NBS de código ${nbs} não vinculada à Classificação Tributária de código ${cClassTrib} (${tributo})`,
    ),
  ncmCompletoNaoInformado: () => new RtcException("NcmCompletoNaoInformado", "NCM completo não informado"),
  ncmNaoEncontrada: (ncm: string, data: string) =>
    new RtcException("NcmNaoEncontrada", `NCM de código ${ncm} não encontrada para a data ${data}`),
  ncmNaoVinculada: (ncm: string, cClassTrib: string, tributo: string) =>
    new RtcException(
      "NcmNaoVinculada",
      `NCM de código ${ncm} não vinculada à Classificação Tributária de código ${cClassTrib} (${tributo})`,
    ),
  ncmNbsSimultaneas: () =>
    new RtcException("NcmNbsSimultaneas", "Não é permitido informar NCM e NBS simultaneamente para um item"),
  nomenclaturaIncompativel: (nomenclatura: string, cClassTrib: string, siglaDfe: string) =>
    new RtcException(
      "NomenclaturaIncompativelTipoDfe",
      `${nomenclatura} não permitida para a Classificação Tributária de código ${cClassTrib} no tipo de documento ${siglaDfe}`,
    ),
  nomenclaturaNaoPermitida: (cClassTrib: string, siglaDfe: string) =>
    new RtcException(
      "NomenclaturaNaoPermitidaTipoDfe",
      `NCM/NBS não permitido para a Classificação Tributária de código ${cClassTrib} no tipo de documento ${siglaDfe}`,
    ),
  nomenclaturaObrigatoria: (cClassTrib: string, siglaDfe: string) =>
    new RtcException(
      "NomenclaturaObrigatoriaNaoInformada",
      `A Classificação Tributária de código ${cClassTrib} exige NCM ou NBS completo para o tipo de documento ${siglaDfe}`,
    ),
  percentualReducaoNaoEncontrado: (id: number, data: string) =>
    new RtcException(
      "PercentualReducaoNaoEncontrado",
      `Percentual de redução não encontrado para classificação tributária com id ${id} e data ${data}`,
    ),
  siglaDfeNaoEncontrada: (sigla: string) => new RtcException("SiglaDFeNaoEncontrada", `Sigla DFe inválida: ${sigla}`),
  situacaoTributariaNaoEncontrada: (codigo: string, tributo: string, data: string) =>
    new RtcException(
      "SituacaoTributariaNaoEncontrada",
      `Situação tributária (CST) não encontrada para código ${codigo} e data ${data} (${tributo})`,
    ),
  tipoAliquotaDesconhecido: (tipo: string, cClassTrib: string | null, cst: string | null) =>
    new RtcException(
      "TipoAliquotaDesconhecido",
      `Tipo de alíquota (${tipo}) desconhecido para cClassTrib ${cClassTrib} e CST ${cst}`,
    ),
  tipoDfeNaoEncontrado: (tpDoc: number, data: string) =>
    new RtcException(
      "TipoDfeNaoEncontrado",
      `Tipo de documento fiscal (tpDoc) de código ${tpDoc} não encontrado ou fora de vigência na data ${data}`,
    ),
  tipoDfeNaoTratado: (tipo: number, sigla: string) =>
    new RtcException(
      "TipoDfeNaoTratado",
      `Tipo de documento fiscal (tpDoc) de código ${tipo} (${sigla}) não possui tratamento implementado na calculadora`,
    ),
  tratamentoClassificacaoNaoEncontrado: (id: number, data: string) =>
    new RtcException(
      "TratamentoClassificacaoNaoEncontrado",
      `Tratamento tributário não encontrado para classificação tributária com id ${id} e data ${data}`,
    ),
  tratamentoTributarioNaoEncontrado: (id: number) =>
    new RtcException("TratamentoTributarioNaoEncontrado", `Tratamento tributário com id ${id} não encontrado`),
  tributacaoRegularInformadaIndevidamente: (cClassTrib: string, cst: string) =>
    new RtcException(
      "TributacaoRegularInformadaIndevidamente",
      `Dados da tributação regular informados indevidamente para cClassTrib ${cClassTrib} e CST ${cst}`,
    ),
  tributacaoRegularNaoInformada: (cClassTrib: string, cst: string) =>
    new RtcException(
      "TributacaoRegularNaoInformada",
      `Dados da tributação regular devem ser informados para cClassTrib ${cClassTrib} e CST ${cst}`,
    ),
  ufNaoEncontrada: (sigla: string) => new RtcException("UfNaoEncontrada", `UF de sigla ${sigla} não encontrada`),
  aliquotaNegativa: (tipo?: string) =>
    new RtcException(
      "AliquotaNegativa",
      tipo === "referencia"
        ? "Alíquota de referência não pode ter valor negativo"
        : tipo === "padrao"
          ? "Alíquota padrão não pode ter valor negativo"
          : tipo === "aplicavel"
            ? "Alíquota aplicável resultante não pode ter valor negativo"
            : "Alíquota não pode ter valor negativo",
    ),
  sistema: (message: string) => new RtcException("ErroSistema", message),
};

// ─────────────────────────── Bean Validation (VAL-*) ───────────────────────────

/** CodigoValidacao.java: anotação -> {código, título}. */
export const CODIGO_VALIDACAO: Record<string, { code: string; titulo: string }> = {
  NotNull: { code: "VAL-001", titulo: "Campo obrigatório não informado" },
  NotBlank: { code: "VAL-002", titulo: "Campo obrigatório em branco" },
  NotEmpty: { code: "VAL-003", titulo: "Lista ou campo não pode estar vazio" },
  Size: { code: "VAL-004", titulo: "Tamanho fora do intervalo permitido" },
  Min: { code: "VAL-005", titulo: "Valor abaixo do mínimo permitido" },
  Max: { code: "VAL-006", titulo: "Valor acima do máximo permitido" },
  DecimalMin: { code: "VAL-007", titulo: "Valor decimal abaixo do mínimo permitido" },
  DecimalMax: { code: "VAL-008", titulo: "Valor decimal acima do máximo permitido" },
  Pattern: { code: "VAL-009", titulo: "Formato inválido" },
  Digits: { code: "VAL-010", titulo: "Quantidade de dígitos inválida" },
  Email: { code: "VAL-011", titulo: "E-mail inválido" },
  Positive: { code: "VAL-012", titulo: "Valor deve ser positivo" },
  PositiveOrZero: { code: "VAL-013", titulo: "Valor deve ser positivo ou zero" },
  AssertTrue: { code: "VAL-014", titulo: "Condição não atendida" },
  AssertFalse: { code: "VAL-015", titulo: "Condição atendida indevidamente" },
};
