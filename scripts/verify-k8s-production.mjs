import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const overlay = path.join(root, 'infra', 'k8s', 'overlays', 'production');
const run = (args, input) => {
  const result = spawnSync('kubectl', args, { cwd: root, input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
};
const assert = (value, message) => { if (!value) throw new Error(message); };
const rendered = run(['kustomize', overlay]);
const yamlDocuments = rendered.split(/^---\s*$/m).map((value) => value.trim()).filter(Boolean);
const documents = yamlDocuments
  .filter((yaml) => !yaml.startsWith('apiVersion: monitoring.coreos.com/'))
  .map((yaml) => JSON.parse(run(['create', '--dry-run=client', '--validate=false', '-f', '-', '-o', 'json'], `${yaml}\n`)));
const find = (kind, name) => documents.find((item) => item.kind === kind && item.metadata?.name === name);
const migration = JSON.parse(run([
  'create', '--dry-run=client', '--validate=false', '-f',
  path.join(overlay, 'migration-job.yaml'), '-o', 'json'
]));

assert(!documents.some((item) => item.kind === 'StatefulSet'), 'production must not bundle a single-node database');
assert(!find('Service', 'nowline-mysql'), 'production must use an external HA MySQL service');
assert(find('Ingress', 'nowline')?.spec?.tls?.[0]?.secretName === 'nowline-tls', 'TLS ingress is required');
assert(find('NetworkPolicy', 'default-deny'), 'default-deny NetworkPolicy is required');
assert(documents.filter((item) => item.kind === 'NetworkPolicy').length >= 4, 'explicit network allow rules are required');
assert(rendered.includes('kind: ServiceMonitor') && rendered.includes('kind: PrometheusRule'), 'production monitoring resources are required');

for (const name of ['nowline-backend', 'nowline-frontend']) {
  const deployment = find('Deployment', name);
  assert(deployment, `${name} deployment missing`);
  assert(deployment.spec.template.spec.automountServiceAccountToken === false, `${name} must not mount API credentials`);
  assert(deployment.spec.template.spec.serviceAccountName === name, `${name} must use a dedicated service account`);
  const container = deployment.spec.template.spec.containers[0];
  assert(!container.image.endsWith(':local') && !container.image.endsWith(':latest'), `${name} image must be versioned`);
  assert(container.securityContext?.readOnlyRootFilesystem === true, `${name} root filesystem must be read-only`);
}

const backend = find('Deployment', 'nowline-backend');
assert(!backend.spec.template.spec.initContainers, 'production must not wait for the local MySQL service');
const env = Object.fromEntries(backend.spec.template.spec.containers[0].env.map((item) => [item.name, item]));
for (const required of [
  'SPRING_DATASOURCE_URL', 'NOWLINE_OIDC_ISSUER', 'NOWLINE_GOOGLE_CLIENT_SECRET',
  'NOWLINE_INTEGRATION_ENCRYPTION_KEY_BASE64', 'NOWLINE_VAPID_PRIVATE_KEY'
]) {
  assert(env[required]?.valueFrom?.secretKeyRef?.name === 'nowline-production-secrets', `${required} must come from production Secret`);
}
assert(!rendered.includes('NOWLINE_DEV_JWT_SECRET'), 'production must never configure development JWT signing');
assert(migration.kind === 'Job' && migration.metadata?.name === 'nowline-migrate', 'migration Job contract is required');
const migrationEnv = Object.fromEntries(migration.spec.template.spec.containers[0].env.map((item) => [item.name, item]));
assert(migrationEnv.NOWLINE_MIGRATION_ONLY?.value === 'true', 'migration Job must exit after Flyway completes');
assert(env.SPRING_FLYWAY_ENABLED?.value === 'false', 'application pods must not race production migrations');
console.log('production Kubernetes manifest verification passed');
