#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.local-beta"
PROJECT_NAME="${NOWLINE_BETA_PROJECT_NAME:-nowline-beta}"
BACKUP_DIR="${NOWLINE_BACKUP_DIR:-${ROOT_DIR}/.local-backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FINAL_FILE="${BACKUP_DIR}/nowline-${TIMESTAMP}.sql.gz"

"${SCRIPT_DIR}/prepare-local-beta-env.sh" >/dev/null
mkdir -p -- "${BACKUP_DIR}"
TEMP_SQL="$(mktemp "${BACKUP_DIR}/.nowline-backup.XXXXXX.sql")"
trap 'rm -f -- "${TEMP_SQL}"' EXIT INT TERM

compose() {
  docker compose \
    --project-name "${PROJECT_NAME}" \
    --env-file "${ENV_FILE}" \
    --file "${ROOT_DIR}/compose.yaml" \
    --file "${ROOT_DIR}/compose.beta.yaml" \
    "$@"
}

if ! compose ps --status running mysql | grep -q mysql; then
  echo 'The local beta MySQL service is not running. Run scripts/local-beta.sh up first.' >&2
  exit 1
fi

compose exec -T mysql sh -ec '
  exec mysqldump \
    --user=root \
    --password="$MYSQL_ROOT_PASSWORD" \
    --single-transaction \
    --quick \
    --routines \
    --triggers \
    --events \
    --hex-blob \
    --set-gtid-purged=OFF \
    "$MYSQL_DATABASE"
' >"${TEMP_SQL}"

gzip -9c "${TEMP_SQL}" >"${FINAL_FILE}"
gzip -t "${FINAL_FILE}"

if command -v shasum >/dev/null 2>&1; then
  CHECKSUM="$(shasum -a 256 "${FINAL_FILE}" | awk '{print $1}')"
else
  CHECKSUM="$(sha256sum "${FINAL_FILE}" | awk '{print $1}')"
fi

if [[ -n "${NOWLINE_BACKUP_S3_URI:-}" ]]; then
  command -v aws >/dev/null 2>&1 || {
    echo 'aws CLI is required when NOWLINE_BACKUP_S3_URI is set.' >&2
    exit 1
  }
  aws s3 cp \
    "${FINAL_FILE}" \
    "${NOWLINE_BACKUP_S3_URI%/}/$(basename "${FINAL_FILE}")" \
    --storage-class "${NOWLINE_BACKUP_STORAGE_CLASS:-DEEP_ARCHIVE}" \
    --only-show-errors
fi

printf 'backup_path=%s\n' "${FINAL_FILE}"
printf 'sha256=%s\n' "${CHECKSUM}"
printf '%s\n' 'local beta backup completed'
