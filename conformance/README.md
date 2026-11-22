# Conformance: corpus "golden master" do motor oficial da RFB

Pares `{request, response}` obtidos **do motor oficial** (repositórios `ReceitaFederal/calculadora-rtc-regime-regular` e `calculadora-rtc-simples-nacional`, SHAs em `scripts/rfb-sources.lock`), para provar que o port TypeScript é idêntico. Nenhum dado tributário foi escrito à mão (ver "Origem das entradas").

Motor: regime-regular app `1.7.2`, Simples app `1.0.2`, banco `V0073` (73 migrações Flyway oficiais). Está registrado em `meta.motor` de cada arquivo e em `corpus/manifest.json`.

## Como reproduzir

```bash
export JAVA_HOME=<JDK 25>
export RFB_REGIME_SRC=<checkout calculadora-rtc-regime-regular>   # somente leitura
export RFB_SN_SRC=<checkout calculadora-rtc-simples-nacional>      # somente leitura
conformance/setup-official.sh        # copia p/ conformance/work (gitignored), gera o SQLite (flyway:migrate), compila (-DskipTests) e sobe as APIs
npx tsx conformance/generate-corpus.ts   # regrava conformance/corpus/**  (RFB_REGIME_SRC é usado p/ ler testes/docs oficiais)
conformance/stop-official.sh
```

| API | URL base | Management |
|---|---|---|
| regime-regular | `http://localhost:8080/api` | 9101 |
| simples-nacional | `http://localhost:8082/api` | 9103 |

Opções do gerador: `--only=<trecho-do-lote>` (regrava só esses lotes), `--out=<dir>`, `--dry` (só conta). Requer `better-sqlite3` (já em `package.json`); nenhuma dependência nova. A geração é **determinística** (3 execuções seguidas idênticas, byte a byte), com as normalizações abaixo.

## Formato

Um arquivo por lote: `corpus/<api>/<lote>.json` = `{meta, cases[]}`. `meta` traz api/endpoint/método/motor/descrição. Cada caso: `id`, `request` (corpo JSON enviado; `baseCalculo` e demais números preservam a grafia, ex. `100.00`), `status` HTTP, `response` (corpo devolvido, tal como veio), `warn` (header `x-warning-dados-simulados`, quando presente), `path`/`method` (só nos GET ou quando diferem do lote), `tags` (uma por item, só documentação: `CST/cClassTrib|variante`).

Respostas de erro (422, 400, 404 e itens `INCONSISTENCIA_ENTRADA`/`NAO_IMPLEMENTADO`) são parte do corpus. Endpoint principal: `POST calculadora/observabilidade/regime-geral` (erros por item, HTTP 200) e, no Simples, `calculadora/observabilidade/simples-nacional[/nao-assistido]`.

### Normalizações (única diferença para o bruto do motor)
1. Campos `timestamp` (hora do servidor, nos erros 400/404/422 fora da observabilidade) viram `"<TIMESTAMP>"`.
2. A **ordem das violações Bean Validation** (`VAL-*`) em `erros`/`errors` e dentro do texto `detail` "Um ou mais campos são inválidos - [..] [..]" vem de um `Set` Java e **muda entre execuções**; o corpus as ordena por pointer/code/detail. O port deve comparar essas listas sem depender da ordem (ou aplicar a mesma ordenação).
3. `POST /regime-geral` processa itens em paralelo e devolve o **primeiro erro que terminar**: com vários itens inválidos o erro devolvido pode variar entre execuções. Nesses casos (status ≥ 400 e mais de 1 item) o caso leva `"naoDeterministico": true` e a resposta guardada é a menor (ordem lexicográfica) de 12 amostras. Não use esses 4 casos como prova de igualdade exata (basta que o erro seja um dos erros possíveis do conjunto de itens).
4. As URLs `type` dos erros saem como `http://localhost/api/...` (derivam do Host da requisição; porta omitida).

## Origem das entradas (nada inventado)

