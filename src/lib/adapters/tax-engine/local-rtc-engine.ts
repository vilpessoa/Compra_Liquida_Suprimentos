import type { TaxEngineCallOptions, TaxEnginePort } from "@/lib/ports/tax-engine";
import type { OperacaoInput, RtcHttpResponse } from "@/lib/ports/rtc-dto";
import { calcularRegimeGeral, getRtcRepos, MotorLocalNaoValidadoError, processarObservabilidade } from "@/lib/engines/rtc";
import { COMBINACOES_NAO_VALIDADAS } from "@/lib/engines/rtc/unsupported";

/**
 * Adapter do motor local: port TypeScript fiel do motor oficial (src/lib/engines/rtc), validado contra o corpus
 * golden master (conformance/regime-regular.test.ts). Usa os dados oficiais em src/data/rtc (carga lazy, cache
 * em módulo). Roda no runtime Node (API Route): não use em Edge nem no cliente.
 *
 * Combinações listadas em `unsupported.ts` (e ramos que o port se recusa a calcular) lançam
 * `MotorLocalNaoValidadoError` em vez de devolver um número possivelmente divergente.
 */
export class LocalRtcEngine implements TaxEnginePort {
  readonly id = "local-rtc";

  async calcularObservabilidade(operacao: OperacaoInput, opts?: TaxEngineCallOptions): Promise<RtcHttpResponse> {
    verificarCombinacoesNaoValidadas(operacao);
    return processarObservabilidade(await getRtcRepos(), operacao, { baseUrl: opts?.baseUrl });
  }

  async calcularRegimeGeral(operacao: OperacaoInput, opts?: TaxEngineCallOptions): Promise<RtcHttpResponse> {
    verificarCombinacoesNaoValidadas(operacao);
    return calcularRegimeGeral(await getRtcRepos(), operacao, { baseUrl: opts?.baseUrl });
  }
}

/** Recusa antecipada das combinações (cst, cClassTrib, condição) catalogadas como não validadas. */
function verificarCombinacoesNaoValidadas(operacao: OperacaoInput): void {
  if (COMBINACOES_NAO_VALIDADAS.length === 0) return;
  for (const item of operacao.itens ?? []) {
    for (const c of COMBINACOES_NAO_VALIDADAS) {
      if (c.cst !== undefined && c.cst !== item.cst) continue;
      if (c.cClassTrib !== undefined && c.cClassTrib !== item.cClassTrib) continue;
      if (c.aplica && !c.aplica(item as unknown as Record<string, unknown>, operacao as unknown as Record<string, unknown>)) continue;
      throw new MotorLocalNaoValidadoError({ cst: item.cst, cClassTrib: item.cClassTrib, condicao: c.condicao });
    }
  }
}
