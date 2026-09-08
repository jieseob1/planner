import { createReadStream } from 'node:fs';
import { lstat, readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createGunzip, gzipSync } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { basename, join, resolve, isAbsolute } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { inspectLocalBackup } from './beta-operations.mjs';

export const IMAGE = 'mysql:8.4.10@sha256:8dbcf531a03aade657e181b9cf2f1d1803ce621a1d55610cb44cb531ab7d7db6';
const OWNER = 'goalstotoday-restore-rehearsal-v1';
const SCHEMAS = ['nowline', 'keycloak'];
const ident = value => { if (!/^[A-Za-z0-9_]+$/.test(value || '')) throw new Error('Unexpected SQL identifier.'); return `\`${value}\``; };
const safeCommand = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 ** 2, ...options });
  if (result.status !== 0) throw new Error('Isolated restore command failed. Inspect only the disposable fixture locally.');
  return result.stdout;
};

export function containerArgs(name, token) {
  if (!/^nowline-restore-[a-f0-9-]{36}$/.test(name) || !/^[a-f0-9]{32}$/.test(token)) throw new Error('Invalid disposable container identity.');
  return ['run', '--detach', '--name', name, '--pull', 'never', '--network', 'none', '--read-only', '--user', '999:999',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '1g', '--cpus', '1', '--pids-limit', '256',
    '--label', `nowline.restore.owner=${OWNER}`, '--label', `nowline.restore.token=${token}`,
    '--tmpfs', '/var/lib/mysql:rw,noexec,nosuid,size=768m,uid=999,gid=999,mode=0700',
    '--tmpfs', '/var/run/mysqld:rw,noexec,nosuid,size=16m,uid=999,gid=999,mode=0700',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m,uid=999,gid=999,mode=0700',
    '--env', 'MYSQL_ROOT_PASSWORD', IMAGE,
    '--skip-log-bin', '--local-infile=OFF', '--secure-file-priv=NULL', '--event-scheduler=OFF', '--general-log=OFF', '--slow-query-log=OFF',
    '--innodb-buffer-pool-size=128M', '--max-connections=20'];
}

export function ownedContainer(inspect, name, token) {
  return /^[a-f0-9]{64}$/.test(inspect?.Id || '') && inspect.Name === `/${name}`
    && inspect.Config?.Labels?.['nowline.restore.owner'] === OWNER
    && inspect.Config?.Labels?.['nowline.restore.token'] === token;
}

export function validateTables(rows) {
  const tables = rows.map(row => {
    const [schema, table] = row;
    if (!SCHEMAS.includes(schema)) throw new Error('Unexpected restored schema.');
    ident(table);
    return { schema, table };
  });
  if (new Set(tables.map(item => `${item.schema}.${item.table.toLowerCase()}`)).size !== tables.length) throw new Error('Duplicate restored table.');
  const required = {
    nowline: ['app_user', 'planner_task', 'planner_subtask', 'period_document', 'flyway_schema_history'],
    keycloak: ['realm', 'user_entity', 'databasechangelog'],
  };
  for (const [schema, names] of Object.entries(required)) for (const name of names) {
    if (!tables.some(item => item.schema === schema && item.table.toLowerCase() === name)) throw new Error(`Required ${schema} schema is incomplete.`);
  }
  return tables;
}

export function countSql(tables) {
  return tables.map(({ schema, table }) => {
    if (!SCHEMAS.includes(schema)) throw new Error('Unexpected count schema.');
    return `SELECT '${schema}.${table}' AS table_name, COUNT(*) AS row_count FROM ${ident(schema)}.${ident(table)}`;
  }).join(' UNION ALL ') + ';';
}

export function verifyCounts(rows, tables, expected) {
  const counts = Object.fromEntries(rows.map(([table, count]) => {
    if (!/^(nowline|keycloak)\.[A-Za-z0-9_]+$/.test(table) || !/^\d+$/.test(count) || !Number.isSafeInteger(Number(count))) throw new Error('Invalid restored row count.');
    return [table, Number(count)];
  }));
  if (rows.length !== tables.length || Object.keys(counts).length !== tables.length || !tables.every(item => `${item.schema}.${item.table}` in counts)) throw new Error('Some restored tables were not counted.');
  if (expected) {
    if (Object.keys(expected).length !== tables.length || !Object.entries(counts).every(([key, value]) => Number.isSafeInteger(expected[key]) && expected[key] === value)) throw new Error('Restored counts differ from the supplied same-snapshot baseline.');
  }
  return counts;
}