* **Tabelas oficiais** (SQLite gerado pelo Flyway oficial): cClassTrib/CST (`CLASSIFICACAO_TRIBUTARIA` + `SITUACAO_TRIBUTARIA` + `TRIBUTO_SITUACAO_TRIBUTARIA`: 173 de CBS/IBS e 29 de IS), vínculos (`NCM_APLICAVEL`/`NBS_APLICAVEL` com prefixos expandidos para NCM/NBS completos existentes em `NCM`/`NBS`, descontadas `EXCECAO_NCM_APLICAVEL`; `CLASSIF_NBS_INDOP_LC`; `TIPO_DFE_CLASSIFICACAO`), NCMs com IS (`ALIQUOTA_AD_VALOREM_PRODUTO`/`ALIQUOTA_AD_REM_PRODUTO` + unidade), UFs/municípios (`UF`/`MUNICIPIO`), tipos de DFe, atividades/enquadramentos/tpRBSN do Simples (`ATIVIDADE_SIMPLES_NACIONAL`, `ENQUADRAMENTO_REGIME_SIMPLES_NACIONAL`, `TIPO_DFE_CALCULO_SIMPLES_NACIONAL`, `TIPO_DFE_ATIVIDADE_SIMPLES_NACIONAL`, `CLTR_TPRBSN`).
* **Datas**: uma por ano 2026..2034 (`AAAA-06-30`; 2034 = primeiro ano após o fim das vigências 2033) e, no lote de fronteiras, **todas** as datas de início/fim de vigência distintas das tabelas de classificação, tratamento, redução, anexos, vínculos DFe, alíquotas ad valorem e referência (+ dia anterior/posterior). No Simples: 2026-12-31 (anterior à vigência, 2027-01-01) e 2027..2034.
* **Literais oficiais**: todos os `.json` de entrada de `src/test/resources/entradas/**` (exceto saídas esperadas e XML) e os blocos de entrada de `docs/exemplos.md`.
* **Parâmetros de TESTE (não são dado tributário)**:
  * Bases de cálculo: `0.01, 1.00, 100.00, 1234.56, 99999.99` (rotativas na matriz; varridas por inteiro no lote `bases`).
  * Conjuntos de `aliquotasNominais` copiados **literalmente** de entradas dos testes oficiais/docs: `cbs/ibsEstadual/ibsMunicipal` = A `8.4/0.05/0.05` (padrão da matriz), B `8.8/0.05/0.05`, C `8.8123/0.05/0.05`, D `1/0/0`, E `10.85/0/0`, F `3.285/0.365/0`, G `8.5/1.6/0.25`; IS: `adRem 21.3`, `adValorem 13` (ad valorem sozinho p/ NCMs só-ad valorem; ad rem + ad valorem, com `unidade`, p/ NCMs ad rem). Também as alíquotas de referência de 2026 lidas de `ALIQUOTA_REFERENCIA` (0.9/0.1/0) reaplicadas em 2027.
  * Simples, não assistido: linha `aliquotasEfetivas` da fixture do teste oficial (`SimplesNacionalNaoAssistidoControllerTest.linha()`: anexo I 1.1612/0.0129; II 1.1184/0.0121; III 2.2154/0.0257 (sem redistribuição 1.99/0.0231); IV 2.0119/0.022 (1.85/0.0202); V 3.2534/0.0363; fatorR true). Simples, clássico: `pIBSSN=1.25`, `pCBSSN=2.75` (literais dos testes). **Não há tabela de faixas/alíquotas efetivas nos dados oficiais**: elas são informadas pelo contribuinte (PGDAS), então "faixas" são cobertas apenas por esses valores de teste.
  * `tpEnteGov` 1..6 e `tpOperGov` 1..5 (enums do Java).

## `aliquotasNominais` (campo de `ItemOperacaoInput`)

Grupo `{cbs, ibsEstadual, ibsMunicipal, impostoSeletivo:{adValorem, adRem}}` em **pontos percentuais** (até 3 inteiros e 4 decimais, 0..100). Lido em `ProcessamentoItemService.validarAliquotasNominais` e `CalculoCbsIbsService.obterAliquotaNominal`:

