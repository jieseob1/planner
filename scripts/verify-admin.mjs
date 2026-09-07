import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const startedAt = Date.now();
const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', timeout: 240_000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed`);
};

run('rtk', ['proxy', 'npx', 'vitest', 'run', 'src/admin']);
run('rtk', ['proxy', 'npx', 'tsc', '--noEmit', '-p', 'tsconfig.app.json']);
run('rtk', ['proxy', './mvnw', '-q', '-Dtest=AdminAccessTest', '-Dit.test=AdminApiIT', 'verify'], path.join(root, 'backend'));
for (const [directory, name, minimum] of [
  ['surefire-reports', 'AdminAccessTest', 3], ['failsafe-reports', 'AdminApiIT', 6]
]) {
  const file = path.join(root, `backend/target/${directory}/TEST-io.nowline.planner.admin.${name}.xml`);
  assert.ok(statSync(file).mtimeMs >= startedAt, `${name} report must be from this run`);
  const source = readFileSync(file, 'utf8');
  const suite = source.match(/<testsuite\b[^>]*>/)?.[0] ?? '';
  const attribute = (key) => Number(suite.match(new RegExp(`\\b${key}="(\\d+)"`))?.[1]);
  assert.ok(attribute('tests') >= minimum, `${name} must execute all required tests`);
  for (const key of ['failures', 'errors', 'skipped']) assert.equal(attribute(key), 0, `${name}: ${key}`);
}
console.log('admin backoffice verified');