export function foreignKeySql(rows) {
  const groups = new Map();
  for (const [schema, table, constraint, column, referencedSchema, referencedTable, referencedColumn] of rows) {
    if (!SCHEMAS.includes(schema) || !SCHEMAS.includes(referencedSchema)) throw new Error('Unexpected foreign key schema.');
    for (const name of [table, constraint, column, referencedTable, referencedColumn]) ident(name);
    const key = `${schema}.${table}.${constraint}`;
    const value = groups.get(key) || { schema, table, constraint, referencedSchema, referencedTable, columns: [] };
    if (value.referencedSchema !== referencedSchema || value.referencedTable !== referencedTable) throw new Error('Inconsistent foreign key metadata.');
    value.columns.push([column, referencedColumn]); groups.set(key, value);
  }
  return [...groups.values()].map(item => {
    const nonNull = item.columns.map(([column]) => `c.${ident(column)} IS NOT NULL`).join(' AND ');
    const match = item.columns.map(([column, referenced]) => `p.${ident(referenced)} = c.${ident(column)}`).join(' AND ');
    return `SELECT COUNT(*) AS orphan_count FROM ${ident(item.schema)}.${ident(item.table)} c WHERE ${nonNull} AND NOT EXISTS (SELECT 1 FROM ${ident(item.referencedSchema)}.${ident(item.referencedTable)} p WHERE ${match});`;
  });
}

async function selectBackup({ file, latest, home }) {
  let manifest;
  if (latest) {
    const directory = join(home, '.local/state/goalstotoday-backup');
    const manifestPath = join(directory, 'last-success.json');
    if (!(await lstat(manifestPath)).isFile() || (await lstat(manifestPath)).isSymbolicLink()) throw new Error('Latest backup manifest must be a regular file.');
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.owner !== 'goalstotoday-scheduled-backup-v1' || manifest.status !== 'success' || basename(manifest.file || '') !== manifest.file || !manifest.file?.endsWith('.sql.gz')) throw new Error('Latest backup manifest is invalid.');
    file = join(directory, manifest.file);
  }
  if (!isAbsolute(file || '') || !(await lstat(file)).isFile() || (await lstat(file)).isSymbolicLink()) throw new Error('Select an absolute regular gzip file, not a symbolic link.');
  const local = await inspectLocalBackup(file);
  if (manifest && (manifest.bytes !== local.bytes || manifest.checksumSHA256 !== local.checksumSHA256)) throw new Error('Latest backup differs from its saved manifest.');
  return { file, local };
}

async function importDump(file, name, commandEnv, execute = spawn) {
  const child = execute('docker', ['exec', '-i', '--env', 'MYSQL_PWD', name, 'mysql', '--user=root', '--default-character-set=utf8mb4', '--binary-mode=1', '--local-infile=0'],
    { env: commandEnv, stdio: ['pipe', 'ignore', 'ignore'], timeout: 180_000 });
  const completion = new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? accept() : reject(new Error('SQL restore failed.')));
  });
  completion.catch(() => {});
  let bytes = 0;
  const digest = createHash('sha256');
  try {
    await Promise.all([completion, pipeline(createReadStream(file), new Transform({
      transform(chunk, _encoding, callback) { digest.update(chunk); callback(null, chunk); },
    }), createGunzip(), new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        callback(bytes > 256 * 1024 ** 2 ? new Error('Expanded SQL exceeds rehearsal budget.') : null, chunk);
      },
    }), child.stdin)]);
    return digest.digest('base64');
  } catch { child.kill('SIGTERM'); throw new Error('SQL restore failed or exceeded its bounded rehearsal budget.'); }
}

