import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, readFile, rm, stat, mkdir, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { backupConfig, dumpArgs, executeBackup, install, launchdPlist, planRetention, verify, writeDump } from './scheduled-beta-backup.mjs';

const fixtureDump = gzipSync('-- isolated fixture: both databases only in test\n'.repeat(100));
const fixture = async action => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'nowline-scheduled-backup-test-')));
  try { await action(home, join(home, '.local', 'state', 'goalstotoday-backup')); }
  finally { await rm(home, { recursive: true, force: true }); }
};
const dump = file => writeFile(file, fixtureDump, { flag: 'wx', mode: 0o600 });

test('dump contract contains both app and login databases and no interpolated host credentials', () => {
  assert(dumpArgs.includes('kind-nowline-local'));
  assert(dumpArgs.includes('nowline-mysql-0'));
  assert(dumpArgs.at(-1).includes('--databases nowline keycloak'));
  assert(dumpArgs.at(-1).includes('--single-transaction'));
  assert(dumpArgs.at(-1).includes('MYSQL_PWD="$MYSQL_ROOT_PASSWORD"'));
  assert(!dumpArgs.at(-1).includes('--password='));
});

test('streaming dump accepts process success and rejects nonzero exit even with gzip-able output', async () => {
  await fixture(async (home) => {
    const execute = code => () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.kill = () => {};
      setTimeout(() => { child.stdout.end('-- isolated SQL fixture\n'.repeat(100)); child.emit('close', code); }, 1);
      return child;
    };
    await writeDump(join(home, 'positive.pending'), execute(0));
    await assert.rejects(() => writeDump(join(home, 'negative.pending'), execute(1)), /dump failed/);
  });
});

test('successful local-only run is permission-restricted, verifies integrity and skips until due', async () => {
  await fixture(async (home, directory) => {
    const result = await executeBackup({ home, dump });
    assert.equal(result.status, 'success');
    assert.equal(result.offhost, 'not-configured');
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    const manifest = JSON.parse(await readFile(join(directory, 'last-success.json'), 'utf8'));
    assert.equal((await stat(join(directory, manifest.file))).mode & 0o777, 0o600);
    assert.deepEqual(manifest.databases, ['nowline', 'keycloak']);
    const report = await verify({ home });
    assert.equal(report.status, 'healthy');
    assert.equal(report.restoreVerified, false);
    const skipped = await executeBackup({ home, dump: () => { throw new Error('Must not dump again'); } });
    assert.equal(skipped.status, 'skipped');
    const stale = await verify({ home, now: Date.now() + 27 * 3_600_000 });
    assert.equal(stale.fresh, false);
  });
});

test('failed dump preserves latest good backup and records a failure; hourly retry is not skipped', async () => {
  await fixture(async (home, directory) => {
    await executeBackup({ home, dump });
    const previous = await readFile(join(directory, 'last-success.json'), 'utf8');
    await assert.rejects(() => executeBackup({ home, force: true, dump: async () => { throw new Error('private secret'); } }), /mysql-dump/);
    assert.equal(await readFile(join(directory, 'last-success.json'), 'utf8'), previous);
    const report = await verify({ home });
    assert.equal(report.status, 'failed');
    assert.equal(report.fresh, true);
    assert(!JSON.stringify(report).includes('private secret'));
    assert.equal((await executeBackup({ home, dump })).status, 'success');
  });
});

test('corrupt compressed output is removed and not promoted; lost latest artifact forces a fresh backup', async () => {
  await fixture(async (home, directory) => {
    await assert.rejects(() => executeBackup({ home, dump: file => writeFile(file, 'not gzip', { flag: 'wx' }) }), /gzip-integrity/);
    assert.equal((await readdir(directory)).filter(name => name.endsWith('.sql.gz') || name.endsWith('.pending')).length, 0);
    await executeBackup({ home, dump });
    const manifest = JSON.parse(await readFile(join(directory, 'last-success.json'), 'utf8'));
    await rm(join(directory, manifest.file));
    assert.equal((await executeBackup({ home, dump })).status, 'success');
  });
});

test('existing lock, deployment lock, nonowned directory and symlinks fail closed', async () => {
  await fixture(async (home, directory) => {
    await executeBackup({ home, dump });
    await writeFile(join(directory, 'backup.lock'), 'operator-held', { flag: 'wx' });
    await assert.rejects(() => executeBackup({ home, force: true, dump }));
    assert.equal(await readFile(join(directory, 'backup.lock'), 'utf8'), 'operator-held');
    await rm(join(directory, 'backup.lock'));
    await mkdir(join(home, '.local/state/goalstotoday-deploy'), { recursive: true });
    await writeFile(join(home, '.local/state/goalstotoday-deploy/deploy.lock'), 'operator-held');
    await assert.rejects(() => executeBackup({ home, force: true, dump }), /preflight/);
  });
  await fixture(async (home, directory) => {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'user-data.txt'), 'preserve');
    await assert.rejects(() => executeBackup({ home, dump }), /unknown directory/);
    assert.equal(await readFile(join(directory, 'user-data.txt'), 'utf8'), 'preserve');
  });
  await fixture(async (home, directory) => {
    await mkdir(join(home, '.local/state'), { recursive: true });
    await symlink(join(home, 'outside'), directory);
    await assert.rejects(() => executeBackup({ home, dump }), /symbolic links/);
  });
});

