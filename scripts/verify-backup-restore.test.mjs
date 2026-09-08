import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { containerArgs, ownedContainer, validateTables, countSql, verifyCounts, foreignKeySql, rehearse } from './verify-backup-restore.mjs';

const tableRows = [
  ...['app_user', 'planner_task', 'planner_subtask', 'period_document', 'flyway_schema_history'].map(table => ['nowline', table]),
  ...['REALM', 'USER_ENTITY', 'DATABASECHANGELOG'].map(table => ['keycloak', table]),
];
const tables = validateTables(tableRows);

test('disposable container policy forbids network, ports, host mounts and arbitrary identifiers', () => {
  const args = containerArgs(`nowline-restore-${randomUUID()}`, 'a'.repeat(32));
  assert.equal(args[args.indexOf('--network') + 1], 'none');
  assert.equal(args[args.indexOf('--user') + 1], '999:999');
  assert(args.includes('--read-only'));
  assert(args.includes('no-new-privileges'));
  assert.equal(args[args.indexOf('--memory') + 1], '1g');
  assert(!args.some(arg => ['--mount', '--volume', '-v', '-p', '--publish', '--privileged'].includes(arg)));
  assert.throws(() => containerArgs('nowline-mysql-0', 'a'.repeat(32)));
  assert.throws(() => containerArgs(`nowline-restore-${randomUUID()}`, 'unsafe'));
});

test('cleanup ownership needs exact name, immutable ID and both labels', () => {
  const name = `nowline-restore-${randomUUID()}`;
  const token = 'b'.repeat(32);
  const fixture = { Id: 'c'.repeat(64), Name: `/${name}`, Config: { Labels: { 'nowline.restore.owner': 'goalstotoday-restore-rehearsal-v1', 'nowline.restore.token': token } } };
  assert(ownedContainer(fixture, name, token));
  assert(!ownedContainer(fixture, 'nowline-mysql-0', token));
  assert(!ownedContainer(fixture, name, 'd'.repeat(32)));
  assert(!ownedContainer({ ...fixture, Id: 'unknown' }, name, token));
  assert(!ownedContainer({ ...fixture, Config: { Labels: {} } }, name, token));
});

test('both schemas and all required app/identity tables are mandatory; injected identifiers fail', () => {
  assert.equal(validateTables(tableRows).length, 8);
  assert.throws(() => validateTables(tableRows.slice(0, -1)), /incomplete/);
  assert.throws(() => validateTables([...tableRows, ['nowline', 'bad`; DROP DATABASE mysql;']]));
  assert.throws(() => validateTables([...tableRows, ['mysql', 'user']]));
  assert.throws(() => validateTables([...tableRows, tableRows[0]]), /Duplicate/);
  assert(countSql(tables).includes('COUNT(*)'));
  assert(!countSql(tables).includes('SELECT *'));
});

test('counts reject missing/duplicate/invalid tables and mismatched same-snapshot baseline', () => {
  const rows = tables.map(item => [`${item.schema}.${item.table}`, '1']);
  const result = verifyCounts(rows, tables);
  assert.equal(Object.keys(result).length, 8);
  assert.deepEqual(verifyCounts(rows, tables, result), result);
  assert.throws(() => verifyCounts(rows.slice(0, -1), tables));
  assert.throws(() => verifyCounts([...rows.slice(0, -1), rows[0]], tables));
  assert.throws(() => verifyCounts(rows.map(row => [row[0], '-1']), tables));
  assert.throws(() => verifyCounts(rows, tables, { ...result, 'nowline.app_user': 2 }));
});

test('composite foreign-key orphan checks respect nullable child semantics and reject foreign schema', () => {
  const queries = foreignKeySql([
    ['nowline', 'child', 'fk_parent', 'parent_one', 'nowline', 'parent', 'one'],
    ['nowline', 'child', 'fk_parent', 'parent_two', 'nowline', 'parent', 'two'],
  ]);
  assert.equal(queries.length, 1);
  assert(queries[0].includes('c.`parent_one` IS NOT NULL AND c.`parent_two` IS NOT NULL'));
  assert(queries[0].includes('p.`one` = c.`parent_one` AND p.`two` = c.`parent_two`'));
  assert.throws(() => foreignKeySql([['nowline', 'child', 'fk', 'col', 'mysql', 'user', 'id']]));
});

