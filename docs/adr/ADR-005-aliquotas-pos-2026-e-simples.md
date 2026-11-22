# ADR-005 — Alíquotas pós-2026 e fornecedores do Simples Nacional

**Status:** aceita (decisão do responsável pelo produto, 2026-11-22)

## Contexto
A base oficial `ReceitaFederal/calculadora-rtc-regime-regular@f1eebd7` contém em
`ALIQUOTA_REFERENCIA` apenas as alíquotas de 2026. A migração oficial
`V0053__ajustes_aliquotas.sql` remove explicitamente os registros com início de vigência
posterior a 2026-12-31, e `ALIQUOTA_PADRAO` está vazia. O motor oficial aceita
`aliquotasNominais` no `ItemOperacaoInput` para que o chamador informe as alíquotas.

A base também não contém os Anexos I a V, as faixas nem o Fator R do Simples Nacional.
O serviço oficial recebe as alíquotas efetivas como entrada (`AliquotasEfetivasInput`).

## Decisão
1. **Fato gerador em 2026:** o portal usa somente as alíquotas da base oficial.
2. **Fato gerador em 2027 ou depois:** o cálculo fica **bloqueado** até o comprador informar
   as alíquotas nominais (CBS, IBS UF, IBS Município e, se houver, IS) **citando o ato
   legal de origem**. O resultado e o Parecer de Cotação levam o selo
   "Alíquota informada pelo usuário" junto com a citação. O portal nunca sugere nem preenche
   valores sozinho.
3. **Fornecedor do Simples Nacional:** o comprador informa as alíquotas efetivas de CBS e IBS
   declaradas pelo fornecedor, na proposta ou no PGDAS-D. Sem elas a proposta aparece como
   "Crédito não determinável — solicitar ao fornecedor" e **não entra no ranking**.

## Consequências
Nenhum valor tributário é presumido. O motor local (TS) precisa reproduzir o comportamento
oficial com e sem `aliquotasNominais`, e o corpus de conformidade cobre os dois casos.
