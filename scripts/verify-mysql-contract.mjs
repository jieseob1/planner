import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const trackedFiles = execFileSync('git', ['ls-files', '-z'], { cwd: root })
  .toString('utf8')
  .split('\0')
  .filter(Boolean)
  .filter((file) => existsSync(resolve(root, file)));

const runtimeFiles = trackedFiles.filter((file) => (
  file === 'compose.yaml'
  || file === 'Makefile'
  || file === 'package.json'
  || file === 'package-lock.json'
  || file === 'backend/pom.xml'
  || file.startsWith('backend/src/main/')
  || file.startsWith('backend/src/test/')
  || file.startsWith('infra/k8s/')
  || file.startsWith('.github/workflows/')
  || (file.startsWith('scripts/')
    && !file.startsWith('scripts/legacy-data-migration/')
    && file !== 'scripts/verify-mysql-contract.mjs')
));

const forbiddenRuntimePatterns = [
  ['PostgreSQL runtime reference', /\bpostgres(?:ql)?\b/i],
  ['PostgreSQL JDBC URL', /jdbc:postgresql/i],
  ['PostgreSQL default port', /\b5432\b/],
  ['PostgreSQL CLI or dump tool', /\b(?:psql|pg_dump|pg_restore|pg_isready)\b/i],
  ['PostgreSQL conflict syntax', /\bON\s+CONFLICT\b/i],
  ['PostgreSQL returning syntax', /\bRETURNING\b/i],
  ['PostgreSQL JSON type', /\bjsonb\b/i],
  ['PostgreSQL timestamp type', /\btimestamptz\b/i],
  ['PostgreSQL cast syntax', /::(?:uuid|jsonb?|timestamptz?|date|text)\b/i],
  ['PostgreSQL advisory lock', /\bpg_(?:try_)?advisory_/i]
];

const failures = [];
for (const file of runtimeFiles) {
  const source = read(file);
  for (const [label, pattern] of forbiddenRuntimePatterns) {
    const match = pattern.exec(source);
    if (!match) continue;
    const line = source.slice(0, match.index).split('\n').length;
    failures.push(`${file}:${line} ${label}: ${match[0]}`);
  }
}

const currentDocs = [
  'README.md',
  'backend/README.md',
  'docs/BACKEND_ARCHITECTURE.md',
  'docs/FEATURE_QA_MATRIX.md',
  'docs/OPERATIONS_RUNBOOK.md',
  'docs/PRODUCTION_SETUP.md',
  'infra/README.md'
];
const forbiddenDocumentationPatterns = [
  ['PostgreSQL JDBC URL', /jdbc:postgresql/i],
  ['PostgreSQL container image', /\bpostgres:\d/i],
  ['PostgreSQL default port', /\b5432\b/],
  ['PostgreSQL operational tool', /\b(?:psql|pg_dump|pg_restore|pg_isready)\b/i],
  ['PostgreSQL production service', /managed PostgreSQL|관리형 PostgreSQL/i]
];
for (const file of currentDocs) {
  const source = read(file);
  for (const [label, pattern] of forbiddenDocumentationPatterns) {
    const match = pattern.exec(source);
    if (!match) continue;
    const line = source.slice(0, match.index).split('\n').length;
    failures.push(`${file}:${line} ${label}: ${match[0]}`);
  }
}

const requireText = (file, values) => {
  const source = read(file);
  for (const value of values) {
    if (!source.includes(value)) failures.push(`${file} is missing MySQL contract: ${value}`);
  }
};

requireText('backend/pom.xml', ['flyway-mysql', 'mysql-connector-j', 'testcontainers-mysql']);
requireText('backend/src/main/resources/application.yml', [
  'jdbc:mysql:', 'serverTimezone=UTC', 'preserveInstants=true',
  'transaction-isolation: TRANSACTION_READ_COMMITTED'
]);
requireText('backend/src/main/resources/db/migration/V1__create_planner_schema.sql', [
  'ENGINE=InnoDB', 'CHARACTER SET utf8mb4', 'utf8mb4_bin'
]);
requireText('backend/src/main/java/io/nowline/planner/config/DatabaseWriteExecutor.java', [
  'TransientDataAccessException', 'MAX_ATTEMPTS = 3', 'PROPAGATION_REQUIRES_NEW'
]);
requireText('backend/src/main/java/io/nowline/planner/persistence/PlannerRepository.java', ['FOR UPDATE']);
requireText('backend/src/main/java/io/nowline/planner/integration/calendar/CalendarIntegrationRepository.java', [
  'FOR UPDATE SKIP LOCKED'
]);
requireText('backend/src/main/java/io/nowline/planner/notification/NotificationRepository.java', [
  'FOR UPDATE SKIP LOCKED'
]);
requireText('compose.yaml', [
  'mysql:8.4.10', '--character-set-server=utf8mb4', '--collation-server=utf8mb4_0900_as_ci',
  '--default-time-zone=+00:00', 'nowline-mysql-data'
]);
requireText('infra/k8s/base/mysql.yaml', [
  'mysql:8.4.10', 'persistentVolumeClaimRetentionPolicy', 'nowline-mysql', '3306'
]);
requireText('scripts/verify-recovery.mjs', ['mysqldump', 'MySQL 8.4', 'restoredFingerprint']);
requireText('scripts/verify-migration-runner.mjs', ['mysql:8.4.10', 'restartChecksumsStable']);
requireText('scripts/verify-production-reliability.mjs', ['mysql:8.4.10']);

if (failures.length > 0) {
  throw new Error(`MySQL production contract failed:\n${failures.join('\n')}`);
}

console.log(`MySQL production contract verified (${runtimeFiles.length} runtime/test files, ${currentDocs.length} current docs)`);
