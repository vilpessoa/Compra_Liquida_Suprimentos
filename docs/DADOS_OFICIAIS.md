# Dados oficiais RTC (snapshot da Receita Federal)

Regra: nenhum dado tributario e digitado a mao. Tudo em `src/data/rtc/` e gerado a partir das
migracoes SQL oficiais da Receita Federal, em commits fixados em `scripts/rfb-sources.lock`.

## Origem

| Repositorio | Papel |
|---|---|
| `ReceitaFederal/calculadora-rtc-regime-regular` | Contem `flyway/` (conf + SQL). **Unica fonte dos dados.** |
| `ReceitaFederal/calculadora-rtc-simples-nacional` | Sem migracoes proprias: o README manda copiar a pasta `flyway/` do regime-regular e usa o mesmo banco `calculadora-pro.db`. O extrator verifica essa condicao (falha se surgirem `.sql`/`flyway/` ali) e confere que as tabelas das entidades Java existem no snapshot. |
| `ReceitaFederal/calculadora-rtc-gerador-danfse` | Listado no lock, mas nao e fonte de dados tributarios. |

SHA e data de cada fonte, e o SHA-256 de cada SQL aplicado, ficam em `src/data/rtc/meta.json`.

## Como regenerar

```bash
bash scripts/fetch-rfb-sources.sh   # clona/checkout dos SHAs do lock em .rfb/ (idempotente)
npm run extract:rtc                 # aplica as migracoes e reescreve src/data/rtc/*.json + meta.json
npx vitest run scripts              # confere meta x JSON x SQL fonte
```

`RFB_DIR=<dir>` aponta para outro diretorio de fontes. O extrator aborta se o HEAD de um clone
diferir do lock ou se a arvore de trabalho estiver modificada. Para atualizar o snapshot, altere o lock
(SHA/data) e rode o fluxo acima.

## Como as migracoes sao aplicadas (semantica Flyway)

`flyway/flyway-pro.conf` (unico `.conf`): `locations=filesystem:./flyway/sql` (recursivo: `criacao/` e `manutencao/`),
`baselineOnMigrate=true`, `mixed=true`, banco SQLite com `foreign_keys=ON`. Ordem executada num SQLite em memoria
(`better-sqlite3`), 75 scripts:

1. `beforeMigrate.sql` (callback, uma vez);
2. `B0001__sistema_tributario_completo.sql` (baseline);
3. `V0002` ... `V0073` em ordem numerica (nenhuma versao omitida/duplicada; nao ha `R__`);
4. `afterMigrate.sql` (callback; recria tabelas AARE/AADV sem NOT NULL, indices, ANALYZE).

Cada migracao roda em transacao (como o Flyway), pois varios scripts usam `PRAGMA defer_foreign_keys = ON`, que so vale
dentro de transacao. Excecao, tambem como no Flyway (`mixed=true`): scripts com `PRAGMA foreign_keys = ...`
(beforeMigrate, B0001, V0044, afterMigrate) rodam sem transacao, pois esse pragma e no-op dentro de uma. Esta
regra nao altera nenhum SQL, apenas decide como ele e executado.
Apos aplicar: `integrity_check = ok` e `foreign_key_check` sem violacoes (ambos verificados pelo extrator).

## Formato dos JSON

Um arquivo por dominio. Cada arquivo e `{ "<TABELA>": { "meta": {...}, "rows": [ ... ] } }`:

- nomes de tabela e coluna originais (sem renomear); `meta.columns` traz nome, tipo declarado e posicao na PK;
- linhas ordenadas pela PK (ou rowid), uma por linha de texto (diff legivel);
- **decimais como string**: toda celula `REAL` do SQLite e exportada com `CAST(... AS TEXT)` (ex.: `"0.9"`, `"3.285"`, `"0.0"`);
  `meta.decimalAsStringColumns` lista essas colunas. Inteiros, datas (texto ISO) e codigos (texto) permanecem como no banco;
- `null` = NULL do banco.

