import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 30_000 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
};

const local = run('git', ['rev-parse', 'HEAD']);
const remoteLine = run('git', ['ls-remote', 'origin', 'refs/heads/codex/production-service']);
const origin = remoteLine.split(/\s+/)[0];
if (!origin) throw new Error('origin/codex/production-service was not found');
const macMini = run('ssh', [
  '-o', 'BatchMode=yes',
  '-o', 'IdentitiesOnly=yes',
  '-o', 'ConnectTimeout=10',
  '-i', `${process.env.HOME}/.ssh/id_ed25519`,
  'mac-mini',
  'git -C /Users/jieseobpark/develop/planner rev-parse HEAD'
]);
if (local !== origin || local !== macMini) {
  throw new Error(`Revision mismatch: local=${local}, origin=${origin}, mac-mini=${macMini}`);
}

console.log(`Goals to Today deployment revision verified: ${local}`);
