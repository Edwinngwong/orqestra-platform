#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
pids="$root/.local/pids"

for name in platform-api platform-worker sandbox-api sandbox-worker tunnel; do
  file="$pids/$name.pid"
  if [ -f "$file" ] && kill -0 "$(cat "$file")" 2>/dev/null; then
    echo "$name: running (pid $(cat "$file"))"
  else
    echo "$name: stopped"
  fi
done

if [ -f "$root/.local/tunnel-url" ]; then
  echo "public URL: $(cat "$root/.local/tunnel-url")"
fi

if curl -fsS http://127.0.0.1:8786/ >/dev/null 2>&1; then
  echo "platform health: ready"
else
  echo "platform health: unavailable"
fi
