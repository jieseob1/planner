#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
STATE_DIR="${HOME}/.local/state"
DISABLED_DIR="${HOME}/Library/LaunchAgents.disabled"
CRON_BEGIN='# BEGIN GOALS_TO_TODAY_HEADLESS'
CRON_END='# END GOALS_TO_TODAY_HEADLESS'

if [[ "$(id -u)" -eq 0 ]]; then
  printf 'Run this fallback installer as the Mac mini service user, without sudo.\n' >&2
  exit 77
fi

mkdir -p "${STATE_DIR}" "${HOME}/.cloudflared/logs" "${DISABLED_DIR}"

disable_login_agent() {
  local label="$1"
  local source="${HOME}/Library/LaunchAgents/${label}.plist"
  launchctl bootout "gui/$(id -u)/${label}" >/dev/null 2>&1 || true
  if [[ -f "${source}" ]]; then
    mv "${source}" "${DISABLED_DIR}/${label}.login-only.plist"
  fi
}

disable_login_agent com.nowline.local-beta
disable_login_agent com.goalstotoday.tunnel
disable_login_agent homebrew.mxcl.colima

CRONTAB_FILE="$(mktemp "${STATE_DIR}/nowline-crontab.XXXXXX")"
(crontab -l 2>/dev/null || true) \
  | sed "/^${CRON_BEGIN}$/,/^${CRON_END}$/d" > "${CRONTAB_FILE}"
{
  printf '%s\n' "${CRON_BEGIN}"
  printf '@reboot %q >> %q 2>&1\n' \
    "${REPO_DIR}/scripts/mac-mini-headless-supervisor.sh" \
    "${STATE_DIR}/nowline-headless-supervisor.log"
  printf '%s\n' "${CRON_END}"
} >> "${CRONTAB_FILE}"
crontab "${CRONTAB_FILE}"
rm -f "${CRONTAB_FILE}"

pkill -TERM -u "$(id -u)" -f "${REPO_DIR}/scripts/mac-mini-headless-supervisor.sh" >/dev/null 2>&1 || true
pkill -TERM -u "$(id -u)" -f 'kubectl.*nowline-frontend.*4189:80' >/dev/null 2>&1 || true
pkill -TERM -u "$(id -u)" -f 'cloudflared.*922b16b2-307d-45e4-acff-cf864353ba38' >/dev/null 2>&1 || true
sleep 2

nohup "${REPO_DIR}/scripts/mac-mini-headless-supervisor.sh" \
  >> "${STATE_DIR}/nowline-headless-supervisor.log" 2>&1 < /dev/null &

for ((attempt = 1; attempt <= 120; attempt += 1)); do
  if pgrep -f "${REPO_DIR}/scripts/mac-mini-headless-supervisor.sh" >/dev/null \
    && curl --fail --silent --show-error --max-time 5 http://127.0.0.1:4189/healthz >/dev/null; then
    printf 'Installed login-free @reboot recovery from %s.\n' "${REPO_DIR}"
    exit 0
  fi
  sleep 1
done

printf 'The @reboot entry was installed, but the local health check did not recover within 120 seconds.\n' >&2
exit 1
