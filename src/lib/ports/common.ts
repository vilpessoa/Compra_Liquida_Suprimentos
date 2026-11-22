/**
 * Tipos comuns a todos os ports.
 * Regra do projeto: nenhum valor tributário é inventado. Quando um dado não pode ser
 * determinado a partir das fontes oficiais da RFB, o port retorna um resultado do tipo
 * `Indeterminado` com o motivo, e a UI bloqueia a decisão correspondente.
 */
export type Proveniencia = {
  /** Identificação da fonte oficial, ex.: "ReceitaFederal/calculadora-rtc-regime-regular". */
  fonte: string;
  /** Commit SHA do repositório oficial usado no snapshot ou versão retornada pela API oficial. */
  versao: string;
  /** Adapter que produziu o resultado (ex.: "local-rtc", "rfb-http"). */
  adapter: string;
};

export type Indeterminado = {
  status: "INDETERMINADO";
  /** Código estável, ex.: "NCM_NAO_ENCONTRADO", "COMBINACAO_NAO_VALIDADA", "MONOFASIA_NAO_LIBERADA". */
  codigo: string;
  mensagem: string;
  /** Ação recomendada ao comprador (ex.: "Solicitar ao fornecedor o anexo do Simples Nacional"). */
  acao?: string;
};

export type Resultado<T> = ({ status: "OK" } & T & { proveniencia: Proveniencia }) | Indeterminado;
