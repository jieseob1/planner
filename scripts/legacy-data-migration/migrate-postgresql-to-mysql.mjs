import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const sourceContainer = process.env.NOWLINE_LEGACY_POSTGRES_CONTAINER ?? 'nowline-local-postgres-1';
const sourceKubernetesPod = process.env.NOWLINE_LEGACY_POSTGRES_K8S_POD;
const sourceUser = process.env.NOWLINE_LEGACY_POSTGRES_USER ?? 'nowline';
const sourceDatabase = process.env.NOWLINE_LEGACY_POSTGRES_DB ?? 'nowline';
const targetContainer = process.env.NOWLINE_MYSQL_CONTAINER ?? 'nowline-local-mysql-1';
const targetKubernetesPod = process.env.NOWLINE_MYSQL_K8S_POD;
const kubernetesNamespace = process.env.NOWLINE_MIGRATION_K8S_NAMESPACE ?? 'nowline-local';
const targetUser = process.env.NOWLINE_MYSQL_USER ?? 'nowline';
const targetPassword = process.env.NOWLINE_MYSQL_PASSWORD ?? 'nowline-local-only';
const targetDatabase = process.env.NOWLINE_MYSQL_DB ?? 'nowline';

const tables = [
  'app_user',
  'planner_revision_clock',
  'planner_plan',
  'planner_aggregate',
  'planner_outcome',
  'planner_task',
  'planner_time_block',
  'planner_time_entry',
  'planner_timer',
  'planner_review_top_task',
  'planner_idempotency',
  'planner_audit_event',
  'google_oauth_state',
  'google_calendar_connection',
  'google_calendar_event_link',
  'google_calendar_watch_channel',
  'integration_job',
  'user_preference',
  'notification_device',
  'notification_delivery',
  'api_rate_limit'
];

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    ...options
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stderr || result.stdout || ''}`);
  }
  return result.stdout;
};

const postgres = (sql) => run(
  sourceKubernetesPod ? 'kubectl' : 'docker',
  sourceKubernetesPod
    ? ['--namespace', kubernetesNamespace, 'exec', sourceKubernetesPod, '--',
        'psql', '--username', sourceUser, '--dbname', sourceDatabase,
        '--quiet', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--command', sql]
    : ['exec', sourceContainer,
        'psql', '--username', sourceUser, '--dbname', sourceDatabase,
        '--quiet', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--command', sql]
).trim();

const mysql = (sql, input) => run(
  targetKubernetesPod ? 'kubectl' : 'docker',
  targetKubernetesPod
    ? ['--namespace', kubernetesNamespace, 'exec', '--stdin', targetKubernetesPod, '--',
        'env', `MYSQL_PWD=${targetPassword}`,
        'mysql', '--user', targetUser, '--database', targetDatabase,
        '--batch', '--skip-column-names', '--default-character-set=utf8mb4',
        ...(sql ? ['--execute', sql] : [])]
    : ['exec', '--env', `MYSQL_PWD=${targetPassword}`, '-i', targetContainer,
        'mysql', '--user', targetUser, '--database', targetDatabase,
        '--batch', '--skip-column-names', '--default-character-set=utf8mb4',
        ...(sql ? ['--execute', sql] : [])],
  input === undefined ? {} : { input }
).trim();

const identifier = (value) => {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `\`${value}\``;
};

const stringLiteral = (value) => value === ''
  ? "''"
  : `CONVERT(0x${Buffer.from(value, 'utf8').toString('hex')} USING utf8mb4)`;

const dateTimeLiteral = (value) => {
  const normalized = value
    .replace('T', ' ')
    .replace(/(?:Z|\+00(?::?00)?)$/, '');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(normalized)) {
    throw new Error(`Unsupported UTC timestamp: ${value}`);
  }
  return stringLiteral(normalized);
};

