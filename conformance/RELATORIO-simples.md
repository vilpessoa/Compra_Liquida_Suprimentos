# Relatório de conformidade — Simples Nacional (motor local x motor oficial RFB)

Gerado por `conformance/simples.test.ts` (não editar à mão). Cada caso do corpus
`conformance/corpus/simples/*.json` é executado no motor local e comparado ao par `{status, response}` do
motor oficial por igualdade profunda estrita, com as normalizações documentadas em `conformance/README.md`
(`timestamp` => `<TIMESTAMP>`; arrays só-`VAL-*` sem depender da ordem).

Motor oficial do corpus: `{"aplicacao":"1.0.2","bancoDeDados":"V0073","repo":"calculadora-rtc-simples-nacional","sha":"a926d5a76095ac0295a6612a9a54db7ffead2396"}`

## Resumo

- Casos: **1817** | aprovados: **1817** (100.00%) | reprovados: **0** | não suportados: **0**

## Aprovação por arquivo

| Arquivo | Casos | Aprovados | Reprovados | Não suportados | Aprovação |
|---|---:|---:|---:|---:|---:|
| `atividades-catalogo.json` | 53 | 53 | 0 | 0 | 100.00% |
| `classico-cclasstrib-2027.json` | 8 | 8 | 0 | 0 | 100.00% |
| `classico-cclasstrib-2033.json` | 8 | 8 | 0 | 0 | 100.00% |
| `classico-compra-gov-is.json` | 53 | 53 | 0 | 0 | 100.00% |
| `classico-erros.json` | 27 | 27 | 0 | 0 | 100.00% |
| `classico-matriz-2026-12-31.json` | 6 | 6 | 0 | 0 | 100.00% |
| `classico-matriz-2027-06-30.json` | 33 | 33 | 0 | 0 | 100.00% |
| `classico-matriz-2028-06-30.json` | 6 | 6 | 0 | 0 | 100.00% |
| `classico-matriz-2029-06-30.json` | 6 | 6 | 0 | 0 | 100.00% |
| `classico-matriz-2030-06-30.json` | 33 | 33 | 0 | 0 | 100.00% |
| `classico-matriz-2031-06-30.json` | 6 | 6 | 0 | 0 | 100.00% |
| `classico-matriz-2032-06-30.json` | 6 | 6 | 0 | 0 | 100.00% |
| `classico-matriz-2033-06-30.json` | 6 | 6 | 0 | 0 | 100.00% |
| `classico-matriz-2034-06-30.json` | 6 | 6 | 0 | 0 | 100.00% |
| `nao-assistido-crt-2027-06-30.json` | 160 | 160 | 0 | 0 | 100.00% |
| `nao-assistido-crt-2030-06-30.json` | 40 | 40 | 0 | 0 | 100.00% |
| `nao-assistido-crt-2033-06-30.json` | 40 | 40 | 0 | 0 | 100.00% |
| `nao-assistido-nfse-2027-06-30.json` | 1134 | 1134 | 0 | 0 | 100.00% |
| `nao-assistido-nfse-2031-06-30.json` | 162 | 162 | 0 | 0 | 100.00% |
| `nao-assistido-variados.json` | 24 | 24 | 0 | 0 | 100.00% |

## Aprovação por código

Um caso conta em cada código `VSN-*` presente na resposta esperada (erros por item e globais). Casos sem
erro não aparecem aqui (estão apenas na tabela por arquivo).

| Código | Casos | Aprovados | Reprovados | Aprovação |
|---|---:|---:|---:|---:|
| `VSN-002` | 1 | 1 | 0 | 100.00% |
| `VSN-003` | 3 | 3 | 0 | 100.00% |
| `VSN-004` | 2 | 2 | 0 | 100.00% |
| `VSN-006` | 2 | 2 | 0 | 100.00% |
| `VSN-007` | 1 | 1 | 0 | 100.00% |
| `VSN-011` | 1 | 1 | 0 | 100.00% |
| `VSN-012` | 2 | 2 | 0 | 100.00% |
| `VSN-013` | 2 | 2 | 0 | 100.00% |
| `VSN-014` | 1 | 1 | 0 | 100.00% |
| `VSN-015` | 8 | 8 | 0 | 100.00% |
| `VSN-016` | 2 | 2 | 0 | 100.00% |
| `VSN-018` | 2 | 2 | 0 | 100.00% |
| `VSN-019` | 6 | 6 | 0 | 100.00% |
| `VSN-020` | 1 | 1 | 0 | 100.00% |
| `VSN-021` | 1 | 1 | 0 | 100.00% |
| `VSN-022` | 1 | 1 | 0 | 100.00% |
| `VSN-023` | 222 | 222 | 0 | 100.00% |
| `VSN-024` | 16 | 16 | 0 | 100.00% |
| `VSN-027` | 4 | 4 | 0 | 100.00% |
| `VSN-030` | 1 | 1 | 0 | 100.00% |
| `VSN-033` | 2 | 2 | 0 | 100.00% |
| `VSN-039` | 8 | 8 | 0 | 100.00% |
| `VSN-041` | 1 | 1 | 0 | 100.00% |
| `VSN-042` | 8 | 8 | 0 | 100.00% |
| `VSN-045` | 14 | 14 | 0 | 100.00% |
| `VSN-047` | 2 | 2 | 0 | 100.00% |

## Casos não aprovados

Nenhum.

