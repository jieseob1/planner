#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
KUSTOMIZE_DIR="${ROOT_DIR}/infra/k8s/overlays/local"
NAMESPACE="nowline-local"
WAIT_SECONDS="${NOWLINE_K8S_WAIT_SECONDS:-180}"
FRONTEND_IMAGE="nowline-frontend-beta:local"
BACKEND_IMAGE="nowline-backend:local"
KEYCLOAK_IMAGE="nowline-keycloak:local"
LOCAL_ENV_FILE="${ROOT_DIR}/.env.local-beta"
PUBLIC_ORIGIN="${NOWLINE_PUBLIC_ORIGIN:-http://localhost:4189}"

if [[ ! "${PUBLIC_ORIGIN}" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] || [[ "${PUBLIC_ORIGIN}" == */ ]]; then
  printf 'NOWLINE_PUBLIC_ORIGIN must be an http(s) origin without a trailing slash.\n' >&2
  exit 64
fi
OIDC_ISSUER="${PUBLIC_ORIGIN}/idp/realms/nowline"

if [[ ! "${WAIT_SECONDS}" =~ ^[1-9][0-9]{1,2}$ ]] || (( WAIT_SECONDS < 10 || WAIT_SECONDS > 900 )); then
  printf 'NOWLINE_K8S_WAIT_SECONDS must be an integer from 10 through 900.\n' >&2
  exit 64
fi
WAIT_TIMEOUT="${WAIT_SECONDS}s"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$1" >&2
    exit 1
  fi
}

require_kubectl() {
  require_command kubectl
  local requested_context
  requested_context="${NOWLINE_KUBE_CONTEXT:-}"

  if [[ -n "${requested_context}" ]]; then
    if ! kubectl config get-contexts "${requested_context}" --no-headers >/dev/null 2>&1; then
      printf 'Kubernetes context does not exist: %s\n' "${requested_context}" >&2
      exit 1
    fi
    KUBE_CONTEXT="${requested_context}"
  else
    KUBE_CONTEXT="$(kubectl config current-context)"
  fi

  if [[ -z "${KUBE_CONTEXT}" ]]; then
    printf 'No current Kubernetes context is configured.\n' >&2
    exit 1
  fi
}

kubectl_nowline() {
  kubectl --context "${KUBE_CONTEXT}" "$@"
}

show_metrics_server_notice() {
  local available
  available="$(kubectl_nowline get apiservice v1beta1.metrics.k8s.io \
    --output=jsonpath='{.status.conditions[?(@.type=="Available")].status}' 2>/dev/null || true)"
  if [[ "${available}" != "True" ]]; then
    printf '%s\n' 'NOTICE: Metrics Server is not available; the backend HPA cannot calculate utilization or scale.' >&2
  fi
}

load_kind_images() {
  if [[ "${KUBE_CONTEXT}" != kind-* ]]; then
    printf 'Built local images. Context %s is not kind; publish or load the images for that runtime before up.\n' "${KUBE_CONTEXT}"
    return
  fi

  local cluster_name="${KUBE_CONTEXT#kind-}"
  if command -v kind >/dev/null 2>&1; then
    kind load docker-image "${FRONTEND_IMAGE}" "${BACKEND_IMAGE}" "${KEYCLOAK_IMAGE}" --name "${cluster_name}"
    return
  fi

  # OrbStack can retain a healthy kind cluster even when the kind CLI is not
  # currently installed. Import the exact local images into every kind node's
  # containerd store so a repeatable local verification is still possible.
  local nodes node
  nodes="$(docker ps \
    --filter "label=io.x-k8s.kind.cluster=${cluster_name}" \
    --format '{{.Names}}')"
  if [[ -z "${nodes}" ]]; then
    printf 'kind CLI is unavailable and no Docker nodes were found for cluster %s.\n' "${cluster_name}" >&2
    exit 1
  fi
  while IFS= read -r node; do
    docker save "${FRONTEND_IMAGE}" "${BACKEND_IMAGE}" "${KEYCLOAK_IMAGE}" \
      | docker exec --interactive "${node}" ctr --namespace k8s.io images import - >/dev/null
  done <<<"${nodes}"
}