export async function rehearse({ file, latest = false, home = homedir(), expected, command = safeCommand, execute = spawn } = {}) {
  const selected = await selectBackup({ file, latest, home });
  // A finite budget makes the rehearsal safe on the shared 8 GiB kind host.
  if (selected.local.sqlBytes > 256 * 1024 ** 2 || selected.local.bytes > 128 * 1024 ** 2) throw new Error('Snapshot exceeds the 256 MiB SQL / 128 MiB compressed rehearsal budget; review capacity first.');
  const name = `nowline-restore-${randomUUID()}`;
  const token = randomBytes(16).toString('hex');
  const password = randomBytes(24).toString('base64url');
  const commandEnv = { ...process.env, MYSQL_ROOT_PASSWORD: password, MYSQL_PWD: password };
  const deadlineAt = Date.now() + 8 * 60_000;
  const run = (args, options = {}) => {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new Error('Overall rehearsal deadline exceeded.');
    return command('docker', args, { env: commandEnv, timeout: Math.min(30_000, remaining), ...options });
  };
  const cleanup = args => command('docker', args, { env: commandEnv, timeout: 30_000 });
  const mysql = sql => run(['exec', '-i', '--env', 'MYSQL_PWD', name, 'mysql', '--user=root', '--batch', '--skip-column-names', '--default-character-set=utf8mb4', '--local-infile=0'], { input: sql });
  const tabular = text => text.trim() ? text.trim().split('\n').map(line => line.split('\t')) : [];
  let phase = 'container-start';
  let created = false;
  const started = performance.now();
  try {
    const id = run(containerArgs(name, token)).trim();
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Disposable container ID was not returned.');
    created = true;
    const meta = JSON.parse(run(['inspect', name]))[0];
    if (!ownedContainer(meta, name, token) || meta.Id !== id) throw new Error('Disposable ownership could not be established.');
    phase = 'mysql-readiness';
    const deadline = Date.now() + 90_000;
    let ready = false;
    while (Date.now() < deadline) {
      try { if (mysql('SELECT 1;').trim() === '1') { ready = true; break; } } catch { /* bounded startup retry */ }
      const state = JSON.parse(run(['inspect', name]))[0].State;
      if (!state?.Running || state.OOMKilled) throw new Error('Disposable MySQL exited before readiness.');
      await new Promise(accept => setTimeout(accept, 500));
    }
    if (!ready) throw new Error('Disposable MySQL readiness timed out.');
    phase = 'sql-import';
    const importedChecksum = await importDump(selected.file, name, commandEnv, execute);
    if (importedChecksum !== selected.local.checksumSHA256) throw new Error('Backup changed between validation and import.');
    phase = 'schema-check';
    const tables = validateTables(tabular(mysql("SELECT TABLE_SCHEMA, TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA IN ('nowline','keycloak') AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME;")));
    // Restored migration history must have no failed migration. Keycloak must
    // actually contain our service realm, not only an empty schema/master realm.
    if (mysql('SELECT COUNT(*) FROM nowline.flyway_schema_history WHERE success = 0;').trim() !== '0') throw new Error('Restored Flyway history contains a failure.');
    const realm = tables.find(item => item.schema === 'keycloak' && item.table.toLowerCase() === 'realm').table;
    if (mysql(`SELECT COUNT(*) FROM keycloak.${ident(realm)} WHERE NAME = 'nowline';`).trim() !== '1') throw new Error('Restored service realm missing or duplicated.');
    phase = 'table-counts';
    const counts = verifyCounts(tabular(mysql(countSql(tables))), tables, expected);
    phase = 'foreign-key-check';
    const fkRows = tabular(mysql("SELECT TABLE_SCHEMA,TABLE_NAME,CONSTRAINT_NAME,COLUMN_NAME,REFERENCED_TABLE_SCHEMA,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA IN ('nowline','keycloak') AND REFERENCED_TABLE_SCHEMA IS NOT NULL ORDER BY TABLE_SCHEMA,TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION;"));
    const queries = foreignKeySql(fkRows);
    for (const query of queries) if (mysql(query).trim() !== '0') throw new Error('Restored foreign-key orphan rows exist.');
    phase = 'table-integrity';
    const integrity = tabular(mysql(`CHECK TABLE ${tables.map(item => `${ident(item.schema)}.${ident(item.table)}`).join(', ')};`));
    if (integrity.length !== tables.length || !integrity.every(row => row[2] === 'status' && row[3] === 'OK')) throw new Error('Restored table integrity check failed.');
    return { result: 'isolated backup restore verified', elapsedSeconds: Math.round((performance.now() - started) / 100) / 10,
      scope: 'Disposable network-isolated MySQL only; no live database connection and no source snapshot changes.',
      snapshotChecksumSHA256: selected.local.checksumSHA256, compressedBytes: selected.local.bytes,
      schemaSummary: Object.fromEntries(SCHEMAS.map(schema => [schema, { tables: tables.filter(item => item.schema === schema).length, rows: Object.entries(counts).filter(([key]) => key.startsWith(`${schema}.`)).reduce((sum, [, count]) => sum + count, 0) }])),
      tableCounts: counts, foreignKeysChecked: queries.length, sourceCountComparison: expected ? 'matched-supplied-baseline' : 'not-supplied',
      offhostDurabilityVerified: false, disposableContainerRemoved: true };
  } catch {
    throw new Error(`Backup rehearsal failed during ${phase}; no SQL rows, credentials or container logs were printed.`);
  } finally {
    let owned;
    try { owned = JSON.parse(cleanup(['inspect', name]))[0]; } catch { /* Docker start may have failed before creation. */ }
    if (!owned && created) throw new Error('Could not verify disposable cleanup; inspect the owned restore container locally. Do not prune other resources.');
    if (owned) {
      if (!ownedContainer(owned, name, token)) throw new Error('Cleanup refused: disposable ownership did not match. Do not remove other containers.');
      // Exact verified immutable container ID; no volumes, names from the dump,
      // globs, host directories, system prune or live kubectl commands.
      cleanup(['rm', '--force', owned.Id]);
    }
  }
}

