#!/bin/sh
set -eu
umask 077
target="${1:-.env.local}"
[ -f "$target" ] || { echo "$target does not exist; run scripts/bootstrap-local.sh first" >&2; exit 1; }
temporary=
cleanup() { stty echo 2>/dev/null || true; [ -z "$temporary" ] || rm -f "$temporary"; }
trap cleanup EXIT INT TERM

read_secret() {
  prompt=$1
  printf '%s' "$prompt" >&2
  stty -echo
  IFS= read -r secret_value
  stty echo
  printf '\n' >&2
  printf '%s' "$secret_value"
}

printf 'Meta Phone Number ID: ' >&2
IFS= read -r phone_number_id
app_secret=$(read_secret 'Meta App Secret (hidden): ')
access_token=$(read_secret 'Meta access token (hidden): ')
verify_token=$(openssl rand -hex 32)

case "$phone_number_id" in *[!0-9]*|'') echo "Phone Number ID must contain only digits" >&2; exit 1;; esac
[ -n "$app_secret" ] && [ -n "$access_token" ] || { echo "App secret and access token are required" >&2; exit 1; }

temporary=$(mktemp "${TMPDIR:-/tmp}/orqestra-whatsapp.XXXXXX")
grep -Ev '^(WHATSAPP_APP_SECRET|WHATSAPP_VERIFY_TOKEN|WHATSAPP_ACCESS_TOKEN|WHATSAPP_PHONE_NUMBER_ID|WHATSAPP_GRAPH_VERSION)=' "$target" > "$temporary"
{
  printf 'WHATSAPP_APP_SECRET=%s\n' "$app_secret"
  printf 'WHATSAPP_VERIFY_TOKEN=%s\n' "$verify_token"
  printf 'WHATSAPP_ACCESS_TOKEN=%s\n' "$access_token"
  printf 'WHATSAPP_PHONE_NUMBER_ID=%s\n' "$phone_number_id"
  printf 'WHATSAPP_GRAPH_VERSION=v25.0\n'
} >> "$temporary"
mv "$temporary" "$target"
chmod 600 "$target"
trap - EXIT INT TERM
echo "WhatsApp credentials saved locally. The verify token is in $target; do not paste it into chat or commit it."