build_images() {
  require_command docker
  require_command npm
  require_kubectl
  "${ROOT_DIR}/scripts/prepare-local-beta-env.sh"
  (
    cd -- "${ROOT_DIR}"
    npm ci --no-audit --no-fund
    VITE_API_BASE_URL= \
    VITE_AUTH_MODE=oidc \
    VITE_OIDC_AUTHORITY="${OIDC_ISSUER}" \
    VITE_OIDC_CLIENT_ID=nowline-web \
    VITE_OIDC_SCOPE='openid profile email offline_access' \
    VITE_OIDC_WEB_REDIRECT_URI="${PUBLIC_ORIGIN}/auth/callback" \
    VITE_OIDC_WEB_POST_LOGOUT_REDIRECT_URI="${PUBLIC_ORIGIN}" \
    VITE_OIDC_SILENT_REDIRECT_URI="${PUBLIC_ORIGIN}/auth/silent-callback" \
      npm run build
  )
  (
    cd -- "${ROOT_DIR}"
    ./backend/mvnw --quiet --file backend/pom.xml package -DskipTests
  )
  docker build --tag "${FRONTEND_IMAGE}" --file "${ROOT_DIR}/Dockerfile.beta" "${ROOT_DIR}"
  docker build --tag "${BACKEND_IMAGE}" --file "${ROOT_DIR}/backend/Dockerfile" "${ROOT_DIR}/backend"
  docker build --tag "${KEYCLOAK_IMAGE}" --file "${ROOT_DIR}/infra/keycloak/Containerfile" "${ROOT_DIR}/infra/keycloak"
  load_kind_images
}

env_value() {
  local key="$1" value
  value="$(sed -n "s/^${key}=//p" "${LOCAL_ENV_FILE}" | head -n 1)"
  if [[ -z "${value}" || ! "${value}" =~ ^[A-Za-z0-9._-]+$ ]]; then
    printf '%s must be present in .env.local-beta and use URL-safe characters.\n' "${key}" >&2
    exit 1
  fi
  printf '%s' "${value}"
}

ensure_local_secrets() {
  "${ROOT_DIR}/scripts/prepare-local-beta-env.sh"
  kubectl_nowline apply --filename "${KUSTOMIZE_DIR}/namespace.yaml" >/dev/null
  # This Secret belonged to the removed shared development-token profile. It
  # must not remain as an accidental rollback path in a multi-user beta.
  kubectl_nowline --namespace "${NAMESPACE}" delete secret nowline-local-auth \
    --ignore-not-found >/dev/null
  local mysql_password mysql_root_password keycloak_db_password keycloak_admin_password
  keycloak_db_password="$(env_value NOWLINE_KEYCLOAK_DB_PASSWORD)"
  keycloak_admin_password="$(env_value NOWLINE_KEYCLOAK_ADMIN_PASSWORD)"
  if ! kubectl_nowline --namespace "${NAMESPACE}" get secret nowline-mysql >/dev/null 2>&1; then
    mysql_password="$(env_value NOWLINE_MYSQL_PASSWORD)"
    mysql_root_password="$(env_value NOWLINE_MYSQL_ROOT_PASSWORD)"
    kubectl_nowline --namespace "${NAMESPACE}" create secret generic nowline-mysql \
      --from-literal=database=nowline \
      --from-literal=username=nowline \
      --from-literal=password="${mysql_password}" \
      --from-literal=root-password="${mysql_root_password}" >/dev/null
  else
    printf '%s\n' 'Reusing the existing MySQL Secret so credentials remain compatible with the retained PVC.'
  fi
  if ! kubectl_nowline --namespace "${NAMESPACE}" get secret nowline-keycloak >/dev/null 2>&1; then
    kubectl_nowline --namespace "${NAMESPACE}" create secret generic nowline-keycloak \
      --from-literal=db-password="${keycloak_db_password}" \
      --from-literal=admin-password="${keycloak_admin_password}" >/dev/null
  else
    printf '%s\n' 'Reusing the existing Keycloak Secret.'
  fi
}

