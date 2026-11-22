#!/usr/bin/env bash
# Compila o DANFSe oficial (RFB, Go) para WebAssembly e publica em public/wasm/.
#
# Fonte: https://github.com/ReceitaFederal/calculadora-rtc-gerador-danfse
# SHA fixado em scripts/rfb-sources.lock.
#
# - Usa .rfb/calculadora-rtc-gerador-danfse se existir (no SHA do lock); senão clona.
# - Requer Go (o go.mod pede 1.27; GOTOOLCHAIN=auto baixa o toolchain certo).
# - Os artefatos gerados (public/wasm/) são commitados: a Vercel não tem Go.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK="$ROOT/scripts/rfb-sources.lock"
REPO_NAME="calculadora-rtc-gerador-danfse"
REPO_URL="https://github.com/ReceitaFederal/${REPO_NAME}.git"
SRC="$ROOT/.rfb/$REPO_NAME"
OUT="$ROOT/public/wasm"

die() { echo "ERRO: $*" >&2; exit 1; }

# 1. SHA fixado no lock
REPO_SHA="$(awk -v n="$REPO_NAME" '$1 == n { print $2 }' "$LOCK")"
[ -n "$REPO_SHA" ] || die "SHA de $REPO_NAME não encontrado em $LOCK"

# 2. Fonte oficial (existente ou clonada) no SHA do lock
if [ ! -d "$SRC/.git" ]; then
  echo "==> Clonando $REPO_URL em $SRC"
  mkdir -p "$ROOT/.rfb"
  git clone --quiet "$REPO_URL" "$SRC"
fi
git -C "$SRC" cat-file -e "${REPO_SHA}^{commit}" 2>/dev/null \
  || git -C "$SRC" fetch --quiet origin "$REPO_SHA" \
  || die "não foi possível obter o commit $REPO_SHA"
git -C "$SRC" checkout --quiet --detach "$REPO_SHA"
ACTUAL_SHA="$(git -C "$SRC" rev-parse HEAD)"
[ "$ACTUAL_SHA" = "$REPO_SHA" ] || die "checkout em $ACTUAL_SHA, esperado $REPO_SHA"
echo "==> Fonte: $REPO_NAME @ $REPO_SHA"

# 3. Toolchain Go (o go.mod da fonte exige 1.27)
export GOTOOLCHAIN=auto
GO_VERSION="$(cd "$SRC" && go env GOVERSION)"
GOROOT_USED="$(cd "$SRC" && go env GOROOT)"
echo "==> Go: $GO_VERSION ($GOROOT_USED)"

# 4. Compila o WASM
mkdir -p "$OUT"
echo "==> Compilando cmd/danfse-wasm -> $OUT/danfse.wasm"
(
  cd "$SRC"
  GOOS=js GOARCH=wasm CGO_ENABLED=0 \
    go build -trimpath -ldflags="-s -w" -o "$OUT/danfse.wasm" ./cmd/danfse-wasm
)

# 5. wasm_exec.js da MESMA versão do Go usada
if [ -f "$GOROOT_USED/lib/wasm/wasm_exec.js" ]; then
  cp "$GOROOT_USED/lib/wasm/wasm_exec.js" "$OUT/wasm_exec.js"
elif [ -f "$GOROOT_USED/misc/wasm/wasm_exec.js" ]; then
  cp "$GOROOT_USED/misc/wasm/wasm_exec.js" "$OUT/wasm_exec.js"
else
  die "wasm_exec.js não encontrado em $GOROOT_USED"
fi

# 6. Licença oficial
cp "$SRC/LICENSE" "$OUT/LICENSE-danfse.txt"

# 7. Metadados (sha da fonte, versão do Go, sha256 dos artefatos)
WASM_SHA256="$(sha256sum "$OUT/danfse.wasm" | awk '{print $1}')"
WASM_EXEC_SHA256="$(sha256sum "$OUT/wasm_exec.js" | awk '{print $1}')"
WASM_BYTES="$(wc -c < "$OUT/danfse.wasm" | tr -d ' ')"
cat > "$OUT/danfse.meta.json" <<EOF
{
  "fonte": "https://github.com/ReceitaFederal/${REPO_NAME}",
  "fonteSha": "${REPO_SHA}",
  "goVersao": "${GO_VERSION}",
  "comando": "GOOS=js GOARCH=wasm CGO_ENABLED=0 go build -trimpath -ldflags=\"-s -w\" ./cmd/danfse-wasm",
  "wasm": { "arquivo": "danfse.wasm", "bytes": ${WASM_BYTES}, "sha256": "${WASM_SHA256}" },
  "wasmExec": { "arquivo": "wasm_exec.js", "sha256": "${WASM_EXEC_SHA256}" },
  "licenca": "LICENSE-danfse.txt"
}
EOF

echo "==> OK: $OUT/danfse.wasm ($WASM_BYTES bytes, sha256 $WASM_SHA256)"