const sqlLiteral = (value, dataType) => {
  if (value === null || value === undefined) return 'NULL';
  if (dataType === 'datetime' || dataType === 'timestamp') return dateTimeLiteral(String(value));
  if (dataType === 'date') return stringLiteral(String(value).slice(0, 10));
  if (dataType === 'time') return stringLiteral(String(value));
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Non-finite numeric value: ${value}`);
    return String(value);
  }
  if (typeof value === 'object') return stringLiteral(JSON.stringify(value));
  return stringLiteral(String(value));
};

const targetColumns = new Map();
const schemaRows = mysql(`
  SELECT CONCAT(table_name, '|', column_name, '|', data_type)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND extra NOT LIKE '%GENERATED%'
  ORDER BY table_name, ordinal_position
`).split('\n').filter(Boolean);
for (const row of schemaRows) {
  const [table, column, dataType] = row.split('|');
  const columns = targetColumns.get(table) ?? [];
  columns.push({ column, dataType });
  targetColumns.set(table, columns);
}

const existingUsers = Number(mysql('SELECT COUNT(*) FROM app_user'));
if (existingUsers !== 0) {
  throw new Error(`Target MySQL app_user is not empty (${existingUsers} rows); refusing to merge into live data`);
}

const sourceRows = new Map();
for (const table of tables) {
  const json = postgres(`
    SET TIME ZONE 'UTC';
    SELECT COALESCE(json_agg(row_to_json(source_rows))::text, '[]')
    FROM (SELECT * FROM ${table}) AS source_rows;
  `);
  sourceRows.set(table, JSON.parse(json || '[]'));
}

const statements = ["SET time_zone = '+00:00';", 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;', 'START TRANSACTION;'];
for (const table of tables) {
  const rows = sourceRows.get(table);
  if (rows.length === 0) continue;
  const availableColumns = targetColumns.get(table);
  if (!availableColumns) throw new Error(`Target MySQL table is missing: ${table}`);
  const columns = availableColumns.filter(({ column }) => Object.hasOwn(rows[0], column));
  if (columns.length === 0) throw new Error(`No compatible columns for table ${table}`);
  for (const row of rows) {
    const values = columns.map(({ column, dataType }) => sqlLiteral(row[column], dataType));
    statements.push(
      `INSERT INTO ${identifier(table)} (${columns.map(({ column }) => identifier(column)).join(', ')}) `
      + `VALUES (${values.join(', ')});`
    );
  }
}
statements.push('COMMIT;');
mysql('', `${statements.join('\n')}\n`);

const counts = [];
for (const table of tables) {
  const sourceCount = sourceRows.get(table).length;
  const targetCount = Number(mysql(`SELECT COUNT(*) FROM ${identifier(table)}`));
  if (targetCount !== sourceCount) {
    throw new Error(`Row count mismatch for ${table}: source=${sourceCount}, target=${targetCount}`);
  }
  counts.push({ table, rows: targetCount });
}

const fingerprintQuery = `
  SELECT CONCAT_WS('|', u.user_id, u.oidc_subject, a.revision, a.annual_direction,
    a.quarter_focus,
    (SELECT COUNT(*) FROM planner_task t WHERE t.user_id = u.user_id),
    (SELECT COUNT(*) FROM planner_outcome o WHERE o.user_id = u.user_id),
    (SELECT COUNT(*) FROM planner_time_block b WHERE b.user_id = u.user_id))
  FROM app_user u
  JOIN planner_aggregate a ON a.user_id = u.user_id
  ORDER BY u.user_id;
`;
const sourceFingerprint = postgres(fingerprintQuery);
const targetFingerprint = mysql(fingerprintQuery);
if (sourceFingerprint !== targetFingerprint) {
  throw new Error(`Planner fingerprint mismatch\nsource=${sourceFingerprint}\ntarget=${targetFingerprint}`);
}

const evidenceHash = createHash('sha256')
  .update(JSON.stringify({ counts, targetFingerprint }))
  .digest('hex');

console.log(JSON.stringify({
  result: 'PostgreSQL to MySQL data migration passed',
  source: sourceKubernetesPod ? `${kubernetesNamespace}/pod/${sourceKubernetesPod}` : sourceContainer,
  target: targetKubernetesPod ? `${kubernetesNamespace}/pod/${targetKubernetesPod}` : targetContainer,
  counts,
  plannerFingerprint: targetFingerprint,
  evidenceSha256: evidenceHash
}, null, 2));
