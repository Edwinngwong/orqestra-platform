#!/bin/sh
set -eu
umask 077
target="${1:-.env.local}"
if [ -e "$target" ]; then
  echo "$target already exists; refusing to overwrite" >&2
  exit 1
fi
secret() { openssl rand -hex 32; }
cat > "$target" <<EOF
PORT=8786
DATABASE_URL=postgres://orqestra:orqestra@127.0.0.1:5432/orqestra
GITHUB_WEBHOOK_SECRET=$(secret)
OPERATOR_TOKEN=$(secret)
SANDBOX_URL=http://127.0.0.1:8787
SANDBOX_TOKEN=$(secret)
SANDBOX_WORKER_TOKEN=$(secret)
RESULT_SIGNING_SECRET=$(secret)
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY_PATH=
OPENAI_API_KEY=
OPENAI_MODEL=
WORKER_ID=local-worker-1
EOF
chmod 600 "$target"
echo "Created $target with local secrets. Add the provider values without committing this file."
