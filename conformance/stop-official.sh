#!/usr/bin/env bash
# Para as APIs oficiais iniciadas por setup-official.sh.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for n in regime-regular simples; do
  f="$HERE/work/$n.pid"
  if [ -f "$f" ]; then
    pid="$(cat "$f")"
    kill "$pid" 2>/dev/null && echo "parado $n ($pid)" || echo "$n já parado"
    rm -f "$f"
  fi
done
