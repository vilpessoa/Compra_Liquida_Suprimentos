/**
 * DTOs do motor RTC do regime regular.
 *
 * ALTERAÇÃO (WP3): este arquivo deixou de definir contratos próprios (simplificados) e passou a RE-EXPORTAR os
 * tipos EXATOS dos contratos JSON oficiais da API ReceitaFederal/calculadora-rtc-regime-regular, definidos em
 * `@/lib/engines/rtc/official-types` (entrada: OperacaoInput/ItemOperacaoInput/...; saída:
 * ObservabilidadeROCDomain/ROCDomain/ProblemDetailBody; resposta HTTP: RtcHttpResponse). Assim o port recebe a
 * entrada oficial e devolve a resposta oficial (corpo JSON idêntico + status HTTP + headers relevantes), e
 * trocar o motor local pelo oficial é só trocar o adapter. Os tipos antigos (`ItemCalculado`, `TributoCalculado`,
 * `ImpostoSeletivoCalculado`) eram simplificações não oficiais e foram removidos.
 *
 * `DecimalString` continua exportado (usado por outros ports): valores monetários e percentuais trafegam como
 * string decimal para não perder precisão.
 */
export type DecimalString = string;

export type {
  AliquotasNominaisImpostoSeletivo,
  AliquotasNominaisInput,
  CompraGovernamentalInput,
  ComponentesBaseCalculoInput,
  ErroDetalhe,
  EstadoItem,
  ImpostoSeletivoInput,
  ItemOperacaoInput,
  JsonDecimal,
  ObjetoDomain,
  ObservabilidadeItemDomain,
  ObservabilidadeROCDomain,
  OperacaoInput,
  ProblemDetailBody,
  ROCDomain,
  RtcHttpResponse,
  RtcResponseBody,
  RtcResponseHeaders,
  TpEnteGov,
  TpOperGov,
  TributacaoRegularInput,
} from "@/lib/engines/rtc/official-types";
