import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const suffix = randomUUID().slice(0, 8);
const container = `nowline-recovery-${suffix}`;
const volume = `nowline-recovery-${suffix}`;
const database = 'nowline_recovery';
const restoredDatabase = 'nowline_restored';
const tempDirectory = mkdtempSync(join(tmpdir(), 'nowline-recovery-'));
const dumpPath = join(tempDirectory, 'nowline.dump');

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stderr || result.stdout || ''}`);
  }
  return result.stdout;
};

const psql = (target, sql) => run('docker', [
  'exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', target, '-At'
], { input: sql });

try {
  run('docker', ['volume', 'create', volume]);
  run('docker', [
    'run', '--detach', '--name', container,
    '--env', 'POSTGRES_PASSWORD=nowline-recovery-only',
    '--env', `POSTGRES_DB=${database}`,
    '--volume', `${volume}:/var/lib/postgresql/data`,
    'postgres:17-alpine'
  ]);

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const check = spawnSync('docker', [
      'exec', container, 'psql', '-U', 'postgres', '-d', database, '-Atc', 'SELECT 1'
    ]);
    if (check.status === 0) {
      ready = true;
      break;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  if (!ready) throw new Error('PostgreSQL recovery drill did not become ready within 30 seconds');

  const migrationDirectory = resolve('backend/src/main/resources/db/migration');
  const migrations = readdirSync(migrationDirectory)
    .filter((file) => /^V\d+__.+\.sql$/.test(file))
    .toSorted((left, right) => Number(left.match(/^V(\d+)/)?.[1]) - Number(right.match(/^V(\d+)/)?.[1]))
    .map((file) => `\n-- ${file}\n${readFileSync(join(migrationDirectory, file), 'utf8')}\n`)
    .join('');
  psql(database, migrations);

  const userId = '88f29484-af50-5b9d-98b6-b247e68f679c';
  const planId = 'fb353dae-d288-4b00-88af-ad088265a705';
  psql(database, `
    INSERT INTO app_user (user_id, oidc_issuer, oidc_subject, email, display_name,
      terms_accepted_at, privacy_accepted_at, policy_version)
    VALUES ('${userId}', 'https://recovery.invalid', 'recovery-user', 'restore@example.invalid',
      'Recovery Drill', now(), now(), '2026-09-01');
    INSERT INTO planner_revision_clock (user_id, last_revision) VALUES ('${userId}', 7);
    INSERT INTO planner_plan (plan_id, user_id, title, plan_year, plan_quarter, status, source_revision, activated_at)
    VALUES ('${planId}', '${userId}', '복구 훈련 계획', 2026, 3, 'ACTIVE', 7, now());
    INSERT INTO planner_aggregate (
      user_id, revision, snapshot_version, planner_week_offset, plan_year, annual_direction,
      plan_quarter, quarter_focus, quarter_end_date, review_metric_draft, plan_id
    ) VALUES (
      '${userId}', 7, 1, 0, 2026, '복구 훈련 데이터', 3, '백업 무결성 검증', '2026-09-30', '', '${planId}'
    );
  `);

  const fingerprintQuery = `
    SELECT concat_ws('|', u.user_id, u.oidc_subject, u.policy_version,
      p.revision, p.annual_direction, p.quarter_focus)
    FROM app_user u JOIN planner_aggregate p USING (user_id)
    WHERE u.user_id = '${userId}';
  `;
  const before = psql(database, fingerprintQuery).trim();
  const dumpStartedAt = performance.now();
  const dump = spawnSync('docker', ['exec', container, 'pg_dump', '-Fc', '-U', 'postgres', '-d', database], {
    encoding: null,
    maxBuffer: 64 * 1024 * 1024
  });
  if (dump.status !== 0) throw new Error(`pg_dump failed\n${dump.stderr?.toString() ?? ''}`);
  writeFileSync(dumpPath, dump.stdout);
  const backupSeconds = (performance.now() - dumpStartedAt) / 1000;

  run('docker', ['exec', container, 'createdb', '-U', 'postgres', restoredDatabase]);
  const restoreStartedAt = performance.now();
  const restore = spawnSync('docker', ['exec', '-i', container, 'pg_restore',
    '--exit-on-error', '--no-owner', '-U', 'postgres', '-d', restoredDatabase], {
    input: readFileSync(dumpPath),
    encoding: null,
    maxBuffer: 64 * 1024 * 1024
  });
  if (restore.status !== 0) throw new Error(`pg_restore failed\n${restore.stderr?.toString() ?? ''}`);
  const restoreSeconds = (performance.now() - restoreStartedAt) / 1000;
  const after = psql(restoredDatabase, fingerprintQuery).trim();

  if (!before || before !== after) throw new Error(`Restored data mismatch: before=${before}, after=${after}`);
  if (restoreSeconds > 120) throw new Error(`Local restore RTO exceeded 120 seconds: ${restoreSeconds.toFixed(2)}s`);

  console.log(JSON.stringify({
    result: 'production recovery drill passed',
    snapshotRpo: '0 rows lost',
    backupSeconds: Number(backupSeconds.toFixed(2)),
    restoreSeconds: Number(restoreSeconds.toFixed(2)),
    restoredFingerprint: after
  }, null, 2));
} finally {
  spawnSync('docker', ['rm', '--force', container], { stdio: 'ignore' });
  spawnSync('docker', ['volume', 'rm', '--force', volume], { stdio: 'ignore' });
  rmSync(tempDirectory, { recursive: true, force: true });
}