* **Fato gerador ≤ 2026**: **proibido** informar qualquer valor (erro `REG-036`). O motor resolve sozinho as alíquotas oficiais (CBS 0.9, IBS-UF 0.1, IBS-Mun 0.0 em `ALIQUOTA_REFERENCIA`). Item sai `CALCULADO`.
* **Fato gerador ≥ 2027**: **obrigatório** (cbs, ibsEstadual **e** ibsMunicipal) quando o CST exige o grupo IBS/CBS (`SITR_IND_GIBSCBS=1`); ausente/incompleto = `REG-037`. O banco oficial **não tem alíquotas após 2026** (`ALIQUOTA_PADRAO` vazia; `ALIQUOTA_REFERENCIA` só 2026; `ALIQUOTA_AD_VALOREM` de IS com `valor` nulo): quem chama informa. CSTs sem grupo IBS/CBS (ex. 400, 410) não exigem.
* Com valores informados o item vira `CALCULO_SIMULADO` (em vez de `CALCULADO`), a resposta traz o header `x-warning-dados-simulados` (`warn`, p.ex. `6`) e o valor informado **prevalece** sobre alíquota fixa/expressão do tratamento. Vale para tipos de alíquota Padrão, Uniforme nacional, Uniforme setorial (sem monofasia), Fixa e Sem alíquota. Totais somam CALCULADO e CALCULO_SIMULADO sem distinção.
* `impostoSeletivo.adValorem/adRem`: alíquota de IS informada; `adRem` exige `impostoSeletivo.unidade` no item (`REG-023` caso contrário). Sem alíquota de IS e com NCM com incidência de IS em 2027+: `REG-013` (grupo IS não informado) / erro de alíquota de IS não informada.
* Por isso o corpus tem: 2026 **sem** nominais (comportamento padrão); 2026 **com** nominais (REG-036); 2027+ **sem** nominais (REG-037) e **com** nominais (conjuntos A–G, ref. 2026, parciais, fora do domínio `VAL-008/010/013`, só-IS). A matriz 2027+ usa o conjunto A (`8.4/0.05/0.05`) e o IS usa `adValorem 13`/`adRem 21.3`.

## Lotes

Regime regular (`corpus/regime-regular`): `matriz-cst-cclasstrib-<ano>` (todas as 173 combinações CST×cClassTrib CBS/IBS × anos 2026..2034 × variantes de NCM/NBS: sem, NCM vinculado, NBS vinculado — em 2026/2027 também o 2º NCM/NBS e NBS por INDOP); `imposto-seletivo-<ano>` (29 classificações de IS × NCMs de IS: ad rem (3) + ad valorem primeiro/mediano/último; base derivada e `impostoInformado`); `bases-*`; `localidades-*` (8 UFs/16 municípios reais); `compra-governamental`; `aliquotas-nominais`; `tpdoc-2026/2027` (vinculadas e não vinculadas por tipo de documento); `fronteiras-vigencia`; `operacao-erros`; `regime-geral-endpoint` (POST /regime-geral); `oficial-*` (literais; observabilidade, /regime-geral, pedágio, base de cálculo unificada NF-e e NFS-e, docs/exemplos.md).

Simples (`corpus/simples`): `classico-*` (contrato OperacaoSimplesInput, marcado OBSOLETO no código mas ativo: atividades admissíveis por tpDoc × cClassTrib vinculadas ao documento por tpRBSN × CRT 1/2/3+tpRegimeIBSCBS=2 × anos; todas as cClassTrib da NF-e; compra governamental; IS; erros globais); `nao-assistido-crt-*` (enquadramentos CRT × tpDoc × atividades × fatorR × impedimentoSublimite, linha de alíquotas efetivas informada) e `nao-assistido-nfse-*` (tpDoc 91, enquadramentos NFSE × atividades 07..14,90 × tribISSQN/tpRetISSQN/tpBM); `nao-assistido-variados` (inclui o caminho **sem** `aliquotasEfetivas` em cada enquadramento: `VSN-039` exceto SOMENTE_RECEITA); `atividades-catalogo` (GET).

Lotes (requisições; itens; KiB em disco):

