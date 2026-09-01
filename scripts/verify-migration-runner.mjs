import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const suffix = randomUUID().slice(0, 8);
const network = `nowline-migration-${suffix}`;
const databaseContainer = `nowline-migration-db-${suffix}`;
const image = `nowline-backend:migration-${suffix}`;
const backendDirectory = resolve('backend');

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

try {
  run(resolve(backendDirectory, 'mvnw'), ['-q', '-DskipTests', 'package'], { cwd: backendDirectory });

  run('docker', ['network', 'create', network]);
  run('docker', [
    'run', '--detach', '--name', databaseContainer, '--network', network,
    '--env', 'POSTGRES_PASSWORD=nowline-migration-only',
    '--env', 'POSTGRES_DB=nowline',
    'postgres:17-alpine'
  ]);

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const check = spawnSync('docker', [
      'exec', databaseContainer, 'psql', '-U', 'postgres', '-d', 'nowline', '-Atc', 'SELECT 1'
    ]);
    if (check.status === 0) {
      ready = true;
      break;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  if (!ready) throw new Error('PostgreSQL migration target did not become ready within 30 seconds');

  run('docker', ['build', '--tag', image, backendDirectory]);
  const startedAt = performance.now();
  run('docker', [
    'run', '--rm', '--network', network,
    '--env', 'SPRING_PROFILES_ACTIVE=local-auth',
    '--env', 'SPRING_MAIN_WEB_APPLICATION_TYPE=none',
    '--env', 'SPRING_DATASOURCE_URL=jdbc:postgresql://' + databaseContainer + ':5432/nowline',
    '--env', 'SPRING_DATASOURCE_USERNAME=postgres',
    '--env', 'SPRING_DATASOURCE_PASSWORD=nowline-migration-only',
    '--env', 'NOWLINE_DEV_JWT_SECRET=nowline-migration-verifier-secret-32-bytes',
    '--env', 'NOWLINE_WORKERS_ENABLED=false',
    '--env', 'NOWLINE_MIGRATION_ONLY=true',
    image
  ]);
  const elapsedSeconds = (performance.now() - startedAt) / 1000;

  const version = run('docker', [
    'exec', databaseContainer, 'psql', '-U', 'postgres', '-d', 'nowline', '-Atc',
    'SELECT version FROM flyway_schema_history WHERE success = true ORDER BY installed_rank DESC LIMIT 1'
  ]).trim();
  if (version !== '7') throw new Error(`Migration runner stopped at unexpected Flyway version: ${version}`);

  console.log(JSON.stringify({
    result: 'production migration runner verification passed',
    flywayVersion: version,
    elapsedSeconds: Number(elapsedSeconds.toFixed(2))
  }, null, 2));
} finally {
  spawnSync('docker', ['rm', '--force', databaseContainer], { stdio: 'ignore' });
  spawnSync('docker', ['network', 'rm', network], { stdio: 'ignore' });
  spawnSync('docker', ['image', 'rm', '--force', image], { stdio: 'ignore' });
}