wait_for_rollouts() {
  kubectl_nowline --namespace "${NAMESPACE}" rollout status statefulset/nowline-mysql --timeout="${WAIT_TIMEOUT}"
  kubectl_nowline --namespace "${NAMESPACE}" rollout status deployment/nowline-keycloak --timeout="${WAIT_TIMEOUT}"
  kubectl_nowline --namespace "${NAMESPACE}" rollout status deployment/nowline-backend --timeout="${WAIT_TIMEOUT}"
  kubectl_nowline --namespace "${NAMESPACE}" rollout status deployment/nowline-frontend --timeout="${WAIT_TIMEOUT}"
}

up_stack() {
  build_images
  require_kubectl
  ensure_local_secrets
  kubectl_nowline apply --kustomize "${KUSTOMIZE_DIR}"
  kubectl_nowline --namespace "${NAMESPACE}" set env deployment/nowline-backend \
    NOWLINE_OIDC_ISSUER="${OIDC_ISSUER}" \
    NOWLINE_CORS_ALLOWED_ORIGIN_PATTERNS="${PUBLIC_ORIGIN}"
  kubectl_nowline --namespace "${NAMESPACE}" set env deployment/nowline-keycloak \
    KC_HOSTNAME="${PUBLIC_ORIGIN}/idp" \
    NOWLINE_PUBLIC_ORIGIN="${PUBLIC_ORIGIN}"
  # Local images intentionally use stable tags. Restart the consumers so an
  # image freshly loaded into kind is actually picked up on every `up`.
  kubectl_nowline --namespace "${NAMESPACE}" rollout restart \
    deployment/nowline-backend \
    deployment/nowline-keycloak \
    deployment/nowline-frontend
  wait_for_rollouts
  NOWLINE_PUBLIC_ORIGIN="${PUBLIC_ORIGIN}" \
    NOWLINE_KUBE_CONTEXT="${KUBE_CONTEXT}" \
    "${ROOT_DIR}/scripts/configure-keycloak-public-origin.sh"
  show_metrics_server_notice
}

cleanup_forwards() {
  local pid
  for pid in "${FRONTEND_FORWARD_PID:-}" "${BACKEND_FORWARD_PID:-}"; do
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      kill "${pid}" >/dev/null 2>&1 || true
      wait "${pid}" 2>/dev/null || true
    fi
  done
  if [[ -n "${FORWARD_DIR:-}" && -d "${FORWARD_DIR}" ]]; then
    rm -f -- "${FORWARD_DIR}/frontend.log" "${FORWARD_DIR}/backend.log"
    rmdir -- "${FORWARD_DIR}" 2>/dev/null || true
  fi
}

forwarded_port() {
  local pid="$1"
  local log_file="$2"
  local attempt port
  for attempt in {1..30}; do
    port="$(sed -nE 's/^Forwarding from 127\.0\.0\.1:([0-9]+) ->.*/\1/p' "${log_file}" | head -n 1)"
    if [[ -n "${port}" ]]; then
      printf '%s\n' "${port}"
      return 0
    fi
    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      printf 'kubectl port-forward exited early:\n' >&2
      sed -n '1,120p' "${log_file}" >&2
      return 1
    fi
    sleep 1
  done
  printf 'Timed out waiting for kubectl port-forward:\n' >&2
  sed -n '1,120p' "${log_file}" >&2
  return 1
}

