#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
STATE_DIR="${ROOT_DIR}/.local-beta"
PID_FILE="${STATE_DIR}/k8s-frontend-forward.pid"
LOG_FILE="${STATE_DIR}/k8s-frontend-forward.log"
NAMESPACE="nowline-local"
PORT="${NOWLINE_K8S_FRONTEND_PORT:-4189}"
BIND_ADDRESS="${NOWLINE_K8S_BIND_ADDRESS:-127.0.0.1}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Required command not found: %s\n' "$1" >&2
    exit 1
  }
}

kube_context() {
  if [[ -n "${NOWLINE_KUBE_CONTEXT:-}" ]]; then
    printf '%s' "${NOWLINE_KUBE_CONTEXT}"
  else
    kubectl config current-context
  fi
}

recorded_pid() {
  [[ -f "${PID_FILE}" ]] || return 1
  local pid
  pid="$(sed -n '1p' "${PID_FILE}")"
  [[ "${pid}" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s' "${pid}"
}

is_running() {
  local pid command
  pid="$(recorded_pid)" || return 1
  kill -0 "${pid}" >/dev/null 2>&1 || return 1
  command="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
  [[ "${command}" == *"kubectl"*"port-forward"*"nowline-frontend"* ]]
}

wait_until_ready() {
  local attempt
  for attempt in {1..30}; do
    if curl --fail --silent --max-time 2 "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
      return 0
    fi
    if ! is_running; then
      printf '%s\n' 'Kubernetes frontend port-forward stopped before becoming ready.' >&2
      sed -n '1,120p' "${LOG_FILE}" >&2 || true
      return 1
    fi
    sleep 1
  done
  printf 'Timed out waiting for http://127.0.0.1:%s/healthz\n' "${PORT}" >&2
  return 1
}

start() {
  require_command kubectl
  require_command curl
  mkdir -p -- "${STATE_DIR}"
  if is_running; then
    printf 'Local Kubernetes beta server is already running at http://localhost:%s\n' "${PORT}"
    return
  fi
  rm -f -- "${PID_FILE}"
  local context
  context="$(kube_context)"
  nohup kubectl --context "${context}" --namespace "${NAMESPACE}" \
    port-forward --address="${BIND_ADDRESS}" service/nowline-frontend "${PORT}:80" \
    >"${LOG_FILE}" 2>&1 </dev/null &
  printf '%s\n' "$!" >"${PID_FILE}"
  wait_until_ready
  printf 'Local Kubernetes beta server is running at http://localhost:%s\n' "${PORT}"
}

stop() {
  local pid
  if ! is_running; then
    rm -f -- "${PID_FILE}"
    printf '%s\n' 'Local Kubernetes beta server is not running.'
    return
  fi
  pid="$(recorded_pid)"
  kill "${pid}"
  for _ in {1..20}; do
    kill -0 "${pid}" >/dev/null 2>&1 || break
    sleep 0.25
  done
  rm -f -- "${PID_FILE}"
  printf '%s\n' 'Local Kubernetes beta server stopped.'
}

status() {
  if is_running; then
    printf 'Local Kubernetes beta server is running at http://localhost:%s (PID %s).\n' "${PORT}" "$(recorded_pid)"
  else
    printf '%s\n' 'Local Kubernetes beta server is not running.'
    exit 1
  fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) printf 'Usage: %s {start|stop|status}\n' "$0" >&2; exit 64 ;;
esac
