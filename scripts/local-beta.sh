#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.local-beta"
PROJECT_NAME="${NOWLINE_BETA_PROJECT_NAME:-nowline-beta}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Required command not found: %s\n' "$1" >&2
    exit 1
  }
}

prepare() {
  require_command openssl
  "${SCRIPT_DIR}/prepare-local-beta-env.sh"
}

compose() {
  docker compose \
    --project-name "${PROJECT_NAME}" \
    --env-file "${ENV_FILE}" \
    --file "${ROOT_DIR}/compose.yaml" \
    --file "${ROOT_DIR}/compose.beta.yaml" \
    "$@"
}

env_value() {
  local key="$1" value
  value="$(sed -n "s/^${key}=//p" "${ENV_FILE}" | head -n 1)"
  if [[ -z "${value}" || "${value}" == *[[:space:]]* ]]; then
    printf '%s must be present in .env.local-beta and must not contain whitespace.\n' "${key}" >&2
    exit 1
  fi
  printf '%s' "${value}"
}

build_frontend() {
  local public_origin
  public_origin="$(env_value NOWLINE_PUBLIC_ORIGIN)"
  (
    cd -- "${ROOT_DIR}"
    npm ci --no-audit --no-fund
    VITE_API_BASE_URL= \
    VITE_AUTH_MODE=oidc \
    VITE_OIDC_AUTHORITY="${public_origin}/idp/realms/nowline" \
    VITE_OIDC_CLIENT_ID=nowline-web \
    VITE_OIDC_SCOPE='openid profile email offline_access' \
    VITE_OIDC_WEB_REDIRECT_URI="${public_origin}/auth/callback" \
    VITE_OIDC_WEB_POST_LOGOUT_REDIRECT_URI="${public_origin}" \
    VITE_OIDC_SILENT_REDIRECT_URI="${public_origin}/auth/silent-callback" \
      npm run build
  )
}

up() {
  prepare
  require_command docker
  require_command npm
  build_frontend
  (
    cd -- "${ROOT_DIR}/backend"
    ./mvnw --quiet package -DskipTests
  )
  compose up --detach --build --wait --wait-timeout 300
  printf '%s\n' 'Local beta is running at http://localhost:8088'
  printf '%s\n' 'Keycloak admin is available only on this machine at http://localhost:9090/idp/admin/'
}

case "${1:-}" in
  prepare)
    prepare
    ;;
  config)
    prepare
    compose config
    ;;
  up)
    up
    ;;
  verify)
    up
    node "${SCRIPT_DIR}/verify-local-beta-runtime.mjs"
    ;;
  status)
    prepare
    compose ps
    ;;
  logs)
    prepare
    compose logs --follow mysql keycloak backend frontend
    ;;
  down)
    prepare
    compose down --remove-orphans
    printf '%s\n' 'Local beta stopped; MySQL data volume was retained.'
    ;;
  *)
    printf 'Usage: %s {prepare|config|up|verify|status|logs|down}\n' "$0" >&2
    exit 64
    ;;
esac
