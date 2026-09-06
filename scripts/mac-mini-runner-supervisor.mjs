import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const runner = path.join(homedir(), '.local/share/goalstotoday-runner');
const state = path.join(homedir(), '.local/state/goalstotoday-runner');
mkdirSync(state, { recursive: true, mode: 0o700 });
const lock = path.join(state, 'supervisor.pid');
try {
  const pid = Number(readFileSync(lock, 'utf8').trim());
  if (Number.isSafeInteger(pid) && pid > 1) {
    const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    if (command.includes('runner-supervisor.mjs')) process.exit(0);
  }
} catch { /* A stopped process or first startup has no live lock owner. */ }
try { unlinkSync(lock); } catch (error) { if (error.code !== 'ENOENT') throw error; }
try { writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); }
catch (error) { if (error.code === 'EEXIST') process.exit(0); throw error; }
const log = openSync(path.join(state, 'runner.log'), 'a', 0o600);
const child = spawn('/bin/bash', ['runsvc.sh'], {
  cwd: runner,
  env: { ...process.env, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    ACTIONS_RUNNER_HOOK_JOB_STARTED: path.join(runner, 'trusted-job-guard.sh') },
  stdio: ['ignore', log, log],
});
const stop = () => child.kill('SIGTERM');
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', (code) => {
  closeSync(log);
  if (readFileSync(lock, 'utf8') === String(process.pid)) unlinkSync(lock);
  process.exitCode = code ?? 1;
});
