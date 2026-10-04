#!/usr/bin/env bash
set -Eeuo pipefail

case "${0##*/}" in
  colima)
    printf 'colima %s\n' "$*" >> "${NOWLINE_TEST_LOG}"
    case "$1" in
      status) exit "${NOWLINE_TEST_STATUS:-0}" ;;
      start) exit "${NOWLINE_TEST_START_STATUS:-0}" ;;
      *) exit 99 ;;
    esac
    ;;
  limactl)
    printf 'limactl %s|%s\n' "$*" "${LIMA_HOME:-}" >> "${NOWLINE_TEST_LOG}"
    case "$1" in
      list)
        printf '%s\n' "${NOWLINE_TEST_INSPECTION:-Stopped}" >&2
        exit "${NOWLINE_TEST_LIST_STATUS:-0}"
        ;;
      stop) exit "${NOWLINE_TEST_STOP_STATUS:-0}" ;;
      *) exit 99 ;;
    esac
    ;;
  mac-mini-nowline-port-forward.sh)
    printf 'port-forward\n' >> "${NOWLINE_TEST_LOG}"
    exit "${NOWLINE_TEST_FORWARD_STATUS:-0}"
    ;;
  *) exit 99 ;;
esac
