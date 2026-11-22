#!/usr/bin/env bash
# Clona as fontes oficiais da Receita Federal listadas em scripts/rfb-sources.lock
# em .rfb/<repo> e faz checkout do SHA exato. Idempotente.
# Uso: bash scripts/fetch-rfb-sources.sh
# Variaveis: RFB_BASE_URL (default https://github.com/ReceitaFederal), RFB_DIR (default <raiz>/.rfb)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK="$ROOT/scripts/rfb-sources.lock"
DEST="${RFB_DIR:-$ROOT/.rfb}"
BASE_URL="${RFB_BASE_URL:-https://github.com/ReceitaFederal}"

[ -f "$LOCK" ] || { echo "lock nao encontrado: $LOCK" >&2; exit 1; }
mkdir -p "$DEST"

while read -r repo sha data _; do
  [ -z "${repo:-}" ] && continue
  case "$repo" in \#*) continue ;; esac
  if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "SHA invalido para $repo: '$sha'" >&2; exit 1
  fi
  dir="$DEST/$repo"
  if [ -d "$dir/.git" ]; then
    current="$(git -C "$dir" rev-parse HEAD 2>/dev/null || true)"
    if [ "$current" = "$sha" ]; then
      echo "ok      $repo @ ${sha:0:12} ($data) - ja no SHA"
      continue
    fi
  else
    git clone --quiet --no-checkout "$BASE_URL/$repo.git" "$dir"
  fi
  if ! git -C "$dir" cat-file -e "$sha^{commit}" 2>/dev/null; then
    git -C "$dir" fetch --quiet origin "$sha" 2>/dev/null || git -C "$dir" fetch --quiet --tags origin
  fi
  git -C "$dir" checkout --quiet --detach "$sha"
  current="$(git -C "$dir" rev-parse HEAD)"
  [ "$current" = "$sha" ] || { echo "falha: $repo em $current, esperado $sha" >&2; exit 1; }
  echo "fetched $repo @ ${sha:0:12} ($data)"
done < "$LOCK"
