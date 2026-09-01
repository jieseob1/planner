#!/usr/bin/env bash

set -Eeuo pipefail

export PATH="/opt/homebrew/opt/openjdk@25/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

CONTEXT="${NOWLINE_KUBE_CONTEXT:-kind-nowline-local}"
NAMESPACE="${NOWLINE_KUBE_NAMESPACE:-nowline-local}"
PORT="${NOWLINE_K8S_FRONTEND_PORT:-4189}"
MAX_ATTEMPTS="${NOWLINE_STARTUP_ATTEMPTS:-120}"

for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1)); do
  if kubectl --context "${CONTEXT}" --namespace "${NAMESPACE}" \
    get service nowline-frontend >/dev/null 2>&1; then
    exec kubectl --context "${CONTEXT}" --namespace "${NAMESPACE}" \
      port-forward --address=127.0.0.1 service/nowline-frontend "${PORT}:80"
  fi
  sleep 5
done

printf 'Nowline Kubernetes service was not ready after %s attempts.\n' "${MAX_ATTEMPTS}" >&2
exit 1
