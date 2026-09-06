import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 240_000 }).trim();
const local = run('git', ['rev-parse', 'HEAD']);
assert.match(local, /^[a-f0-9]{40}$/);
const remote = run('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0];
assert.equal(local, remote, 'Local HEAD must match origin/main');
const release = JSON.parse(run('ssh', [
  '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=15',
  '-i', `${process.env.HOME}/.ssh/id_ed25519`, 'mac-mini',
  `export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin; NOWLINE_RELEASE_SHA=${local} node /Users/jieseobpark/develop/planner/scripts/deploy-mac-mini.mjs --verify`,
]));
assert.equal(release.revision, local);
console.log(JSON.stringify(release, null, 2));
console.log(`Goals to Today deployment revision verified: ${local}`);
