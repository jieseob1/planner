#!/usr/bin/env bash

set -Eeuo pipefail

TUNNEL_ID="${GOALS_TO_TODAY_TUNNEL_ID:-}"
if [[ ! "${TUNNEL_ID}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  printf 'GOALS_TO_TODAY_TUNNEL_ID must be a Cloudflare tunnel UUID.\n' >&2
  exit 64
fi

CLOUDFLARED="${GOALS_TO_TODAY_CLOUDFLARED_BIN:-/opt/homebrew/bin/cloudflared}"
CREDENTIALS_FILE="${HOME}/.cloudflared/${TUNNEL_ID}.json"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/../ops/cloudflared/goalstotoday.yml"
if [[ ! -x "${CLOUDFLARED}" || ! -r "${CREDENTIALS_FILE}" || ! -r "${CONFIG_FILE}" ]]; then
  printf 'cloudflared, tunnel credentials, or the dedicated ingress config is unavailable.\n' >&2
  exit 1
fi

exec "${CLOUDFLARED}" tunnel \
  --config "${CONFIG_FILE}" \
  --credentials-file "${CREDENTIALS_FILE}" \
  run "${TUNNEL_ID}"
