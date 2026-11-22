# Relatório de conformidade — regime regular

Gerado por `conformance/regime-regular.test.ts` (não editar à mão). Motor local `src/lib/engines/rtc` x corpus golden master `conformance/corpus/regime-regular/*.json`.

**Total avaliado: 698 requisições — aprovadas 698 (100.00%), reprovadas 0, não validadas (MotorLocalNaoValidadoError) 0. Fora do escopo (endpoints não portados): 13.**

## Por arquivo do corpus

| Arquivo | Requisições | Aprovadas | Reprovadas | Não validadas | Fora do escopo | Taxa (avaliadas) |
|---|---:|---:|---:|---:|---:|---:|
| aliquotas-nominais.json | 19 | 19 | 0 | 0 | 0 | 100.00% |
| bases-2026.json | 5 | 5 | 0 | 0 | 0 | 100.00% |
| bases-2027.json | 5 | 5 | 0 | 0 | 0 | 100.00% |
| bases-2033.json | 5 | 5 | 0 | 0 | 0 | 100.00% |
| compra-governamental.json | 59 | 59 | 0 | 0 | 0 | 100.00% |
| fronteiras-vigencia.json | 22 | 22 | 0 | 0 | 0 | 100.00% |
| imposto-seletivo-2026.json | 12 | 12 | 0 | 0 | 0 | 100.00% |
| imposto-seletivo-2027.json | 12 | 12 | 0 | 0 | 0 | 100.00% |
| imposto-seletivo-2028.json | 6 | 6 | 0 | 0 | 0 | 100.00% |
| imposto-seletivo-2029.json | 6 | 6 | 0 | 0 | 0 | 100.00% |
| imposto-seletivo-2030.json | 6 | 6 | 0 | 0 | 0 | 100.00% |
| imposto-seletivo-2031.json | 6 | 6 | 0 | 0 | 0 | 100.00% |
| imposto-seletivo-2032.json | 6 | 6 | 0 | 0 | 0 | 100.00% |
| imposto-seletivo-2033.json | 6 | 6 | 0 | 0 | 0 | 100.00% |
| imposto-seletivo-2034.json | 6 | 6 | 0 | 0 | 0 | 100.00% |
| localidades-2026.json | 14 | 14 | 0 | 0 | 0 | 100.00% |
| localidades-2027.json | 14 | 14 | 0 | 0 | 0 | 100.00% |
| matriz-cst-cclasstrib-2026.json | 15 | 15 | 0 | 0 | 0 | 100.00% |
| matriz-cst-cclasstrib-2027.json | 15 | 15 | 0 | 0 | 0 | 100.00% |
| matriz-cst-cclasstrib-2028.json | 13 | 13 | 0 | 0 | 0 | 100.00% |
| matriz-cst-cclasstrib-2029.json | 13 | 13 | 0 | 0 | 0 | 100.00% |
| matriz-cst-cclasstrib-2030.json | 13 | 13 | 0 | 0 | 0 | 100.00% |
| matriz-cst-cclasstrib-2031.json | 13 | 13 | 0 | 0 | 0 | 100.00% |
| matriz-cst-cclasstrib-2032.json | 13 | 13 | 0 | 0 | 0 | 100.00% |
| matriz-cst-cclasstrib-2033.json | 13 | 13 | 0 | 0 | 0 | 100.00% |
| matriz-cst-cclasstrib-2034.json | 13 | 13 | 0 | 0 | 0 | 100.00% |
| oficial-docs-exemplos-base.json | 1 | 0 | 0 | 0 | 1 | n/a |
| oficial-docs-exemplos-rg.json | 1 | 1 | 0 | 0 | 0 | 100.00% |
| oficial-docs-exemplos.json | 1 | 1 | 0 | 0 | 0 | 100.00% |
| oficial-testes-base-calculo-nfse.json | 1 | 0 | 0 | 0 | 1 | n/a |
| oficial-testes-base-calculo.json | 2 | 0 | 0 | 0 | 2 | n/a |
| oficial-testes-observabilidade.json | 81 | 81 | 0 | 0 | 0 | 100.00% |
| oficial-testes-pedagio.json | 9 | 0 | 0 | 0 | 9 | n/a |
| oficial-testes-regime-geral.json | 81 | 81 | 0 | 0 | 0 | 100.00% |
| operacao-erros.json | 25 | 25 | 0 | 0 | 0 | 100.00% |
| regime-geral-endpoint.json | 121 | 121 | 0 | 0 | 0 | 100.00% |
| tpdoc-2026.json | 29 | 29 | 0 | 0 | 0 | 100.00% |
| tpdoc-2027.json | 29 | 29 | 0 | 0 | 0 | 100.00% |

## Por código

Itens de `objetos`: estado (`CALCULADO`, `CALCULO_SIMULADO`, ...) quando sem erro, senão o código do erro do item. Respostas sem `objetos`: `<código> (global)` (422 da observabilidade) ou `HTTP <status> <tipo>` (erros de /regime-geral).

