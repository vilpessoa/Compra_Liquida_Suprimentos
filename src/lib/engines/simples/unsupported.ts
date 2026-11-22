/**
 * Situações em que o motor LOCAL se recusa a responder (`MotorLocalNaoValidadoError`) em vez de arriscar um
 * resultado diferente do motor oficial. NENHUM caso do corpus golden master cai aqui (conformance/simples.test.ts
 * aprova 100% dos casos); são comportamentos do motor oficial que o corpus não cobre e cuja resposta depende de
 * mensagens internas do Spring/Jackson ou de um erro 500.
 *
 * Quem precisar desses casos deve usar o motor oficial (`SIMPLES_ENGINE=rfb-http`).
 */
export const NAO_SUPORTADOS = {
  /**
   * Corpo JSON que o Jackson recusa (tipo errado, ex.: `numero: "abc"`, `itens` não-array, corpo ausente ou
   * não-objeto, número decimal onde o contrato pede texto). O oficial responde HTTP 400 com o texto do parser.
   */
  CORPO_JSON_NAO_REPRODUZIVEL:
    "Corpo recusado pelo desserializador do motor oficial (HTTP 400 com mensagem do Jackson, não reproduzida).",
  /**
   * Item `null` na lista `itens` do contrato CLÁSSICO: o oficial lança NullPointerException (HTTP 500).
   * (No contrato não assistido o item nulo vira item vazio, e isso É reproduzido.)
   */
  ITEM_NULO_CLASSICO: "Item nulo no contrato clássico: o motor oficial responde HTTP 500.",
} as const;

export type CodigoNaoSuportado = keyof typeof NAO_SUPORTADOS;
