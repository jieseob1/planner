#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
KUSTOMIZE_DIR="${ROOT_DIR}/infra/k8s/overlays/local"
NAMESPACE="nowline-local"
WAIT_SECONDS="${NOWLINE_K8S_WAIT_SECONDS:-180}"
FRONTEND_IMAGE="nowline-frontend:local"
BACKEND_IMAGE="nowline-backend:local"

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

  require_command kind
  local cluster_name="${KUBE_CONTEXT#kind-}"
  kind load docker-image "${FRONTEND_IMAGE}" "${BACKEND_IMAGE}" --name "${cluster_name}"
}

build_images() {
  require_command docker
  require_command npm
  require_kubectl
  (
    cd -- "${ROOT_DIR}"
    VITE_API_BASE_URL= npm run build
    ./backend/mvnw --quiet --file backend/pom.xml package -DskipTests
  )
  docker build --tag "${FRONTEND_IMAGE}" --file "${ROOT_DIR}/Dockerfile" "${ROOT_DIR}"
  docker build --tag "${BACKEND_IMAGE}" --file "${ROOT_DIR}/backend/Dockerfile" "${ROOT_DIR}/backend"
  load_kind_images
}

wait_for_rollouts() {
  kubectl_nowline --namespace "${NAMESPACE}" rollout status statefulset/nowline-postgres --timeout="${WAIT_TIMEOUT}"
  kubectl_nowline --namespace "${NAMESPACE}" rollout status deployment/nowline-backend --timeout="${WAIT_TIMEOUT}"
  kubectl_nowline --namespace "${NAMESPACE}" rollout status deployment/nowline-frontend --timeout="${WAIT_TIMEOUT}"
}

up_stack() {
  build_images
  require_kubectl
  kubectl_nowline apply --kustomize "${KUSTOMIZE_DIR}"
  # Local images intentionally use stable tags. Restart the consumers so an
  # image freshly loaded into kind is actually picked up on every `up`.
  kubectl_nowline --namespace "${NAMESPACE}" rollout restart \
    deployment/nowline-backend \
    deployment/nowline-frontend
  wait_for_rollouts
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

  kubectl_nowline --namespace "${NAMESPACE}" port-forward --address=127.0.0.1 service/nowline-frontend :80 >"${FORWARD_DIR}/frontend.log" 2>&1 &
  FRONTEND_FORWARD_PID=$!
  kubectl_nowline --namespace "${NAMESPACE}" port-forward --address=127.0.0.1 service/nowline-backend :8080 >"${FORWARD_DIR}/backend.log" 2>&1 &
  BACKEND_FORWARD_PID=$!

  local frontend_port backend_port
  frontend_port="$(forwarded_port "${FRONTEND_FORWARD_PID}" "${FORWARD_DIR}/frontend.log")"
  backend_port="$(forwarded_port "${BACKEND_FORWARD_PID}" "${FORWARD_DIR}/backend.log")"

  curl --fail --silent --show-error --retry 5 --retry-delay 1 --retry-all-errors --max-time 5 \
    "http://127.0.0.1:${frontend_port}/healthz" >/dev/null
  curl --fail --silent --show-error --retry 5 --retry-delay 1 --retry-all-errors --max-time 5 \
    "http://127.0.0.1:${backend_port}/actuator/health/readiness" >/dev/null
  local proxy_status
  proxy_status="$(curl --silent --show-error --retry 5 --retry-delay 1 --retry-all-errors --max-time 5 \
    --output /dev/null --write-out '%{http_code}' \
    --header 'X-Nowline-User-Id: 00000000-0000-4000-8000-000000000001' \
    "http://127.0.0.1:${frontend_port}/api/v1/planner")"
  if [[ "${proxy_status}" != "404" && "${proxy_status}" != "200" ]]; then
    printf 'Frontend /api proxy returned unexpected HTTP status: %s\n' "${proxy_status}" >&2
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
    statefulset/nowline-postgres \
    service/nowline-frontend \
    service/nowline-backend \
    service/nowline-postgres \
    secret/nowline-postgres \
    --ignore-not-found \
    --wait=true \
    --timeout="${WAIT_TIMEOUT}"
  printf '%s\n' 'Nowline workloads removed; namespace and PostgreSQL PVC retained.'
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