| Arquivo | Tabelas (linhas) |
|---|---|
| `aliquotas.json` | TRIBUTO (4), UNIDADE_MEDIDA (5), ALIQUOTA_REFERENCIA (3), ALIQUOTA_PADRAO (0), AJUSTE (0), REDUTOR (0), REDUTOR_COMPRA_GOVERNAMENTAL (1), TRANSFERENCIA_CBS_ENTE_GOV (6), APROPRIACAO_CREDITO_ADQUIRENTE (0) |
| `tratamentos-tributarios.json` | TRATAMENTO_TRIBUTARIO (43), TRATAMENTO_CLASSIFICACAO (202) |
| `situacoes-tributarias.json` | SITUACAO_TRIBUTARIA (25), TRIBUTO_SITUACAO_TRIBUTARIA (61) |
| `classificacoes-tributarias.json` | CLASSIFICACAO_TRIBUTARIA (202), PERCENTUAL_REDUCAO (519) |
| `fundamentacoes-legais.json` | FUNDAMENTACAO_LEGAL (202), FUNDAMENTACAO_CLASSIFICACAO (202) |
| `vinculos-ncm-nbs.json` | NCM_APLICAVEL (1372), EXCECAO_NCM_APLICAVEL (75), NBS_APLICAVEL (118), EXCECAO_NBS_APLICAVEL (0), CLASSIF_NBS_INDOP_LC (3280), INDICADOR_OPERACAO_IBS_CBS (66), LISTA_SERVICOS_LC_116 (255) |
| `ncm.json` | NCM (15162) |
| `nbs.json` | NBS (1237) |
| `imposto-seletivo.json` | ALIQUOTA_AD_VALOREM (46), _PRODUTO (331), _SERVICO (0), ALIQUOTA_AD_REM (2), _PRODUTO (3), _SERVICO (0), EXCECAO_AD_VALOREM_PRODUTO (1), _SERVICO (0), EXCECAO_AD_REM_PRODUTO (0), _SERVICO (0) |
| `simples-nacional.json` | ATIVIDADE_SIMPLES_NACIONAL (15), ENQUADRAMENTO_REGIME_SIMPLES_NACIONAL (11), REGIME_APURACAO_SIMPLES_NACIONAL (5), SITUACAO_ISS_PAR_ALIQUOTA_SIMPLES_NACIONAL (10), TIPO_DFE_ATIVIDADE_SIMPLES_NACIONAL (29), TIPO_DFE_CALCULO_SIMPLES_NACIONAL (8), TIPO_RECEITA_BRUTA_SIMPLES_NACIONAL (14), TRANSICAO_ALIQUOTA_COMPRA_GOV_SIMPLES_NACIONAL (6) |
| `anexos-nfse.json` | ANEXO (821) - anexos da NFS-e / lista de servicos, **nao** os Anexos I-V do Simples |
| `documentos-fiscais.json` | TIPO_DFE (18), GRUPO_DFE (5), TIPO_DFE_CLASSIFICACAO (419), TOMADOR_ESPECIFICO (6) |
| `atores.json` | GRUPO_ATOR (17), ATOR (90), ATOR_CLASSIFICACAO (146), ATOR_CLASSIFICACAO_FUNDAMENTACAO (0) |
| `localidades.json` | UF (28), MUNICIPIO (5573) |
| `versao-base.json` | VERSAO_BASE_DADO (73) |
| `meta.json` | fontes, SQL aplicados + SHA-256, contagens, SHA-256/tamanho de cada JSON |

Total: 55 tabelas, 30.717 linhas, ~5,2 MiB (abaixo do limite de 25 MB; nao foi necessario dividir alem dos dominios).
O extrator falha se existir tabela de usuario sem dominio, ou se uma entidade Java (`@Table`) dos dois repos nao
estiver exportada.

## Transformacoes aplicadas

Nenhuma sobre o SQL: os 75 scripts rodaram **sem edicao** no `better-sqlite3` (nao foi preciso adaptar sintaxe).
Transformacoes apenas na saida:

1. REAL -> string canonica do SQLite (`CAST AS TEXT`). O extrator verifica que `CAST(texto AS REAL)` reproduz exatamente o valor.
   Efeito colateral inerente ao tipo REAL: zeros a direita do literal do SQL nao sao preservados (`0.90` no INSERT vira `"0.9"`);
   numericamente identico.
2. Tabelas internas `sqlite_stat1`/`sqlite_stat4` (geradas por `ANALYZE` no afterMigrate) nao sao exportadas.

## Testes (`scripts/extract-rtc-data.test.ts`)

- hash/tamanho de cada JSON == `meta.json`; sem JSON fora do meta; contagens e colunas consistentes; decimais como string;
- SHA-256 dos SQL aplicados == arquivos fonte; fontes do meta == lock e HEAD dos clones; ordem e completude das migracoes;
- UF: JSON == `INSERT INTO UF` lido do SQL; ALIQUOTA_REFERENCIA: cada linha existe no INSERT do baseline, com fim de vigencia vindo do INSERT ou de `UPDATE` literal;
- proveniencia global: todo valor de toda tabela aparece como literal nos SQL aplicados (a unica excecao e `VERSAO_BASE_DADO.VRBD_DATA`).

Os testes contra o SQL sao pulados (com aviso) se `.rfb/` nao existir.

## Limitacoes / pontos de atencao

- `VERSAO_BASE_DADO.VRBD_DATA` vem de `datetime('now')` em 11 migracoes: e a data da execucao, entao `versao-base.json`
  (e o seu hash no `meta.json`) muda a cada extracao. Todos os demais JSON sao deterministicos.
- O snapshot reflete a vigencia do banco oficial: `ALIQUOTA_REFERENCIA` tem apenas CBS/IBS-UF/IBS-Mun de 2026 (aliquotas de teste); nao ha
  aliquotas por UF/municipio individuais no banco.
- O banco **nao** contem as tabelas de Anexos I-V / faixas / Fator R do Simples Nacional (LC 123): o servico oficial recebe as aliquotas
  efetivas como entrada (`AliquotasEfetivasInput`). Estao exportadas apenas as tabelas de parametrizacao do calculo IBS/CBS para o Simples.
