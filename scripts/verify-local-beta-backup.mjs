import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = (message) => { throw new Error(message); };
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed\n${result.stderr || result.stdout}`);
  return result.stdout;
};

const output = run('bash', ['scripts/backup-local-mysql.sh']);
const backupPath = output.match(/^backup_path=(.+)$/m)?.[1];
if (!backupPath) fail(`Backup script did not report a path:\n${output}`);
if (statSync(backupPath).size < 1024) fail(`Backup is unexpectedly small: ${statSync(backupPath).size} bytes`);
run('gzip', ['-t', backupPath]);

const source = readFileSync(path.join(root, 'scripts', 'backup-local-mysql.sh'), 'utf8');
for (const required of [
  '--single-transaction',
  'NOWLINE_BACKUP_S3_URI',
  '--storage-class',
  'DEEP_ARCHIVE',
  'gzip -t'
]) {
  if (!source.includes(required)) fail(`Backup contract is missing: ${required}`);
}

console.log(`verified backup ${path.basename(backupPath)} (${statSync(backupPath).size} bytes)`);
console.log('local beta backup verified');
