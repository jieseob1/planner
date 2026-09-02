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
  "${COLIMA}" start
fi

exec "${SCRIPT_DIR}/mac-mini-nowline-port-forward.sh"
