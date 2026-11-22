import type { Indeterminado, Proveniencia } from "./common";

/**
 * ALTERAÇÃO (WP8a): o contrato original (busca simples + `classificacoesPorNcmNbs` devolvendo lista com
 * campos mínimos) foi ampliado para o que a camada de Suprimentos precisa e continua sem inventar nada:
 *  - `NcmNbs` ganhou `completo` (NCM com 8 e NBS com 9 dígitos: só códigos completos entram no vínculo oficial);
 *  - `ClassificacaoTributaria` ganhou tipo de alíquota, percentuais de redução vigentes por tributo, flags
 *    oficiais de crédito (apropriação CBS/IBS pelo adquirente, crédito presumido do adquirente, crédito da
 *    operação antecedente), fundamentação legal oficial (texto da tabela) e indicadores de tratamento;
 *  - `classificacoesPorNcmNbs` devolve `Resultado` (OK com a lista, ou INDETERMINADO com motivo: NCM/NBS
 *    inexistente na data, formato inválido, nenhuma classificação vinculada) em vez de lista vazia ambígua;
 *  - novos métodos de localidade: `listarUfs`, `listarMunicipios(uf)` e `obterMunicipio(ibge)` (tabelas UF/MUNICIPIO
 *    oficiais), e `obterClassificacao(cClassTrib, data)`.
 */

export interface NcmNbs {
  codigo: string;
  descricao: string;
  tipo: "NCM" | "NBS";
  /** NCM com 8 dígitos / NBS com 9 dígitos. Códigos de capítulo/posição/subposição não são selecionáveis. */
  completo: boolean;
  inicioVigencia?: string;
  fimVigencia?: string | null;
}

/** Flags oficiais da tabela CLASSIFICACAO_TRIBUTARIA. Nulo na base é tratado como falso (convenção do `DadosAbertosService`). */
export interface FlagsCreditoClassificacao {
  /** CLTR_IN_APROPRIACAO_CREDITOS_ADQUIRENTES_CBS */
  apropriacaoCreditoAdquirenteCbs: boolean;
  /** CLTR_IN_APROPRIACAO_CREDITOS_ADQUIRENTES_IBS */
  apropriacaoCreditoAdquirenteIbs: boolean;
  /** CLTR_IN_CREDITO_PRESUMIDO_ADQUIRENTE */
  creditoPresumidoAdquirente: boolean;
  /** CLTR_IN_CREDITO_PRESUMIDO_FORNECEDOR */
  creditoPresumidoFornecedor: boolean;
  /** CLTR_CREDITO_OPERACAO_ANTECEDENTE ("Manutenção" | "Anulação" | null). */
  creditoOperacaoAntecedente: string | null;
}

export interface FundamentacaoLegalOficial {
  /** FDLG_TEXTO_CURTO, ex.: "LC 214/2025, art. 11, VIII". */
  textoCurto: string | null;
  /** FDLG_TEXTO (texto da tabela). */
  texto: string | null;
  /** FDLG_REFERENCIA_NORMATIVA. */
  referenciaNormativa: string | null;
}

export interface ClassificacaoTributaria {
  cClassTrib: string;
  cst: string;
  descricao: string;
  /** CLTR_TIPO_ALIQUOTA (ex.: "Padrão", "Fixa", "Uniforme nacional"). */
  tipoAliquota: string | null;
  /** CLTR_NOMENCLATURA (ex.: "NCM", "NBS", "NBS ou NCM"). */
  nomenclatura: string | null;
  /** Percentuais de redução vigentes na data (PERCENTUAL_REDUCAO) por tributo; `null` = sem registro vigente. */
  percentuaisReducao: { cbs: string | null; ibsUf: string | null; ibsMun: string | null };
  flagsCredito: FlagsCreditoClassificacao;
  fundamentacaoLegal: FundamentacaoLegalOficial[];
  /** Tratamento exige o grupo de tributação regular (gTribRegular: CST/cClassTrib do tributo que seria devido). */
  exigeGrupoTributacaoRegular: boolean;
  /**
   * `false` quando o tratamento tem ajuste/monofasia ainda não implementado pelo motor oficial (CAL-007 /
   * VSN-027, estado NAO_IMPLEMENTADO): o item sai sem cálculo.
   */
  calculoImplementado: boolean;
  inicioVigencia?: string;
  fimVigencia?: string | null;
}

export interface Uf { codigo: number; sigla: string; nome: string }
export interface Municipio { codigoIbge: number; nome: string; uf: string }

export type ClassificacoesVinculadas = ClassificacoesVinculadasOk | Indeterminado;
export interface ClassificacoesVinculadasOk {
  status: "OK";
  codigo: string;
  tipo: "NCM" | "NBS";
  /** tpDoc usado na regra oficial de vínculo: 55 (NF-e) para NCM, 91 (NFS-e) para NBS. */
  tpDoc: number;
  data: string;
  classificacoes: ClassificacaoTributaria[];
  proveniencia: Proveniencia;
}

/** Consulta às tabelas oficiais (NCM, NBS, cClassTrib, fundamentações, UF e municípios). */
export interface ReferenceDataPort {
  readonly id: string;
  proveniencia(): Proveniencia;
  buscarNcmNbs(termo: string, data: string, limite?: number, tipo?: "NCM" | "NBS"): Promise<NcmNbs[]>;
  obterNcmNbs(codigo: string, data: string): Promise<NcmNbs | null>;
  /**
   * cClassTrib vinculadas ao NCM (8 dígitos) / NBS (9 dígitos) na data, pela MESMA regra do motor oficial
   * (ProcessamentoItemService: vínculo com o tipo de DFe + nomenclatura aplicável + anexos NCM/NBS e exceções).
   * INDETERMINADO = bloqueio na UI.
   */
  classificacoesPorNcmNbs(codigo: string, data: string): Promise<ClassificacoesVinculadas>;
  obterClassificacao(cClassTrib: string, data: string): Promise<ClassificacaoTributaria | null>;
  listarUfs(): Promise<Uf[]>;
  listarMunicipios(uf: string): Promise<Municipio[]>;
  obterMunicipio(codigoIbge: number): Promise<Municipio | null>;
}
