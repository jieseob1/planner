#!/usr/bin/env bash

set -Eeuo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  printf 'Run this installer with sudo so it can manage /Library/LaunchDaemons.\n' >&2
  exit 77
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
SERVICE_USER="${NOWLINE_SERVICE_USER:-${SUDO_USER:-jieseobpark}}"
SERVICE_UID="$(id -u "${SERVICE_USER}")"
SERVICE_GROUP="$(id -gn "${SERVICE_USER}")"
SERVICE_HOME="$(dscl . -read "/Users/${SERVICE_USER}" NFSHomeDirectory | awk '{print $2}')"

if [[ -z "${SERVICE_HOME}" || ! -d "${SERVICE_HOME}" ]]; then
  printf 'Could not resolve the home directory for %s.\n' "${SERVICE_USER}" >&2
  exit 1
fi

install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0755 \
  "${SERVICE_HOME}/.local/state" "${SERVICE_HOME}/.cloudflared/logs"

render_plist() {
  local source="$1"
  local target="$2"
  local temporary
  temporary="$(mktemp "${target}.XXXXXX")"
  sed \
    -e "s|__NOWLINE_SERVICE_USER__|${SERVICE_USER}|g" \
    -e "s|__NOWLINE_SERVICE_HOME__|${SERVICE_HOME}|g" \
    -e "s|__NOWLINE_REPO_DIR__|${REPO_DIR}|g" \
    "${source}" > "${temporary}"
  plutil -lint "${temporary}" >/dev/null
  chown root:wheel "${temporary}"
  chmod 0644 "${temporary}"
  mv "${temporary}" "${target}"
}

disable_login_agent() {
  local label="$1"
  local source="${SERVICE_HOME}/Library/LaunchAgents/${label}.plist"
  local disabled_dir="${SERVICE_HOME}/Library/LaunchAgents.disabled"
  launchctl bootout "gui/${SERVICE_UID}/${label}" >/dev/null 2>&1 || true
  if [[ -f "${source}" ]]; then
    install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0755 "${disabled_dir}"
    mv "${source}" "${disabled_dir}/${label}.login-only.plist"
    chown "${SERVICE_USER}:${SERVICE_GROUP}" "${disabled_dir}/${label}.login-only.plist"
  fi
}

disable_login_agent com.nowline.local-beta
disable_login_agent com.goalstotoday.tunnel
disable_login_agent homebrew.mxcl.colima

# Stop only the temporary recovery processes that may have been started from an
# SSH session. The system jobs below become their single long-lived owners.
pkill -TERM -u "${SERVICE_UID}" -f 'kubectl.*nowline-frontend.*4189:80' >/dev/null 2>&1 || true
pkill -TERM -u "${SERVICE_UID}" -f 'cloudflared.*922b16b2-307d-45e4-acff-cf864353ba38' >/dev/null 2>&1 || true

for label in com.nowline.local-beta com.goalstotoday.tunnel; do
  launchctl bootout "system/${label}" >/dev/null 2>&1 || true
done

render_plist \
  "${REPO_DIR}/ops/macos/com.nowline.local-beta.plist" \
  /Library/LaunchDaemons/com.nowline.local-beta.plist
render_plist \
  "${REPO_DIR}/ops/macos/com.goalstotoday.tunnel.plist" \
  /Library/LaunchDaemons/com.goalstotoday.tunnel.plist

launchctl bootstrap system /Library/LaunchDaemons/com.nowline.local-beta.plist
launchctl bootstrap system /Library/LaunchDaemons/com.goalstotoday.tunnel.plist
launchctl kickstart -k system/com.nowline.local-beta
launchctl kickstart -k system/com.goalstotoday.tunnel

printf 'Installed headless services for %s from %s.\n' "${SERVICE_USER}" "${REPO_DIR}"
