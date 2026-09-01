#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
ENV_FILE="${ROOT_DIR}/.env.local-beta"

random_secret() {
  openssl rand -hex 32
}

require_key() {
  if ! grep -q "^$1=" "${ENV_FILE}"; then
    echo "${ENV_FILE} is missing required key: $1" >&2
    exit 1
  fi
}

if [ -f "${ENV_FILE}" ]; then
  for key in \
    NOWLINE_PUBLIC_ORIGIN \
    NOWLINE_MYSQL_PASSWORD \
    NOWLINE_MYSQL_ROOT_PASSWORD \
    NOWLINE_KEYCLOAK_DB_PASSWORD \
    NOWLINE_KEYCLOAK_ADMIN_PASSWORD
  do
    require_key "${key}"
  done
  echo 'Local beta environment already exists.'
  exit 0
fi

command -v openssl >/dev/null 2>&1 || {
  echo 'openssl is required to generate local beta secrets.' >&2
  exit 1
}

umask 077
TEMP_FILE=$(mktemp "${ROOT_DIR}/.env.local-beta.XXXXXX")
trap 'rm -f -- "${TEMP_FILE}"' EXIT INT TERM

cat >"${TEMP_FILE}" <<EOF
NOWLINE_PUBLIC_ORIGIN=http://localhost:8088
NOWLINE_ADMIN_ORIGIN=http://localhost:9090
NOWLINE_FRONTEND_PORT=8088
NOWLINE_BACKEND_PORT=18080
NOWLINE_KEYCLOAK_ADMIN_PORT=9090
NOWLINE_MYSQL_DB=nowline
NOWLINE_MYSQL_USER=nowline
NOWLINE_MYSQL_PASSWORD=$(random_secret)
NOWLINE_MYSQL_ROOT_PASSWORD=$(random_secret)
NOWLINE_KEYCLOAK_DB_PASSWORD=$(random_secret)
NOWLINE_KEYCLOAK_ADMIN_USERNAME=admin
NOWLINE_KEYCLOAK_ADMIN_PASSWORD=$(random_secret)
NOWLINE_MYSQL_VOLUME=nowline-beta-mysql-data
EOF

mv "${TEMP_FILE}" "${ENV_FILE}"
trap - EXIT INT TERM
echo 'Created .env.local-beta with owner-only permissions.'
