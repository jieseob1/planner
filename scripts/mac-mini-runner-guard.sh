#!/usr/bin/env bash
set -euo pipefail

# Installed outside the checkout: it runs before any workflow step on this host.
if [[ "${GITHUB_REPOSITORY:-}" != "jieseob1/planner" ]] \
  || [[ "${GITHUB_REF:-}" != "refs/heads/main" ]] \
  || [[ "${GITHUB_WORKFLOW:-}" != "CI" ]] \
  || [[ "${GITHUB_JOB:-}" != "deploy-mac-mini" ]]; then
  echo 'This runner only accepts the trusted main deployment job.' >&2
  exit 1
fi
case "${GITHUB_EVENT_NAME:-}" in
  push|workflow_dispatch) ;;
  *) echo 'This runner only accepts the trusted main deployment job.' >&2; exit 1 ;;
esac