| Código | Itens | Aprovados | Taxa |
|---|---:|---:|---:|
| (/regime-geral) item calculado | 394 | 394 | 100.00% |
| CAL-007 | 1834 | 1834 | 100.00% |
| CALCULADO | 1887 | 1887 | 100.00% |
| CALCULO_SIMULADO | 8248 | 8248 | 100.00% |
| HTTP 400 erro-de-sistema-nao-previsto | 9 | 9 | 100.00% |
| HTTP 400 fato-gerador-nao-informada | 1 | 1 | 100.00% |
| HTTP 404 classificacao-tributaria-nao-encontrada | 12 | 12 | 100.00% |
| HTTP 404 municipio-nao-encontrado | 1 | 1 | 100.00% |
| HTTP 404 nbs-nao-encontrada | 1 | 1 | 100.00% |
| HTTP 404 ncm-nao-encontrada | 1 | 1 | 100.00% |
| HTTP 404 situacao-tributaria-nao-encontrada | 3 | 3 | 100.00% |
| HTTP 404 uf-nao-encontrada | 1 | 1 | 100.00% |
| HTTP 422 base-calculo-inconsistente | 1 | 1 | 100.00% |
| HTTP 422 base-calculo-menor-base-calculo-imposto-seletivo | 1 | 1 | 100.00% |
| HTTP 422 base-calculo-nao-informada | 1 | 1 | 100.00% |
| HTTP 422 classificacao-tributaria-nao-vinculada-situacao-tributaria | 1 | 1 | 100.00% |
| HTTP 422 classificacao-tributaria-nao-vinculada-tipo-documento | 1 | 1 | 100.00% |
| HTTP 422 dados-imposto-seletivo-nao-informados | 1 | 1 | 100.00% |
| HTTP 422 erro-falta-implementacao | 36 | 36 | 100.00% |
| HTTP 422 grupo-tributacao-regular-nao-informado | 1 | 1 | 100.00% |
| HTTP 422 incompatibilidade-suspensao | 1 | 1 | 100.00% |
| HTTP 422 municipio-nao-pertencente-uf | 2 | 2 | 100.00% |
| HTTP 422 nbs-nao-vinculada | 1 | 1 | 100.00% |
| HTTP 422 ncm-nao-vinculada | 2 | 2 | 100.00% |
| HTTP 422 ncm-nbs-simultaneas | 1 | 1 | 100.00% |
| REG-001 | 2 | 2 | 100.00% |
| REG-002 | 2 | 2 | 100.00% |
| REG-003 | 2 | 2 | 100.00% |
| REG-004 | 392 | 392 | 100.00% |
| REG-005 | 434 | 434 | 100.00% |
| REG-006 | 1 | 1 | 100.00% |
| REG-009 | 1 | 1 | 100.00% |
| REG-010 | 1 | 1 | 100.00% |
| REG-011 | 16 | 16 | 100.00% |
| REG-012 | 7 | 7 | 100.00% |
| REG-013 | 2 | 2 | 100.00% |
| REG-015 | 233 | 233 | 100.00% |
| REG-016 | 27 | 27 | 100.00% |
| REG-018 (global) | 3 | 3 | 100.00% |
| REG-019 (global) | 2 | 2 | 100.00% |
| REG-020 (global) | 2 | 2 | 100.00% |
| REG-021 (global) | 2 | 2 | 100.00% |
| REG-025 | 2 | 2 | 100.00% |
| REG-026 | 1 | 1 | 100.00% |
| REG-027 | 1 | 1 | 100.00% |
| REG-028 (global) | 2 | 2 | 100.00% |
| REG-029 | 169 | 169 | 100.00% |
| REG-030 | 128 | 128 | 100.00% |
| REG-033 | 6 | 6 | 100.00% |
| REG-036 | 15 | 15 | 100.00% |
| REG-037 | 15 | 15 | 100.00% |
| REG-038 (global) | 8 | 8 | 100.00% |
| VAL-001 (global) | 2 | 2 | 100.00% |
| VAL-004 | 3 | 3 | 100.00% |
| VAL-005 (global) | 1 | 1 | 100.00% |
| VAL-006 (global) | 3 | 3 | 100.00% |
| VAL-008 | 12 | 12 | 100.00% |
| VAL-009 | 1 | 1 | 100.00% |
| VAL-010 | 13 | 13 | 100.00% |
| VAL-013+VAL-004+VAL-013+VAL-004+VAL-013 | 1 | 1 | 100.00% |
| VAL-013 | 13 | 13 | 100.00% |

## Requisições reprovadas / não validadas (0)

Nenhuma.

## Fora do escopo (13)

Endpoints diferentes de `/calculadora/observabilidade/regime-geral` e `/calculadora/regime-geral` (pedágio, base de cálculo unificada), não portados neste WP.

- `oficial-docs-exemplos-base.json` oficial-docs-exemplos-base-0001: endpoint calculadora/base-calculo/base-calculo-unificada não portado
- `oficial-testes-base-calculo-nfse.json` oficial-testes-base-calculo-nfse-0001: endpoint calculadora/base-calculo/base-calculo-unificada-nfse não portado
- `oficial-testes-base-calculo.json` oficial-testes-base-calculo-0001: endpoint calculadora/base-calculo/base-calculo-unificada não portado
- `oficial-testes-base-calculo.json` oficial-testes-base-calculo-0002: endpoint calculadora/base-calculo/base-calculo-unificada não portado
- `oficial-testes-pedagio.json` oficial-testes-pedagio-0001: endpoint calculadora/pedagio não portado
- `oficial-testes-pedagio.json` oficial-testes-pedagio-0002: endpoint calculadora/pedagio não portado
- `oficial-testes-pedagio.json` oficial-testes-pedagio-0003: endpoint calculadora/pedagio não portado
- `oficial-testes-pedagio.json` oficial-testes-pedagio-0004: endpoint calculadora/pedagio não portado
- `oficial-testes-pedagio.json` oficial-testes-pedagio-0005: endpoint calculadora/pedagio não portado
- `oficial-testes-pedagio.json` oficial-testes-pedagio-0006: endpoint calculadora/pedagio não portado
- `oficial-testes-pedagio.json` oficial-testes-pedagio-0007: endpoint calculadora/pedagio não portado
- `oficial-testes-pedagio.json` oficial-testes-pedagio-0008: endpoint calculadora/pedagio não portado
- `oficial-testes-pedagio.json` oficial-testes-pedagio-0009: endpoint calculadora/pedagio não portado
