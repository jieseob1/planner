#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_DIR="${HOME}/.local/share/goalstotoday-runner"
RUNNER_STATE="${HOME}/.local/state/goalstotoday-runner"
RUNNER_VERSION=2.337.0
RUNNER_SHA256=5a2cd92908a93d7276a194e1de6008099f3e7946f3f8e14aa7a1a7b4a31fdec2
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]]
mkdir -p "${RUNNER_DIR}" "${RUNNER_STATE}"
cd "${RUNNER_DIR}"
if [[ ! -f .runner ]]; then
  archive="$(mktemp "${RUNNER_STATE}/runner.XXXXXX")"
  curl --fail --location --retry 3 --output "${archive}" \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-osx-arm64-${RUNNER_VERSION}.tar.gz"
  [[ "$(shasum -a 256 "${archive}" | awk '{print $1}')" == "${RUNNER_SHA256}" ]]
  tar xzf "${archive}" -C "${RUNNER_DIR}"
  rm -f "${archive}"
  # Read the one-hour registration token from stdin; it is never stored in Git.
  IFS= read -r ACTIONS_RUNNER_INPUT_TOKEN
  export ACTIONS_RUNNER_INPUT_TOKEN
  ./config.sh --unattended --url https://github.com/jieseob1/planner \
    --name goalstotoday-mac-mini --labels goalstotoday-deploy --work _work
  unset ACTIONS_RUNNER_INPUT_TOKEN
fi
cp bin/runsvc.sh runsvc.sh
chmod 700 runsvc.sh
cp "${SCRIPT_DIR}/mac-mini-runner-guard.sh" trusted-job-guard.sh
chmod 700 trusted-job-guard.sh
cp "${SCRIPT_DIR}/mac-mini-runner-supervisor.mjs" runner-supervisor.mjs

cron_file="$(mktemp "${RUNNER_STATE}/cron.XXXXXX")"
(crontab -l 2>/dev/null || true) \
  | sed '/^# BEGIN GOALS_TO_TODAY_RUNNER$/,/^# END GOALS_TO_TODAY_RUNNER$/d' > "${cron_file}"
{
  printf '\n# BEGIN GOALS_TO_TODAY_RUNNER\n'
  printf '@reboot /opt/homebrew/bin/node %q >> %q 2>&1\n' "${RUNNER_DIR}/runner-supervisor.mjs" "${RUNNER_STATE}/supervisor.log"
  printf '* * * * * /opt/homebrew/bin/node %q >> %q 2>&1\n' "${RUNNER_DIR}/runner-supervisor.mjs" "${RUNNER_STATE}/supervisor.log"
  printf '# END GOALS_TO_TODAY_RUNNER\n'
} >> "${cron_file}"
crontab "${cron_file}"
rm -f "${cron_file}"
nohup node "${RUNNER_DIR}/runner-supervisor.mjs" >> "${RUNNER_STATE}/supervisor.log" 2>&1 < /dev/null &
printf 'Installed the Mac mini deployment runner and login-free reboot watchdog.\n'