const fixtureSql = `CREATE DATABASE nowline; CREATE DATABASE keycloak;
CREATE TABLE nowline.app_user (id INT PRIMARY KEY); INSERT INTO nowline.app_user VALUES(1);
CREATE TABLE nowline.planner_task (id INT PRIMARY KEY, user_id INT, FOREIGN KEY(user_id) REFERENCES nowline.app_user(id)); INSERT INTO nowline.planner_task VALUES(1,1);
CREATE TABLE nowline.planner_subtask (id INT PRIMARY KEY, task_id INT, FOREIGN KEY(task_id) REFERENCES nowline.planner_task(id)); INSERT INTO nowline.planner_subtask VALUES(1,1);
CREATE TABLE nowline.period_document (id INT PRIMARY KEY); INSERT INTO nowline.period_document VALUES(1);
CREATE TABLE nowline.flyway_schema_history (installed_rank INT PRIMARY KEY, success BOOLEAN); INSERT INTO nowline.flyway_schema_history VALUES(1,TRUE);
CREATE TABLE keycloak.REALM (ID INT PRIMARY KEY, NAME VARCHAR(255)); INSERT INTO keycloak.REALM VALUES(1,'nowline');
CREATE TABLE keycloak.USER_ENTITY (ID INT PRIMARY KEY, REALM_ID INT, FOREIGN KEY(REALM_ID) REFERENCES keycloak.REALM(ID)); INSERT INTO keycloak.USER_ENTITY VALUES(1,1);
CREATE TABLE keycloak.DATABASECHANGELOG (ID INT PRIMARY KEY); INSERT INTO keycloak.DATABASECHANGELOG VALUES(1);
`;

async function selfTest() {
  const directory = await mkdtemp(join(tmpdir(), 'nowline-restore-fixture-'));
  try {
    const good = join(directory, 'positive.sql.gz');
    await writeFile(good, gzipSync(fixtureSql), { mode: 0o600 });
    const result = await rehearse({ file: good });
    if (result.schemaSummary.nowline.tables !== 5 || result.schemaSummary.keycloak.tables !== 3 || result.foreignKeysChecked !== 3) throw new Error('Positive fixture was not fully restored.');
    const bad = join(directory, 'incomplete.sql.gz');
    await writeFile(bad, gzipSync(fixtureSql.replace('CREATE TABLE keycloak.DATABASECHANGELOG (ID INT PRIMARY KEY); INSERT INTO keycloak.DATABASECHANGELOG VALUES(1);', '-- identity migration table intentionally missing')), { mode: 0o600 });
    let rejected = false;
    try { await rehearse({ file: bad }); } catch (error) { rejected = /schema-check/.test(error.message); }
    if (!rejected) throw new Error('Incomplete Keycloak dump must fail the real restore control.');
    console.log('isolated backup restore controls passed: both schemas, exact counts, foreign keys, integrity and incomplete identity schema rejected');
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length) { console.log('Read-only mode. Use --run --latest or --run --backup-file /absolute/latest.sql.gz [--expected-counts /absolute/counts.json]. --self-test uses only synthetic data.'); return 0; }
  if (args.length === 1 && args[0] === '--self-test') { await selfTest(); return 0; }
  if (args[0] !== '--run') throw new Error('Explicit --run is required; a disposable local container will be created and removed.');
  const options = {};
  for (let index = 1; index < args.length; index++) {
    if (args[index] === '--latest') options.latest = true;
    else if (args[index] === '--backup-file' || args[index] === '--expected-counts') {
      if (!args[index + 1] || !isAbsolute(args[index + 1])) throw new Error('An absolute file path is required.');
      options[args[index] === '--backup-file' ? 'file' : 'expectedFile'] = args[++index];
    } else throw new Error('Unknown option; remote/database/target overrides are deliberately unsupported.');
  }
  if (Boolean(options.file) === Boolean(options.latest)) throw new Error('Choose exactly one explicit backup file or --latest.');
  let expected;
  if (options.expectedFile) {
    const info = await lstat(options.expectedFile);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 ** 2) throw new Error('Expected counts must be a small regular JSON file.');
    expected = JSON.parse(await readFile(options.expectedFile, 'utf8'));
    if (!expected || Array.isArray(expected) || typeof expected !== 'object') throw new Error('Expected counts must be a table/count object.');
  }
  console.log(JSON.stringify(await rehearse({ ...options, expected }), null, 2));
  return 0;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