| Lote | Req. | Itens | KiB |
|---|---|---|---|
| `regime-regular/matriz-cst-cclasstrib-2026` | 15 | 572 | 561 |
| `regime-regular/matriz-cst-cclasstrib-2027` | 15 | 572 | 604 |
| `regime-regular/matriz-cst-cclasstrib-2028` | 13 | 519 | 540 |
| `regime-regular/matriz-cst-cclasstrib-2029` | 13 | 519 | 540 |
| `regime-regular/matriz-cst-cclasstrib-2030` | 13 | 519 | 540 |
| `regime-regular/matriz-cst-cclasstrib-2031` | 13 | 519 | 540 |
| `regime-regular/matriz-cst-cclasstrib-2032` | 13 | 519 | 540 |
| `regime-regular/matriz-cst-cclasstrib-2033` | 13 | 519 | 540 |
| `regime-regular/matriz-cst-cclasstrib-2034` | 13 | 519 | 540 |
| `regime-regular/imposto-seletivo-2026` | 12 | 348 | 192 |
| `regime-regular/imposto-seletivo-2027` | 12 | 348 | 546 |
| `regime-regular/imposto-seletivo-2028` | 6 | 174 | 267 |
| `regime-regular/imposto-seletivo-2029` | 6 | 174 | 267 |
| `regime-regular/imposto-seletivo-2030` | 6 | 174 | 267 |
| `regime-regular/imposto-seletivo-2031` | 6 | 174 | 267 |
| `regime-regular/imposto-seletivo-2032` | 6 | 174 | 267 |
| `regime-regular/imposto-seletivo-2033` | 6 | 174 | 267 |
| `regime-regular/imposto-seletivo-2034` | 6 | 174 | 267 |
| `regime-regular/bases-2026` | 5 | 200 | 187 |
| `regime-regular/bases-2027` | 5 | 200 | 202 |
| `regime-regular/bases-2033` | 5 | 200 | 202 |
| `regime-regular/localidades-2026` | 14 | 560 | 519 |
| `regime-regular/localidades-2027` | 14 | 560 | 560 |
| `regime-regular/compra-governamental` | 59 | 1697 | 1893 |
| `regime-regular/aliquotas-nominais` | 19 | 720 | 686 |
| `regime-regular/tpdoc-2026` | 29 | 725 | 592 |
| `regime-regular/tpdoc-2027` | 29 | 725 | 646 |
| `regime-regular/fronteiras-vigencia` | 22 | 853 | 809 |
| `regime-regular/operacao-erros` | 25 | 25 | 21 |
| `regime-regular/regime-geral-endpoint` | 121 | 123 | 178 |
| `regime-regular/oficial-testes-observabilidade` | 81 | 354 | 556 |
| `regime-regular/oficial-testes-regime-geral` | 81 | 354 | 543 |
| `regime-regular/oficial-testes-pedagio` | 9 | 0 | 8 |
| `regime-regular/oficial-testes-base-calculo` | 2 | 0 | 1 |
| `regime-regular/oficial-testes-base-calculo-nfse` | 1 | 0 | 1 |
| `regime-regular/oficial-docs-exemplos` | 1 | 4 | 5 |
| `regime-regular/oficial-docs-exemplos-rg` | 1 | 4 | 2 |
| `regime-regular/oficial-docs-exemplos-base` | 1 | 0 | 1 |
| `simples/classico-matriz-2026-12-31` | 6 | 180 | 34 |
| `simples/classico-matriz-2027-06-30` | 33 | 762 | 598 |
| `simples/classico-matriz-2028-06-30` | 6 | 180 | 142 |
| `simples/classico-matriz-2029-06-30` | 6 | 180 | 142 |
| `simples/classico-matriz-2030-06-30` | 33 | 762 | 597 |
| `simples/classico-matriz-2031-06-30` | 6 | 180 | 142 |
| `simples/classico-matriz-2032-06-30` | 6 | 180 | 142 |
| `simples/classico-matriz-2033-06-30` | 6 | 180 | 142 |
| `simples/classico-matriz-2034-06-30` | 6 | 180 | 142 |
| `simples/classico-cclasstrib-2027` | 8 | 312 | 230 |
| `simples/classico-cclasstrib-2033` | 8 | 312 | 231 |
| `simples/classico-compra-gov-is` | 53 | 581 | 404 |
| `simples/classico-erros` | 27 | 26 | 23 |
| `simples/nao-assistido-crt-2027-06-30` | 160 | 3280 | 2630 |
| `simples/nao-assistido-crt-2030-06-30` | 40 | 820 | 657 |
| `simples/nao-assistido-crt-2033-06-30` | 40 | 820 | 657 |
| `simples/nao-assistido-nfse-2027-06-30` | 1134 | 1134 | 2056 |
| `simples/nao-assistido-nfse-2031-06-30` | 162 | 162 | 288 |
| `simples/nao-assistido-variados` | 24 | 24 | 28 |
| `simples/atividades-catalogo` | 53 | 0 | 204 |

