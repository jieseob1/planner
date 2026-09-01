#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
PUBLIC_ORIGIN="${NOWLINE_PUBLIC_ORIGIN:-}"
OLD_ISSUER="${NOWLINE_OLD_OIDC_ISSUER:-http://localhost:4189/idp/realms/nowline}"
KUBE_CONTEXT="${NOWLINE_KUBE_CONTEXT:-$(kubectl config current-context)}"
NAMESPACE="${NOWLINE_K8S_NAMESPACE:-nowline-local}"

if [[ ! "${PUBLIC_ORIGIN}" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] || [[ "${PUBLIC_ORIGIN}" == */ ]]; then
  printf 'NOWLINE_PUBLIC_ORIGIN must be an http(s) origin without a trailing slash.\n' >&2
  exit 64
fi
if [[ ! "${OLD_ISSUER}" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?/idp/realms/nowline$ ]]; then
  printf 'NOWLINE_OLD_OIDC_ISSUER is invalid.\n' >&2
  exit 64
fi
NEW_ISSUER="${PUBLIC_ORIGIN}/idp/realms/nowline"
if [[ "${OLD_ISSUER}" == "${NEW_ISSUER}" ]]; then
  printf 'OIDC issuer is already the requested value.\n'
  exit 0
fi

MYSQL_POD="$(kubectl --context "${KUBE_CONTEXT}" --namespace "${NAMESPACE}" \
  get pods -l app.kubernetes.io/component=database \
  --field-selector=status.phase=Running \
  --output=jsonpath='{.items[0].metadata.name}')"
if [[ -z "${MYSQL_POD}" ]]; then
  printf 'No running MySQL pod was found.\n' >&2
  exit 1
fi

MYSQL_PASSWORD="$(kubectl --context "${KUBE_CONTEXT}" --namespace "${NAMESPACE}" \
  get secret nowline-mysql --output=jsonpath='{.data.password}' | base64 --decode)"
BACKUP_DIR="${ROOT_DIR}/.local-backups"
BACKUP_FILE="${BACKUP_DIR}/goalstotoday-issuer-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
mkdir -p -- "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"
kubectl --context "${KUBE_CONTEXT}" --namespace "${NAMESPACE}" exec "${MYSQL_POD}" -- \
  env MYSQL_PWD="${MYSQL_PASSWORD}" mysqldump --single-transaction --quick --skip-lock-tables --no-tablespaces \
  --user=nowline nowline | gzip -9 >"${BACKUP_FILE}"
chmod 600 "${BACKUP_FILE}"
if [[ ! -s "${BACKUP_FILE}" ]]; then
  printf 'MySQL backup is empty; refusing issuer migration.\n' >&2
  exit 1
fi
if ! gzip -t "${BACKUP_FILE}"; then
  printf 'MySQL backup gzip verification failed; refusing issuer migration.\n' >&2
  exit 1
fi
BACKUP_SHA256="$(shasum -a 256 "${BACKUP_FILE}" | awk '{print $1}')"

mysql_query() {
  kubectl --context "${KUBE_CONTEXT}" --namespace "${NAMESPACE}" exec "${MYSQL_POD}" -- \
    env MYSQL_PWD="${MYSQL_PASSWORD}" mysql --batch --skip-column-names --user=nowline nowline --execute "$1"
}

CONFLICTS="$(mysql_query "SELECT COUNT(*) FROM app_user old_user JOIN app_user new_user ON new_user.oidc_subject = old_user.oidc_subject AND new_user.oidc_issuer = '${NEW_ISSUER}' WHERE old_user.oidc_issuer = '${OLD_ISSUER}';")"
if [[ "${CONFLICTS}" != "0" ]]; then
  printf 'Issuer migration found %s conflicting subject(s); backup kept at %s.\n' "${CONFLICTS}" "${BACKUP_FILE}" >&2
  exit 1
fi

OLD_COUNT="$(mysql_query "SELECT COUNT(*) FROM app_user WHERE oidc_issuer = '${OLD_ISSUER}';")"
if [[ "${OLD_COUNT}" == "0" ]]; then
  printf 'No user rows require issuer migration. Backup: %s (sha256 %s)\n' "${BACKUP_FILE}" "${BACKUP_SHA256}"
  exit 0
fi

BACKEND_REPLICAS="$(kubectl --context "${KUBE_CONTEXT}" --namespace "${NAMESPACE}" \
  get deployment nowline-backend --output=jsonpath='{.spec.replicas}')"
restore_backend() {
  if [[ -n "${BACKEND_REPLICAS:-}" ]]; then
    kubectl --context "${KUBE_CONTEXT}" --namespace "${NAMESPACE}" scale deployment/nowline-backend \
      --replicas="${BACKEND_REPLICAS}" >/dev/null 2>&1 || true
  fi
  MYSQL_PASSWORD=''
}
trap restore_backend EXIT INT TERM
kubectl --context "${KUBE_CONTEXT}" --namespace "${NAMESPACE}" scale deployment/nowline-backend --replicas=0 >/dev/null
kubectl --context "${KUBE_CONTEXT}" --namespace "${NAMESPACE}" rollout status deployment/nowline-backend --timeout=120s >/dev/null

mysql_query "START TRANSACTION; UPDATE app_user SET oidc_issuer = '${NEW_ISSUER}' WHERE oidc_issuer = '${OLD_ISSUER}'; COMMIT;" >/dev/null
REMAINING="$(mysql_query "SELECT COUNT(*) FROM app_user WHERE oidc_issuer = '${OLD_ISSUER}';")"
MIGRATED="$(mysql_query "SELECT COUNT(*) FROM app_user WHERE oidc_issuer = '${NEW_ISSUER}';")"
if [[ "${REMAINING}" != "0" || "${MIGRATED}" -lt "${OLD_COUNT}" ]]; then
  printf 'Issuer migration verification failed; backup kept at %s.\n' "${BACKUP_FILE}" >&2
  exit 1
fi

printf 'Migrated %s user issuer row(s). Backup: %s (sha256 %s)\n' "${OLD_COUNT}" "${BACKUP_FILE}" "${BACKUP_SHA256}"
