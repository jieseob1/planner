import { spawnSync } from 'node:child_process';

const repositoryRoot = new URL('..', import.meta.url).pathname;
const environment = { ...process.env, NOWLINE_BETA_URL: 'http://localhost:4189' };

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: environment,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: 'inherit',
    ...options
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
  return result.stdout;
};

if (process.env.NOWLINE_K8S_SKIP_BUILD !== 'true') {
  run('scripts/k8s-local.sh', ['up']);
}
run('scripts/k8s-beta-server.sh', ['start']);
run(process.execPath, ['scripts/verify-local-beta-runtime.mjs']);

const context = process.env.NOWLINE_KUBE_CONTEXT || run('kubectl', ['config', 'current-context'], { stdio: 'pipe' }).trim();
const deployment = JSON.parse(run('kubectl', [
  '--context', context,
  '--namespace', 'nowline-local',
  'get', 'deployment', 'nowline-backend',
  '--output=json'
], { stdio: 'pipe' }));
if ((deployment.status?.readyReplicas ?? 0) < 2) {
  throw new Error(`Expected two ready backend replicas, got ${deployment.status?.readyReplicas ?? 0}`);
}

const keycloak = JSON.parse(run('kubectl', [
  '--context', context,
  '--namespace', 'nowline-local',
  'get', 'deployment', 'nowline-keycloak',
  '--output=json'
], { stdio: 'pipe' }));
if ((keycloak.status?.readyReplicas ?? 0) < 1) throw new Error('Keycloak is not Ready');

console.log('local Kubernetes beta runtime verified');