## Estatísticas (geradas em `corpus/manifest.json`)

* 59 arquivos, 25 MiB; **2528 requisições** (regime-regular 711; simples 1817).
* Regime regular: 13 995 itens enviados. Por estado de item: CALCULO_SIMULADO 8248, CALCULADO 1887, NAO_IMPLEMENTADO 1834, INCONSISTENCIA_ENTRADA 1500 (+394 objetos de /regime-geral sem `estadoItem`). HTTP: 200×600, 422×77, 404×21, 400×13.
  Códigos por item: CAL-007 1834, REG-005 434, REG-004 392, REG-015 233, REG-029 169, REG-030 128, REG-016 27, REG-011 16, REG-036 15, REG-037 15, VAL-013 16, VAL-010 13, VAL-008 12, REG-012 7, REG-033 6, VAL-004 5, REG-013 2, REG-025 2, REG-001/002/003 2 cada, REG-006/009/010/026/027 e VAL-009 1 cada. Globais (operação): REG-038 8, REG-018 3, VAL-006 3, REG-019/020/021/028 e VAL-001 2 cada, VAL-005 1.
* Simples: 10 255 itens enviados. CALCULADO 6125, NAO_CALCULADO 2413, INCONSISTENCIA_ENTRADA 1229, NAO_IMPLEMENTADO 90. HTTP: 200×1766, 422×49, 404×1, 400×1.
  Códigos por item: VSN-023 1040, VSN-045 178, VSN-027 90, VSN-042 32, VSN-047 2, VSN-003 3, VSN-004/006 2, VSN-002/007/020/021/022/041 1. Globais: VSN-024 16, VSN-015 8, VSN-039 8, VSN-019 6, VSN-012/013/016/018/033 2, VSN-011/014/030 1.

## Comportamentos do motor que surpreendem
* Pré-2027 o motor **rejeita** `aliquotasNominais`; pós-2026 o motor **exige** e não tem alíquota própria (ver acima).
* Ordem de erros de validação e "primeiro erro" paralelo do `/regime-geral` não são estáveis (normalizações 2 e 3).
* IS só existe a partir de 2027 (`TRIBUTO.IS` inicia 2027-01-01): em 2026 qualquer CST de IS devolve `REG-004`.
* `CAL-007` (NAO_IMPLEMENTADO) cobre 1834 itens: cClassTrib com tratamento que tem ajuste/monofasia ainda não implementado (`TRTR_IN_POSSUI_AJUSTE`); o port deve reproduzir o mesmo status, não calcular.
* Classificações cujo código existe tanto para CBS/IBS quanto para IS (ex. `000001`) são desambiguadas pelo tributo (id 2 vs 1), não pelo código.
* Itens de erro por Bean Validation têm `pointer` como `#/itens/0/impostoSeletivo.cClassTrib` (ponto, não barra).
* O Simples tem vigência a partir de 2027-01-01; 2026-12-31 devolve `VSN-015` global (tpDoc não suportado na data).

## Fora do corpus
Geração/validação de XML (`/xml/**`), `dados-abertos`, NFS-e `/nfse/**`, `base-calculo/is-mercadorias` e `cbs-ibs-mercadorias`, `GET /observabilidade/erros` e o endpoint assistido do Simples.

## Teste diferencial (fuzz) — resultado registrado

`npx tsx conformance/differential.ts --n=5000 --seed=2026`, rodado com os motores oficiais no ar
(regime regular 1.7.2, Simples 1.0.2, base V0073), em 2026-11-22. As requisições partem das estruturas
do corpus e recebem bases, quantidades, datas, alíquotas nominais e alíquotas efetivas do Simples sorteadas.

**Resultado: 5000 requisições, 5000 idênticas ao motor oficial, 0 divergentes, 0 recusadas.**
Antes, uma rodada de 500 com seed 1 também deu 500 idênticas.
