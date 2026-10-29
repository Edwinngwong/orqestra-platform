#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
sandbox=${ORQESTRA_SANDBOX_DIR:-"$(dirname "$root")/orqestra-sandbox"}
state="$root/.local"
pids="$state/pids"
logs="$state/logs"
executor_image=${EXECUTOR_IMAGE:-node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293}

require() { command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }; }
require docker
require node
require npm
require cloudflared
require curl

[ -f "$root/.env.local" ] || { echo "Missing $root/.env.local; run scripts/bootstrap-local.sh first" >&2; exit 1; }
[ -d "$sandbox" ] || { echo "Sandbox repository not found at $sandbox" >&2; exit 1; }

set -a
# shellcheck disable=SC1091
. "$root/.env.local"
set +a

for key in GITHUB_WEBHOOK_SECRET OPERATOR_TOKEN SANDBOX_TOKEN SANDBOX_WORKER_TOKEN RESULT_SIGNING_SECRET GITHUB_APP_ID GITHUB_APP_PRIVATE_KEY_PATH OPENAI_API_KEY OPENAI_MODEL DATABASE_URL; do
  eval "value=\${$key:-}"
  [ -n "$value" ] || { echo "$key is missing in .env.local" >&2; exit 1; }
done

mkdir -p "$pids" "$logs"
chmod 700 "$state" "$pids" "$logs"
rm -f "$state/stop-requested"

alive() { [ -f "$pids/$1.pid" ] && kill -0 "$(cat "$pids/$1.pid")" 2>/dev/null; }
start() {
  name=$1
  directory=$2
  shift 2
  if alive "$name"; then echo "$name already running"; return; fi
  rm -f "$pids/$name.pid"
  : >"$logs/$name.log"
  (
    cd "$directory"
    nohup "$@" >>"$logs/$name.log" 2>&1 &
    echo $! >"$pids/$name.pid"
  )
  sleep 1
  alive "$name" || { echo "$name failed to start; see $logs/$name.log" >&2; exit 1; }
  echo "Started $name"
}

[ -x "$root/node_modules/.bin/tsx" ] || (cd "$root" && npm install)
[ -x "$sandbox/node_modules/.bin/tsx" ] || (cd "$sandbox" && npm install)

cd "$root"
docker compose up -d postgres
npm run db:migrate

start sandbox-api "$sandbox" env PORT=8787 "$sandbox/node_modules/.bin/tsx" src/server.ts
start sandbox-worker "$sandbox" env EXECUTOR_IMAGE="$executor_image" "$sandbox/node_modules/.bin/tsx" src/worker.ts
start platform-api "$root" "$root/node_modules/.bin/tsx" src/server.ts
start platform-worker "$root" "$root/node_modules/.bin/tsx" src/worker-main.ts

for attempt in 1 2 3 4 5 6 7 8 9 10; do
  curl -fsS http://127.0.0.1:${PORT:-8786}/ >/dev/null 2>&1 && break
  [ "$attempt" -lt 10 ] || { echo "Platform API did not become ready" >&2; exit 1; }
  sleep 1
done

start tunnel "$root" cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:${PORT:-8786}"
tunnel_url=
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  tunnel_url=$(grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' "$logs/tunnel.log" | tail -1 || true)
  [ -n "$tunnel_url" ] && break
  sleep 1
done
[ -n "$tunnel_url" ] || { echo "Tunnel URL was not created; see $logs/tunnel.log" >&2; exit 1; }

webhook_url="$tunnel_url/webhooks/github"
"$root/node_modules/.bin/tsx" "$root/scripts/configure-github-webhook.ts" "$webhook_url"
printf '%s\n' "$tunnel_url" >"$state/tunnel-url"

echo
echo "Orqestra is ready"
echo "Operator console: http://127.0.0.1:${PORT:-8786}/"
echo "GitHub webhook:  $webhook_url"
echo "Logs:            $logs"
echo "Press Ctrl+C to stop Orqestra and preserve PostgreSQL data."

shutdown() {
  trap - INT TERM
  "$root/scripts/local-down.sh"
  exit 0
}
trap shutdown INT TERM

while :; do
  [ ! -f "$state/stop-requested" ] || exit 0
  for service in sandbox-api sandbox-worker platform-api platform-worker tunnel; do
    if ! alive "$service"; then
      echo "$service stopped unexpectedly; see $logs/$service.log" >&2
      "$root/scripts/local-down.sh"
      exit 1
    fi
  done
  sleep 5
done
