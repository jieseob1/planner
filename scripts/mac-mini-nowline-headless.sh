#!/usr/bin/env bash

set -Eeuo pipefail

export PATH="/opt/homebrew/opt/openjdk@25/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

COLIMA="${NOWLINE_COLIMA_BIN:-/opt/homebrew/bin/colima}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -x "${COLIMA}" ]]; then
  printf 'Colima is not installed at %s.\n' "${COLIMA}" >&2
  exit 1
fi

if ! "${COLIMA}" status >/dev/null 2>&1; then
  # Lima can leave a VZ instance in Broken state after its host agent exits.
  # A normal `colima start` cannot clear that state, so the supervisor would
  # otherwise retry forever while the Kubernetes service stays offline.
  lima_ctl="${NOWLINE_LIMACTL_BIN:-$(command -v limactl || true)}"
  colima_lima_home="${HOME}/.colima/_lima"
  if [[ -x "${lima_ctl}" ]]; then
    inspection="$(LIMA_HOME="${colima_lima_home}" "${lima_ctl}" list colima 2>&1 || true)"
    if [[ "${inspection}" == *'vz driver is running but host agent is not'* ]]; then
      printf 'Clearing broken Colima VZ state before restart.\n' >&2
      LIMA_HOME="${colima_lima_home}" "${lima_ctl}" stop --force colima
    fi
  fi
  "${COLIMA}" start
fi

exec "${SCRIPT_DIR}/mac-mini-nowline-port-forward.sh"
