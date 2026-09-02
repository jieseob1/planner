#!/usr/bin/env bash

set -Eeuo pipefail

export PATH="/opt/homebrew/opt/openjdk@25/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${HOME}/.local/state"
PID_FILE="${STATE_DIR}/nowline-headless-supervisor.pid"
TUNNEL_ID="${GOALS_TO_TODAY_TUNNEL_ID:-922b16b2-307d-45e4-acff-cf864353ba38}"
LOCAL_PID=""
TUNNEL_PID=""

mkdir -p "${STATE_DIR}"
if [[ -r "${PID_FILE}" ]]; then
  EXISTING_PID="$(cat "${PID_FILE}")"
  if [[ "${EXISTING_PID}" =~ ^[0-9]+$ ]] \
    && kill -0 "${EXISTING_PID}" 2>/dev/null \
    && ps -p "${EXISTING_PID}" -o command= | grep -Fq 'mac-mini-headless-supervisor.sh'; then
    exit 0
  fi
fi
printf '%s\n' "$$" > "${PID_FILE}"

cleanup() {
  [[ -z "${LOCAL_PID}" ]] || kill "${LOCAL_PID}" 2>/dev/null || true
  [[ -z "${TUNNEL_PID}" ]] || kill "${TUNNEL_PID}" 2>/dev/null || true
  [[ -z "${LOCAL_PID}" ]] || wait "${LOCAL_PID}" 2>/dev/null || true
  [[ -z "${TUNNEL_PID}" ]] || wait "${TUNNEL_PID}" 2>/dev/null || true
  if [[ -r "${PID_FILE}" ]] && [[ "$(cat "${PID_FILE}")" == "$$" ]]; then
    rm -f "${PID_FILE}"
  fi
}
trap cleanup EXIT INT TERM HUP

start_local_runtime() {
  "${SCRIPT_DIR}/mac-mini-nowline-headless.sh" &
  LOCAL_PID="$!"
}

start_tunnel() {
  GOALS_TO_TODAY_TUNNEL_ID="${TUNNEL_ID}" \
    "${SCRIPT_DIR}/mac-mini-goalstotoday-tunnel.sh" &
  TUNNEL_PID="$!"
}

start_local_runtime
start_tunnel

while true; do
  if ! kill -0 "${LOCAL_PID}" 2>/dev/null; then
    wait "${LOCAL_PID}" 2>/dev/null || true
    sleep 10
    start_local_runtime
  fi
  if ! kill -0 "${TUNNEL_PID}" 2>/dev/null; then
    wait "${TUNNEL_PID}" 2>/dev/null || true
    sleep 10
    start_tunnel
  fi
  sleep 5
done
