#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
pids="$root/.local/pids"
mkdir -p "$pids"
: >"$root/.local/stop-requested"

stop() {
  name=$1
  file="$pids/$name.pid"
  [ -f "$file" ] || return 0
  pid=$(cat "$file")
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    count=0
    while kill -0 "$pid" 2>/dev/null && [ "$count" -lt 20 ]; do sleep 0.25; count=$((count + 1)); done
    echo "Stopped $name"
  fi
  rm -f "$file"
}

stop tunnel
stop platform-worker
stop platform-api
stop sandbox-worker
stop sandbox-api
(cd "$root" && docker compose stop postgres)
rm -f "$root/.local/tunnel-url"
echo "Orqestra stopped; PostgreSQL data was preserved."