test('remote upload is opt-in, non-overwriting, STANDARD encrypted and accepted only after SHA verification', async () => {
  await fixture(async (home, directory) => {
    await executeBackup({ home, dump });
    await writeFile(join(directory, 'config.json'), JSON.stringify(backupConfig({ NOWLINE_BACKUP_S3_PREFIX: 's3://fixture-bucket/backups', AWS_PROFILE: 'beta' })), { mode: 0o600 });
    const calls = [];
    let checksum;
    const command = (binary, args) => {
      calls.push([binary, args]);
      if (args.includes('put-object')) {
        checksum = args[args.indexOf('--checksum-sha256') + 1];
        return '{}';
      }
      return JSON.stringify({ LastModified: new Date().toISOString(), ContentLength: fixtureDump.length, ChecksumSHA256: checksum, ChecksumType: 'FULL_OBJECT', ServerSideEncryption: 'AES256', StorageClass: 'STANDARD' });
    };
    const result = await executeBackup({ home, dump, command, force: true });
    assert.equal(result.offhost, 'verified');
    assert.equal(calls.length, 2);
    const args = calls[0][1];
    assert.equal(args[args.indexOf('--if-none-match') + 1], '*');
    assert.equal(args[args.indexOf('--storage-class') + 1], 'STANDARD');
    assert.equal(args[args.indexOf('--server-side-encryption') + 1], 'AES256');
    await assert.rejects(() => executeBackup({ home, dump, force: true, command: () => '{}' }), /offhost-verification/);
    const orphanFree = (await readdir(directory)).filter(name => name.endsWith('.sql.gz'));
    for (const file of orphanFree) assert((await stat(join(directory, `${file}.json`))).isFile());
    assert.equal((await verify({ home })).status, 'failed');
  });
});

test('retention keeps seven newest copies and only deletes recognized artifacts older than fourteen days', () => {
  const now = Date.now();
  const rows = Array.from({ length: 20 }, (_, index) => ({ owner: 'goalstotoday-scheduled-backup-v1', file: `mysql-2026-08-01T00-00-00-000Z-${randomUUID()}.sql.gz`, completedAt: new Date(now - index * 86_400_000).toISOString() }));
  const victims = planRetention(rows, now);
  assert.equal(victims.length, 5);
  assert(victims.every(file => rows.slice(15).some(row => row.file === file)));
  assert.equal(planRetention(rows.slice(0, 6).map(row => ({ ...row, completedAt: '2020-01-01' })), now).length, 0);
  assert(!planRetention([...rows, { owner: 'someone-else', file: '../../keep', completedAt: '2020-01-01' }], now).includes('../../keep'));
});

test('LaunchAgent contains absolute executable paths, nonlogin PATH, daily trigger and retry without embedded credentials', async () => {
  const plist = launchdPlist({ home: '/Users/operator', repository: '/Users/operator/project with & space', nodePath: '/opt/homebrew/bin/node' });
  assert(plist.includes('project with &amp; space'));
  assert(plist.includes('/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'));
  assert(plist.includes('<integer>3600</integer>'));
  assert(plist.includes('<key>RunAtLoad</key><true/>'));
  assert(plist.includes('<string>--context</string><string>kind-nowline-local</string>'));
  if (process.platform === 'darwin') {
    const parsed = spawnSync('plutil', ['-lint', '--', '-'], { input: plist, encoding: 'utf8' });
    assert.equal(parsed.status, 0, `Generated LaunchAgent must pass the real macOS plist parser: ${parsed.stderr || parsed.stdout}`);
  }
  await fixture(async (home, directory) => {
    const calls = [];
    const command = (binary, args) => { calls.push([binary, args]); return ''; };
    const result = await install({ home, repository: process.cwd(), platform: 'darwin', env: { NOWLINE_BACKUP_S3_PREFIX: 's3://fixture-bucket/mysql', AWS_SECRET_ACCESS_KEY: 'forbidden-secret' }, command });
    assert.equal(result.requiresUserLogin, true);
    assert(calls.some(([name, args]) => name === 'plutil' && args[0] === '-lint'));
    assert(calls.some(([name, args]) => name === 'launchctl' && args[0] === 'bootstrap'));
    const config = await readFile(join(directory, 'config.json'), 'utf8');
    assert(!config.includes('forbidden-secret'));
    await install({ home, repository: process.cwd(), platform: 'darwin', env: {}, command });
    assert.equal(await readFile(join(directory, 'config.json'), 'utf8'), config, 'Reinstall must preserve configured remote destination');
  });
});

test('CLI no-arg is read-only and wrong context is refused', () => {
  const help = spawnSync(process.execPath, ['scripts/scheduled-beta-backup.mjs'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert(help.stdout.includes('Read-only mode'));
  const rejected = spawnSync(process.execPath, ['scripts/scheduled-beta-backup.mjs', '--run', '--context', 'production'], { encoding: 'utf8' });
  assert.equal(rejected.status, 1);
  assert(rejected.stderr.includes('kind-nowline-local'));
});