verify_stack() {
  require_command curl
  require_kubectl
  wait_for_rollouts

  FORWARD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nowline-k8s.XXXXXX")"
  trap cleanup_forwards EXIT INT TERM

  kubectl_nowline --namespace "${NAMESPACE}" port-forward --address=127.0.0.1 service/nowline-frontend 4189:80 >"${FORWARD_DIR}/frontend.log" 2>&1 &
  FRONTEND_FORWARD_PID=$!
  kubectl_nowline --namespace "${NAMESPACE}" port-forward --address=127.0.0.1 service/nowline-backend :8080 >"${FORWARD_DIR}/backend.log" 2>&1 &
  BACKEND_FORWARD_PID=$!

  local frontend_port backend_port
  frontend_port="$(forwarded_port "${FRONTEND_FORWARD_PID}" "${FORWARD_DIR}/frontend.log")"
  backend_port="$(forwarded_port "${BACKEND_FORWARD_PID}" "${FORWARD_DIR}/backend.log")"

  curl --fail --silent --show-error --retry 5 --retry-delay 1 --retry-all-errors --max-time 5 \
    "http://127.0.0.1:${frontend_port}/healthz" >/dev/null
  local discovery
  discovery="$(curl --fail --silent --show-error --retry 5 --retry-delay 1 --retry-all-errors --max-time 5 \
    "http://localhost:${frontend_port}/idp/realms/nowline/.well-known/openid-configuration")"
  if [[ "${discovery}" != *"\"issuer\":\"${OIDC_ISSUER}\""* ]]; then
    printf 'OIDC discovery returned an unexpected issuer; expected %s.\n' "${OIDC_ISSUER}" >&2
    return 1
  fi
  curl --fail --silent --show-error --retry 5 --retry-delay 1 --retry-all-errors --max-time 5 \
    "http://127.0.0.1:${backend_port}/actuator/health/readiness" >/dev/null
  local unauthenticated_status dev_token_status
  unauthenticated_status="$(curl --silent --show-error --retry 5 --retry-delay 1 --retry-all-errors --max-time 5 \
    --output /dev/null --write-out '%{http_code}' \
    "http://127.0.0.1:${frontend_port}/api/v1/planner")"
  if [[ "${unauthenticated_status}" != "401" ]]; then
    printf 'Frontend /api proxy must reject an unauthenticated planner request with 401, got: %s\n' \
      "${unauthenticated_status}" >&2
    return 1
  fi
  dev_token_status="$(curl --silent --show-error --retry 5 --retry-delay 1 --retry-all-errors --max-time 5 \
    --output /dev/null --write-out '%{http_code}' \
    "http://127.0.0.1:${frontend_port}/api/v1/auth/dev-token")"
  if [[ "${dev_token_status}" != "401" && "${dev_token_status}" != "404" ]]; then
    printf 'Local beta must not return a development token, got: %s\n' "${dev_token_status}" >&2
    return 1
  fi

  show_metrics_server_notice
  printf '%s\n' 'local Kubernetes configuration verified'
}

down_stack() {
  require_kubectl
  kubectl_nowline --namespace "${NAMESPACE}" delete \
    horizontalpodautoscaler/nowline-backend \
    poddisruptionbudget/nowline-backend \
    deployment/nowline-frontend \
    deployment/nowline-backend \
    deployment/nowline-keycloak \
    statefulset/nowline-mysql \
    service/nowline-frontend \
    service/nowline-backend \
    service/nowline-keycloak \
    service/nowline-mysql \
    secret/nowline-mysql \
    secret/nowline-keycloak \
    secret/nowline-local-auth \
    configmap/nowline-keycloak-realm \
    configmap/nowline-keycloak-bootstrap \
    --ignore-not-found \
    --wait=true \
    --timeout="${WAIT_TIMEOUT}"
  printf '%s\n' 'Nowline workloads removed; namespace and MySQL PVC retained.'
}

usage() {
  printf 'Usage: %s {build|up|verify|down}\n' "$0" >&2
}

case "${1:-}" in
  build)
    build_images
    ;;
  up)
    up_stack
    ;;
  verify)
    verify_stack
    ;;
  down)
    down_stack
    ;;
  *)
    usage
    exit 64
    ;;
esac
