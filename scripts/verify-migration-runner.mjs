import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const suffix = randomUUID().slice(0, 8);
const network = `nowline-migration-${suffix}`;
const databaseContainer = `nowline-migration-db-${suffix}`;
const image = `nowline-backend:migration-${suffix}`;
const backendDirectory = resolve('backend');
const databasePassword = 'nowline-migration-only';

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

const mysql = (sql) => run('docker', [
  'exec', '--env', `MYSQL_PWD=${databasePassword}`, databaseContainer,
  'mysql', '--user=nowline', '--database=nowline', '--batch', '--skip-column-names', '--execute', sql
]).trim();

const migrationEnvironment = [
  '--env', 'SPRING_PROFILES_ACTIVE=local-auth',
  '--env', 'SPRING_MAIN_WEB_APPLICATION_TYPE=none',
  '--env', `SPRING_DATASOURCE_URL=jdbc:mysql://${databaseContainer}:3306/nowline?useUnicode=true&characterEncoding=utf8&connectionCollation=utf8mb4_0900_as_ci&serverTimezone=UTC&preserveInstants=true`,
  '--env', 'SPRING_DATASOURCE_USERNAME=nowline',
  '--env', `SPRING_DATASOURCE_PASSWORD=${databasePassword}`,
  '--env', 'NOWLINE_DEV_JWT_SECRET=nowline-migration-verifier-secret-32-bytes',
  '--env', 'NOWLINE_WORKERS_ENABLED=false',
  '--env', 'NOWLINE_MIGRATION_ONLY=true'
];

const runMigration = () => {
  const startedAt = performance.now();
  run('docker', ['run', '--rm', '--network', network, ...migrationEnvironment, image]);
  return (performance.now() - startedAt) / 1000;
};

try {
  run(resolve(backendDirectory, 'mvnw'), ['-q', '-DskipTests', 'package'], { cwd: backendDirectory });

  run('docker', ['network', 'create', network]);
  run('docker', [
    'run', '--detach', '--name', databaseContainer, '--network', network,
    '--env', 'MYSQL_DATABASE=nowline',
    '--env', 'MYSQL_USER=nowline',
    '--env', `MYSQL_PASSWORD=${databasePassword}`,
    '--env', `MYSQL_ROOT_PASSWORD=${databasePassword}-root`,
    'mysql:8.4.10',
    '--character-set-server=utf8mb4',
    '--collation-server=utf8mb4_0900_as_ci',
    '--default-time-zone=+00:00',
    '--log-bin-trust-function-creators=1'
  ]);

  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const check = spawnSync('docker', [
      'exec', '--env', `MYSQL_PWD=${databasePassword}`, databaseContainer,
      'mysqladmin', 'ping', '-h', '127.0.0.1', '-u', 'nowline', '--silent'
    ]);
    if (check.status === 0) {
      ready = true;
      break;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  if (!ready) throw new Error('MySQL migration target did not become ready within 60 seconds');

  run('docker', ['build', '--tag', image, backendDirectory]);
  const firstElapsedSeconds = runMigration();
  const firstHistory = mysql(`
    SELECT CONCAT(version, '|', checksum, '|', success)
    FROM flyway_schema_history
    WHERE type = 'SQL'
    ORDER BY installed_rank
  `);
  const version = mysql(`
    SELECT version FROM flyway_schema_history
    WHERE success = true ORDER BY installed_rank DESC LIMIT 1
  `);
  if (version !== '8') throw new Error(`Migration runner stopped at unexpected Flyway version: ${version}`);
  if (firstHistory.split('\n').filter(Boolean).length !== 8) {
    throw new Error(`Expected 8 successful SQL migrations, got:\n${firstHistory}`);
  }

  const secondElapsedSeconds = runMigration();
  const secondHistory = mysql(`
    SELECT CONCAT(version, '|', checksum, '|', success)
    FROM flyway_schema_history
    WHERE type = 'SQL'
    ORDER BY installed_rank
  `);
  if (secondHistory !== firstHistory) {
    throw new Error(`Flyway restart changed migration history or checksums\nbefore=${firstHistory}\nafter=${secondHistory}`);
  }
  const failedCount = Number(mysql('SELECT COUNT(*) FROM flyway_schema_history WHERE success = false'));
  if (failedCount !== 0) throw new Error(`Flyway history contains ${failedCount} failed migrations`);

  console.log(JSON.stringify({
    result: 'production migration runner verification passed',
    flywayVersion: version,
    migrationCount: 8,
    restartChecksumsStable: true,
    firstElapsedSeconds: Number(firstElapsedSeconds.toFixed(2)),
    secondElapsedSeconds: Number(secondElapsedSeconds.toFixed(2))
  }, null, 2));
} finally {
  spawnSync('docker', ['rm', '--force', databaseContainer], { stdio: 'ignore' });
  spawnSync('docker', ['network', 'rm', network], { stdio: 'ignore' });
  spawnSync('docker', ['image', 'rm', '--force', image], { stdio: 'ignore' });
}
