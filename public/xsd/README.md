# XSDs oficiais (NF-e e NFS-e)

Origem: repositório oficial `ReceitaFederal/calculadora-rtc-regime-regular`
(https://github.com/ReceitaFederal/calculadora-rtc-regime-regular), commit
`f1eebd7ce3157423b1a6aaca7dc1d6c3395452c4`, conforme `scripts/rfb-sources.lock`
(entrada `calculadora-rtc-regime-regular`).

Cópias byte a byte, com nomes e estrutura de pastas preservados (os `schemaLocation`
são relativos e dependem disso):

| Destino em `public/xsd/` | Origem no repositório oficial |
|---|---|
| `nfe/nota.xsd` | `src/main/resources/xml/nfe/nota.xsd` (raízes `NFe`, `enviNFe`, `nfeProc`) |
| `nfe/grupo.xsd` | `src/main/resources/xml/nfe/grupo.xsd` (raiz `infNFe`, fragmento de grupos) |
| `nfe/originais/*.xsd` | `src/main/resources/xml/nfe/originais/` (inclui `leiauteNFe_v4.00.xsd`, `nfe_v4.00.xsd`, `DFeTiposBasicos_v1.00.xsd`, `tiposBasico_v4.00.xsd`, `xmldsig-core-schema_v1.01.xsd`) |
| `nfse/nota.xsd` | `src/main/resources/xml/nfse/nota.xsd` (raiz `NFSe`) |
| `nfse/grupo.xsd` | `src/main/resources/xml/nfse/grupo.xsd` (raiz `infNFSe`) |
| `nfse/originais/*.xsd` | `src/main/resources/xml/nfse/originais/` |

NFC-e (`nfce/`) não foi copiada: o validador `nfe` usa os XSDs de NF-e. Os XMLs NFC-e
oficiais de teste validam contra estes XSDs (verificado com `xmllint`). O `nfce/grupo.xsd`
oficial difere do de NF-e apenas no tipo `TTribNFCe` e não é usado aqui.

Não edite estes arquivos. Para atualizar, troque o SHA em `scripts/rfb-sources.lock`
e recopie a partir do repositório oficial.
