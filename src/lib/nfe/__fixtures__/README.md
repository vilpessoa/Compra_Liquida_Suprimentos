# Fixtures oficiais NF-e / NFC-e

Cópias byte a byte de XMLs de teste oficiais da Receita Federal. Não editar.

- Repositório: `ReceitaFederal/calculadora-rtc-regime-regular`
- Commit (SHA): `f1eebd7ce3157423b1a6aaca7dc1d6c3395452c4`, conforme `scripts/rfb-sources.lock`
  (entrada `calculadora-rtc-regime-regular`). A cópia local foi conferida: o HEAD bate com esse SHA.

| Arquivo aqui | Origem no repositório oficial |
|---|---|
| `nfe/valido/nota/nfe_valido.xml` | `src/test/resources/xml/nfe/valido/nota/nfe_valido.xml` |
| `nfe/valido/grupo/nfe_valido.xml` | `src/test/resources/xml/nfe/valido/grupo/nfe_valido.xml` |
| `nfce/valido/nota/nfce_valido.xml` | `src/test/resources/xml/nfce/valido/nota/nfce_valido.xml` |
| `nfce/valido/grupo/nfce_valido.xml` | `src/test/resources/xml/nfce/valido/grupo/nfce_valido.xml` |
| `entradas/nfe.xml` | `src/test/resources/entradas/xml/nfe.xml` |
| `entradas/nfce.xml` | `src/test/resources/entradas/xml/nfce.xml` |

Tipos de documento:
- `nota`: documento completo (`enviNFe` > `NFe` > `infNFe`), validado por `nota.xsd`.
- `grupo` e `entradas`: fragmento `infNFe` (sem envelope), validado por `grupo.xsd`.

Observação: o repositório oficial não contém XML inválido de NF-e (todos os casos são `valido`).
