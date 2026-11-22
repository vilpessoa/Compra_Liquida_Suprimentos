import type { Proveniencia } from "@/lib/ports/common";
import type {
  ClassificacaoTributaria,
  ClassificacoesVinculadas,
  Municipio,
  NcmNbs,
  ReferenceDataPort,
  Uf,
} from "@/lib/ports/reference-data";

/**
 * STUB documentado: adapter que consultaria o serviço oficial (`REFERENCE_DATA=rfb-http`,
 * `RTC_API_URL=<host>/api`) pelos endpoints `/dados-abertos/*` do `DadosAbertosController` oficial:
 *
 *   GET /dados-abertos/ufs                                         -> UF
 *   GET /dados-abertos/ufs/municipios?siglaUf=                     -> municípios por UF
 *   GET /dados-abertos/ncm?data=...  /  /ncm/vigentes             -> NCM
 *   GET /dados-abertos/nbs?data=...  /  /nbs/lista                 -> NBS
 *   GET /dados-abertos/classificacoes-tributarias/cbs-ibs?data=    -> cClassTrib (flags de crédito, % de redução, DFe)
 *   GET /dados-abertos/classificacoes-tributarias/cbs-ibs/class-trib/{cClassTrib}
 *   GET /dados-abertos/classificacoes-tributarias/ncm-aplicavel | nbs-aplicavel   -> anexos de vínculo
 *   GET /dados-abertos/nomenclatura/{siglaDfe}/{cClassTrib}        -> regra de nomenclatura por DFe
 *   GET /dados-abertos/fundamentacoes-legais
 *
 * NÃO implementado: o vínculo NCM/NBS<->cClassTrib exige compor vários desses endpoints (anexos + exceções +
 * tipo de DFe + nomenclatura) e os parâmetros/paginação exatos só podem ser conferidos contra um serviço oficial em
 * execução — sem isso, qualquer composição seria uma suposição, o que o projeto proíbe. Enquanto isso, use
 * `REFERENCE_DATA=snapshot` (padrão), que lê as mesmas tabelas oficiais do snapshot versionado.
 */
export class ReferenceDataRfbHttpNaoImplementadoError extends Error {
  constructor() {
    super(
      "REFERENCE_DATA=rfb-http ainda não está implementado (stub). Use REFERENCE_DATA=snapshot. " +
        "Ver o cabeçalho de src/lib/adapters/reference-data/rfb-http-reference-data.ts.",
    );
    this.name = "ReferenceDataRfbHttpNaoImplementadoError";
  }
}

export class RfbHttpReferenceData implements ReferenceDataPort {
  readonly id = "rfb-http";
  constructor(readonly apiUrl: string) {}
  proveniencia(): Proveniencia {
    return { fonte: this.apiUrl, versao: "nao-implementado", adapter: this.id };
  }
  buscarNcmNbs(): Promise<NcmNbs[]> {
    return Promise.reject(new ReferenceDataRfbHttpNaoImplementadoError());
  }
  obterNcmNbs(): Promise<NcmNbs | null> {
    return Promise.reject(new ReferenceDataRfbHttpNaoImplementadoError());
  }
  classificacoesPorNcmNbs(): Promise<ClassificacoesVinculadas> {
    return Promise.reject(new ReferenceDataRfbHttpNaoImplementadoError());
  }
  obterClassificacao(): Promise<ClassificacaoTributaria | null> {
    return Promise.reject(new ReferenceDataRfbHttpNaoImplementadoError());
  }
  listarUfs(): Promise<Uf[]> {
    return Promise.reject(new ReferenceDataRfbHttpNaoImplementadoError());
  }
  listarMunicipios(): Promise<Municipio[]> {
    return Promise.reject(new ReferenceDataRfbHttpNaoImplementadoError());
  }
  obterMunicipio(): Promise<Municipio | null> {
    return Promise.reject(new ReferenceDataRfbHttpNaoImplementadoError());
  }
}
