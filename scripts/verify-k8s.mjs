import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const overlay = path.join(root, 'infra', 'k8s', 'overlays', 'local');

function runKubectl(args, input) {
  const result = spawnSync('kubectl', args, {
    cwd: root,
    encoding: 'utf8',
    input,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error) {
    throw new Error(`kubectl could not run: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`kubectl ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function keyFor(resource) {
  return `${resource.kind}/${resource.metadata?.name}`;
}

function get(resources, kind, name) {
  const result = resources.get(`${kind}/${name}`);
  assert(result, `missing ${kind}/${name}`);
  return result;
}

function namedContainer(workload, name) {
  const result = workload.spec?.template?.spec?.containers?.find((candidate) => candidate.name === name);
  assert(result, `${keyFor(workload)} is missing container ${name}`);
  return result;
}

function assertResources(container, label) {
  for (const group of ['requests', 'limits']) {
    assert(container.resources?.[group]?.cpu, `${label} is missing ${group}.cpu`);
    assert(container.resources?.[group]?.memory, `${label} is missing ${group}.memory`);
  }
}

function assertHttpProbes(container, paths, label) {
  for (const [probeName, expectedPath] of Object.entries(paths)) {
    const probe = container[probeName];
    assert(probe?.httpGet?.path === expectedPath, `${label} ${probeName} must call ${expectedPath}`);
    assert(probe.httpGet.port, `${label} ${probeName} is missing a port`);
    assert(Number.isInteger(probe.failureThreshold), `${label} ${probeName} needs a bounded failureThreshold`);
    assert(Number.isInteger(probe.timeoutSeconds), `${label} ${probeName} needs timeoutSeconds`);
  }
}

function assertExecProbes(container, label) {
  for (const probeName of ['startupProbe', 'readinessProbe', 'livenessProbe']) {
    const probe = container[probeName];
    assert(Array.isArray(probe?.exec?.command) && probe.exec.command.length > 0, `${label} ${probeName} must be executable`);
    assert(Number.isInteger(probe.failureThreshold), `${label} ${probeName} needs a bounded failureThreshold`);
    assert(Number.isInteger(probe.timeoutSeconds), `${label} ${probeName} needs timeoutSeconds`);
  }
}

function assertSafeRolling(deployment) {
  assert(deployment.spec?.strategy?.type === 'RollingUpdate', `${keyFor(deployment)} must use RollingUpdate`);
  assert(String(deployment.spec.strategy.rollingUpdate?.maxUnavailable) === '0', `${keyFor(deployment)} maxUnavailable must be 0`);
  assert(String(deployment.spec.strategy.rollingUpdate?.maxSurge) === '1', `${keyFor(deployment)} maxSurge must be 1`);
}

const rendered = runKubectl(['kustomize', overlay]);
const documents = rendered
  .split(/^---\s*$/m)
  .map((document) => document.trim())
  .filter(Boolean);

assert(documents.length >= 10, `expected at least 10 rendered Kubernetes objects, found ${documents.length}`);

const decoded = documents.map((document, index) => {
  const json = runKubectl(
    ['create', '--dry-run=client', '--validate=false', '--filename=-', '--output=json'],
    `${document}\n`
  );
  try {
    return JSON.parse(json);
  } catch (error) {
    throw new Error(`rendered document ${index + 1} did not decode as one Kubernetes object: ${error.message}`);
  }
});

const resources = new Map();
for (const resource of decoded) {
  assert(resource.apiVersion && resource.kind && resource.metadata?.name, 'every rendered document needs apiVersion, kind, and metadata.name');
  const key = keyFor(resource);
  assert(!resources.has(key), `duplicate rendered object ${key}`);
  resources.set(key, resource);

  if (resource.kind !== 'Namespace') {
    assert(resource.metadata.namespace === 'nowline-local', `${key} must be scoped to nowline-local`);
  }
}

const namespace = get(resources, 'Namespace', 'nowline-local');
assert(namespace.metadata.labels?.['pod-security.kubernetes.io/enforce'] === 'baseline', 'local namespace must enforce the baseline Pod Security profile');

const secret = get(resources, 'Secret', 'nowline-postgres');
for (const field of ['database', 'username', 'password']) {
  assert(typeof secret.data?.[field] === 'string' && secret.data[field].length > 0, `Secret/nowline-postgres is missing data.${field}`);
}

const postgresService = get(resources, 'Service', 'nowline-postgres');
assert(postgresService.spec?.clusterIP === 'None', 'PostgreSQL Service must be headless for StatefulSet identity');
assert(postgresService.spec?.ports?.some((port) => port.port === 5432), 'PostgreSQL Service must expose 5432');

const postgres = get(resources, 'StatefulSet', 'nowline-postgres');
assert(postgres.spec?.replicas === 1, 'PostgreSQL StatefulSet must have one local replica');
assert(postgres.spec?.serviceName === 'nowline-postgres', 'PostgreSQL StatefulSet must use its governing Service');
assert(postgres.spec?.persistentVolumeClaimRetentionPolicy?.whenDeleted === 'Retain', 'PostgreSQL PVC must be retained when the StatefulSet is deleted');
assert(postgres.spec?.updateStrategy?.type === 'RollingUpdate', 'PostgreSQL StatefulSet must use RollingUpdate');
const postgresClaim = postgres.spec?.volumeClaimTemplates?.find((claim) => claim.metadata?.name === 'data');
assert(postgresClaim?.spec?.resources?.requests?.storage === '5Gi', 'PostgreSQL must request the 5Gi data PVC');
const postgresContainer = namedContainer(postgres, 'postgres');
assertExecProbes(postgresContainer, 'postgres container');
assertResources(postgresContainer, 'postgres container');
for (const variable of ['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD']) {
  const env = postgresContainer.env?.find((entry) => entry.name === variable);
  assert(env?.valueFrom?.secretKeyRef?.name === 'nowline-postgres', `${variable} must come from the PostgreSQL Secret`);
}

const backendService = get(resources, 'Service', 'nowline-backend');
assert(backendService.spec?.type === 'ClusterIP', 'backend Service must be internal ClusterIP');
assert(backendService.spec?.ports?.some((port) => port.port === 8080), 'backend Service must expose 8080');

const backend = get(resources, 'Deployment', 'nowline-backend');
assert(backend.spec?.replicas === 2, 'backend Deployment must start with exactly two stateless replicas');
assertSafeRolling(backend);
assert(backend.spec?.template?.spec?.topologySpreadConstraints?.some((constraint) => constraint.topologyKey === 'kubernetes.io/hostname'), 'backend needs hostname topology spreading');
const backendVolumes = backend.spec?.template?.spec?.volumes ?? [];
assert(backendVolumes.every((volume) => volume.emptyDir), 'backend must remain stateless and use only emptyDir pod volumes');
const databaseWaiter = backend.spec?.template?.spec?.initContainers?.find((container) => container.name === 'wait-for-postgres');
assert(databaseWaiter?.image === 'nowline-backend:local', 'backend must reuse its local image for the PostgreSQL wait initContainer');
assert(databaseWaiter.command?.join(' ').includes('nc -z -w 2 nowline-postgres 5432'), 'backend initContainer must wait for PostgreSQL TCP readiness');
assertResources(databaseWaiter, 'backend PostgreSQL wait initContainer');
const backendContainer = namedContainer(backend, 'backend');
assert(backendContainer.image === 'nowline-backend:local', 'backend must use nowline-backend:local');
assertHttpProbes(backendContainer, {
  startupProbe: '/actuator/health/liveness',
  readinessProbe: '/actuator/health/readiness',
  livenessProbe: '/actuator/health/liveness'
}, 'backend container');
assertResources(backendContainer, 'backend container');
assert(backendContainer.env?.some((entry) => entry.name === 'SPRING_THREADS_VIRTUAL_ENABLED' && entry.value === 'true'), 'backend must enable Java virtual threads');
assert(backendContainer.env?.some((entry) => entry.name === 'SPRING_DATASOURCE_PASSWORD' && entry.valueFrom?.secretKeyRef?.name === 'nowline-postgres'), 'backend database password must come from the Secret');

const frontendService = get(resources, 'Service', 'nowline-frontend');
assert(frontendService.spec?.type === 'ClusterIP', 'frontend Service must be internal ClusterIP');
assert(frontendService.spec?.ports?.some((port) => port.port === 80), 'frontend Service must expose port 80');

const frontend = get(resources, 'Deployment', 'nowline-frontend');
assert(frontend.spec?.replicas >= 1, 'frontend Deployment needs at least one replica');
assertSafeRolling(frontend);
assert(frontend.spec?.template?.spec?.topologySpreadConstraints?.some((constraint) => constraint.topologyKey === 'kubernetes.io/hostname'), 'frontend needs hostname topology spreading');
const frontendContainer = namedContainer(frontend, 'frontend');
assert(frontendContainer.image === 'nowline-frontend:local', 'frontend must use nowline-frontend:local');
assertHttpProbes(frontendContainer, {
  startupProbe: '/healthz',
  readinessProbe: '/healthz',
  livenessProbe: '/healthz'
}, 'frontend container');
assertResources(frontendContainer, 'frontend container');

const hpa = get(resources, 'HorizontalPodAutoscaler', 'nowline-backend');
assert(hpa.apiVersion === 'autoscaling/v2', 'backend HPA must use autoscaling/v2');
assert(hpa.metadata.annotations?.['nowline.dev/metrics-server-required'] === 'true', 'backend HPA must declare its Metrics Server dependency');
assert(hpa.spec?.scaleTargetRef?.kind === 'Deployment' && hpa.spec.scaleTargetRef.name === 'nowline-backend', 'backend HPA must target the backend Deployment');
assert(hpa.spec?.minReplicas === 2 && hpa.spec?.maxReplicas === 6, 'backend HPA range must be 2..6 replicas');
assert(hpa.spec?.metrics?.some((metric) => metric.type === 'Resource' && metric.resource?.name === 'cpu' && metric.resource?.target?.type === 'Utilization'), 'backend HPA must use CPU utilization metrics');

const pdb = get(resources, 'PodDisruptionBudget', 'nowline-backend');
assert(String(pdb.spec?.minAvailable) === '1', 'backend PDB must keep at least one replica available');
assert(pdb.spec?.selector?.matchLabels?.['app.kubernetes.io/component'] === 'backend', 'backend PDB selector must target backend pods');

for (const workload of [postgres, backend, frontend]) {
  for (const container of workload.spec?.template?.spec?.containers ?? []) {
    assert(!container.image.endsWith(':latest'), `${keyFor(workload)} must not use a latest image tag`);
  }
  for (const volume of workload.spec?.template?.spec?.volumes ?? []) {
    assert(!volume.hostPath, `${keyFor(workload)} must not use hostPath volumes`);
  }
}

for (const service of [postgresService, backendService, frontendService]) {
  assert(!['LoadBalancer', 'NodePort'].includes(service.spec?.type), `${keyFor(service)} must not expose the local cluster externally`);
}

console.log(`validated ${resources.size} rendered Kubernetes objects`);
console.log('local Kubernetes configuration verified');
