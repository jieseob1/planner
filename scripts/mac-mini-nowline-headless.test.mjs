import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const broken = 'vz driver is running but host agent is not';
const limaHome = `${process.env.HOME}/.colima/_lima`;

// Execute the real entrypoint, but replace every external command and the
// downstream port-forward with fixtures. Never start/stop the developer's VM.
async function run(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'nowline headless test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const entry = join(directory, 'mac-mini-nowline-headless.sh');
  await copyFile(new URL('./mac-mini-nowline-headless.sh', import.meta.url), entry);
  for (const name of ['colima', 'limactl', 'mac-mini-nowline-port-forward.sh']) {
    const target = join(directory, name);
    await copyFile(new URL('./fixtures/headless-command.sh', import.meta.url), target);
    await chmod(target, 0o700);
  }
  const log = join(directory, 'commands.log');
  const result = spawnSync('bash', [entry], {
    encoding: 'utf8', timeout: 5000,
    env: {
      ...process.env,
      NOWLINE_COLIMA_BIN: join(directory, options.missingColima ? 'missing-colima' : 'colima'),
      NOWLINE_LIMACTL_BIN: join(directory, options.missingLima ? 'missing-lima' : 'limactl'),
      NOWLINE_TEST_LOG: log,
      ...options.env,
    },
  });
  assert.ifError(result.error);
  const commands = await readFile(log, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  return { ...result, commands: commands.trim().split('\n').filter(Boolean) };
}

test('healthy Colima forwards without inspecting or restarting any VM', async t => {
  const result = await run(t, { env: { NOWLINE_TEST_INSPECTION: broken } });
  assert.equal(result.status, 0);
  assert.deepEqual(result.commands, ['colima status', 'port-forward']);
});

test('normally stopped Colima starts without a forced stop', async t => {
  const result = await run(t, { env: { NOWLINE_TEST_STATUS: '1' } });
  assert.equal(result.status, 0);
  assert.deepEqual(result.commands, ['colima status', `limactl list colima|${limaHome}`, 'colima start', 'port-forward']);
});

for (const listStatus of ['0', '1']) {
  test(`specific broken VZ state is cleared before restart (inspection exit ${listStatus})`, async t => {
    const result = await run(t, { env: {
      NOWLINE_TEST_STATUS: '1', NOWLINE_TEST_INSPECTION: `colima: ${broken}`,
      NOWLINE_TEST_LIST_STATUS: listStatus,
    } });
    assert.equal(result.status, 0);
    assert.deepEqual(result.commands, ['colima status', `limactl list colima|${limaHome}`,
      `limactl stop --force colima|${limaHome}`, 'colima start', 'port-forward']);
    assert.match(result.stderr, /Clearing broken Colima VZ state/);
  });
}

test('unrelated inspection failure never triggers a forced stop', async t => {
  const result = await run(t, { env: {
    NOWLINE_TEST_STATUS: '1', NOWLINE_TEST_LIST_STATUS: '1', NOWLINE_TEST_INSPECTION: 'permission denied',
  } });
  assert.equal(result.status, 0);
  assert.deepEqual(result.commands, ['colima status', `limactl list colima|${limaHome}`, 'colima start', 'port-forward']);
});

test('missing Lima keeps the ordinary Colima startup path', async t => {
  const result = await run(t, { missingLima: true, env: { NOWLINE_TEST_STATUS: '1' } });
  assert.equal(result.status, 0);
  assert.deepEqual(result.commands, ['colima status', 'colima start', 'port-forward']);
});

test('failed forced stop fails closed without starting or forwarding', async t => {
  const result = await run(t, { env: {
    NOWLINE_TEST_STATUS: '1', NOWLINE_TEST_INSPECTION: broken, NOWLINE_TEST_STOP_STATUS: '23',
  } });
  assert.equal(result.status, 23);
  assert.deepEqual(result.commands, ['colima status', `limactl list colima|${limaHome}`, `limactl stop --force colima|${limaHome}`]);
});

test('failed Colima startup never starts port-forward', async t => {
  const result = await run(t, { missingLima: true, env: { NOWLINE_TEST_STATUS: '1', NOWLINE_TEST_START_STATUS: '24' } });
  assert.equal(result.status, 24);
  assert.deepEqual(result.commands, ['colima status', 'colima start']);
});

test('port-forward exit status still reaches the supervising process', async t => {
  const result = await run(t, { env: { NOWLINE_TEST_FORWARD_STATUS: '25' } });
  assert.equal(result.status, 25);
  assert.deepEqual(result.commands, ['colima status', 'port-forward']);
});

test('missing Colima fails without executing another command', async t => {
  const result = await run(t, { missingColima: true });
  assert.equal(result.status, 1);
  assert.deepEqual(result.commands, []);
  assert.match(result.stderr, /Colima is not installed/);
});