function mocks({ countFailure = false, cleanupUnavailable = false } = {}) {
  const calls = [];
  let name, token;
  let inspectCount = 0;
  const command = (binary, args, options) => {
    assert.equal(binary, 'docker');
    calls.push(args);
    if (args[0] === 'run') {
      name = args[args.indexOf('--name') + 1];
      token = args.find(arg => arg.startsWith('nowline.restore.token=')).split('=')[1];
      assert(!args.includes(options.env.MYSQL_PWD));
      return 'c'.repeat(64);
    }
    if (args[0] === 'inspect') {
      inspectCount++;
      if (cleanupUnavailable && inspectCount > 1) throw new Error('daemon offline');
      return JSON.stringify([{ Id: 'c'.repeat(64), Name: `/${name}`, Config: { Labels: { 'nowline.restore.owner': 'goalstotoday-restore-rehearsal-v1', 'nowline.restore.token': token } }, State: { Running: true } }]);
    }
    if (args[0] === 'rm') { assert.deepEqual(args, ['rm', '--force', 'c'.repeat(64)]); return 'c'.repeat(64); }
    const sql = options.input;
    if (sql === 'SELECT 1;') return '1\n';
    if (sql.includes('information_schema.TABLES')) return tableRows.map(row => row.join('\t')).join('\n');
    if (sql.includes('WHERE success = 0')) return '0';
    if (sql.includes("WHERE NAME = 'nowline'")) return '1';
    if (sql.includes('AS table_name')) return (countFailure ? tables.slice(0, -1) : tables).map(item => `${item.schema}.${item.table}\t1`).join('\n');
    if (sql.includes('information_schema.KEY_COLUMN_USAGE')) return '';
    if (sql.startsWith('CHECK TABLE ')) return tables.map(item => `${item.schema}.${item.table}\tcheck\tstatus\tOK`).join('\n');
    throw new Error('Unexpected query.');
  };
  const execute = (binary, args) => {
    assert.equal(binary, 'docker');
    assert(args.includes(name));
    const child = new EventEmitter();
    child.kill = () => {};
    child.stdin = new Writable({ write(_chunk, _encoding, done) { done(); }, final(done) { done(); setImmediate(() => child.emit('close', 0)); } });
    return child;
  };
  return { command, execute, calls };
}

const withBackup = async action => {
  const directory = await mkdtemp(join(tmpdir(), 'nowline-restore-unit-'));
  const file = join(directory, 'fixture.sql.gz');
  try {
    await writeFile(file, gzipSync('-- isolated fake SQL\n'.repeat(100)), { mode: 0o600 });
    await action(file, directory);
  } finally { await rm(directory, { recursive: true, force: true }); }
};

test('orchestrator returns metadata only and removes exactly its disposable ID', async () => {
  await withBackup(async file => {
    const fake = mocks();
    const result = await rehearse({ file, ...fake });
    assert.equal(result.schemaSummary.nowline.tables, 5);
    assert.equal(result.schemaSummary.keycloak.tables, 3);
    assert.equal(result.sourceCountComparison, 'not-supplied');
    assert.equal(result.disposableContainerRemoved, true);
    assert.equal(result.offhostDurabilityVerified, false);
    assert.equal(fake.calls.filter(args => args[0] === 'rm').length, 1);
    assert(!JSON.stringify(result).includes('isolated fake SQL'));
  });
});

test('failed schema/count QA still removes owned fixture and unavailable cleanup cannot report success', async () => {
  await withBackup(async file => {
    const bad = mocks({ countFailure: true });
    await assert.rejects(() => rehearse({ file, ...bad }), /table-counts/);
    assert.equal(bad.calls.filter(args => args[0] === 'rm').length, 1);
    const cleanup = mocks({ cleanupUnavailable: true });
    await assert.rejects(() => rehearse({ file, ...cleanup }), /cleanup/);
    assert.equal(cleanup.calls.filter(args => args[0] === 'rm').length, 0);
  });
});

test('input symlink or corrupt dump is rejected before any Docker mutation', async () => {
  await withBackup(async (file, directory) => {
    const fake = mocks();
    const alias = join(directory, 'alias.sql.gz');
    await symlink(file, alias);
    await assert.rejects(() => rehearse({ file: alias, ...fake }), /symbolic link/);
    await writeFile(file, 'corrupt');
    await assert.rejects(() => rehearse({ file, ...fake }));
    assert.equal(fake.calls.length, 0);
  });
});

test('snapshot changes during setup cannot be misreported under the original checksum', async () => {
  await withBackup(async file => {
    const fake = mocks();
    const original = fake.command;
    const command = (binary, args, options) => {
      if (args[0] === 'run') {
        // Intentionally modify only this test fixture before the import stream.
        const changed = spawnSync(process.execPath, ['--input-type=module', '-e', "import{writeFileSync}from'node:fs';import{gzipSync}from'node:zlib';writeFileSync(process.argv[1],gzipSync('-- changed fixture\\n'.repeat(100)))", file]);
        assert.equal(changed.status, 0);
      }
      return original(binary, args, options);
    };
    await assert.rejects(() => rehearse({ file, execute: fake.execute, command }), /sql-import/);
    assert.equal(fake.calls.filter(args => args[0] === 'rm').length, 1);
  });
});

test('default CLI is read-only and refuses live target overrides', () => {
  const help = spawnSync(process.execPath, ['scripts/verify-backup-restore.mjs'], { encoding: 'utf8', env: { PATH: '' } });
  assert.equal(help.status, 0);
  assert(help.stdout.includes('Read-only mode'));
  const rejected = spawnSync(process.execPath, ['scripts/verify-backup-restore.mjs', '--run', '--host', 'production'], { encoding: 'utf8', env: { PATH: '' } });
  assert.equal(rejected.status, 1);
  assert(rejected.stderr.includes('deliberately unsupported'));
});
