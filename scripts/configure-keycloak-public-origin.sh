#!/usr/bin/env bash

set -Eeuo pipefail

PUBLIC_ORIGIN="${NOWLINE_PUBLIC_ORIGIN:-http://localhost:4189}"
KUBE_CONTEXT="${NOWLINE_KUBE_CONTEXT:-$(kubectl config current-context)}"
NAMESPACE="${NOWLINE_K8S_NAMESPACE:-nowline-local}"

if [[ ! "${PUBLIC_ORIGIN}" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] || [[ "${PUBLIC_ORIGIN}" == */ ]]; then
  printf 'NOWLINE_PUBLIC_ORIGIN must be an http(s) origin without a trailing slash.\n' >&2
  exit 64
fi

KEYCLOAK_POD="$(kubectl --context "${KUBE_CONTEXT}" --namespace "${NAMESPACE}" \
  get pods -l app.kubernetes.io/component=identity \
  --field-selector=status.phase=Running \
  --output=jsonpath='{.items[0].metadata.name}')"
if [[ -z "${KEYCLOAK_POD}" ]]; then
  printf 'No running Keycloak pod was found in %s/%s.\n' "${KUBE_CONTEXT}" "${NAMESPACE}" >&2
  exit 1
fi

ADMIN_PASSWORD="$(kubectl --context "${KUBE_CONTEXT}" --namespace "${NAMESPACE}" \
  get secret nowline-keycloak --output=jsonpath='{.data.admin-password}' | base64 --decode)"
if [[ -z "${ADMIN_PASSWORD}" ]]; then
  printf 'Keycloak admin password is empty.\n' >&2
  exit 1
fi

KCADM=(kubectl --context "${KUBE_CONTEXT}" --namespace "${NAMESPACE}" exec "${KEYCLOAK_POD}" -- \
  /opt/keycloak/bin/kcadm.sh)
CONFIG_FILE="/tmp/goalstotoday-kcadm.config"
cleanup() {
  "${KCADM[@]}" config credentials --config "${CONFIG_FILE}" --server http://127.0.0.1:8080/idp \
    --realm master --user admin --password invalid >/dev/null 2>&1 || true
  kubectl --context "${KUBE_CONTEXT}" --namespace "${NAMESPACE}" exec "${KEYCLOAK_POD}" -- \
    rm -f -- "${CONFIG_FILE}" >/dev/null 2>&1 || true
  ADMIN_PASSWORD=''
}
trap cleanup EXIT INT TERM

"${KCADM[@]}" config credentials --config "${CONFIG_FILE}" --server http://127.0.0.1:8080/idp \
  --realm master --user admin --password "${ADMIN_PASSWORD}" >/dev/null
"${KCADM[@]}" update realms/nowline --config "${CONFIG_FILE}" \
  -s 'displayName=Goals to Today' >/dev/null

WEB_CLIENT_ID="$("${KCADM[@]}" get clients --config "${CONFIG_FILE}" -r nowline -q clientId=nowline-web \
  --fields id --format csv --noquotes | sed -n '1p')"
API_CLIENT_ID="$("${KCADM[@]}" get clients --config "${CONFIG_FILE}" -r nowline -q clientId=nowline-api \
  --fields id --format csv --noquotes | sed -n '1p')"
if [[ -z "${WEB_CLIENT_ID}" || -z "${API_CLIENT_ID}" ]]; then
  printf 'Required Keycloak clients were not found.\n' >&2
  exit 1
fi

"${KCADM[@]}" update "clients/${API_CLIENT_ID}" --config "${CONFIG_FILE}" -r nowline \
  -s 'name=Goals to Today API' >/dev/null
"${KCADM[@]}" update "clients/${WEB_CLIENT_ID}" --config "${CONFIG_FILE}" -r nowline \
  -s 'name=Goals to Today Web and PWA' \
  -s "redirectUris=[\"${PUBLIC_ORIGIN}/*\",\"com.jieseob.planner://auth/callback\",\"com.jieseob.planner://auth/logout\"]" \
  -s "webOrigins=[\"${PUBLIC_ORIGIN}\"]" \
  -s "attributes.\"post.logout.redirect.uris\"=\"${PUBLIC_ORIGIN}/*##com.jieseob.planner://auth/logout\"" >/dev/null

printf 'Keycloak public origin configured: %s\n' "${PUBLIC_ORIGIN}"
