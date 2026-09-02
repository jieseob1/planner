import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sshBase = [
  '-o', 'BatchMode=yes',
  '-o', 'IdentitiesOnly=yes',
  '-o', 'ConnectTimeout=10',
  '-i', `${process.env.HOME}/.ssh/id_ed25519`,
  'mac-mini'
];
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 360_000,
    maxBuffer: 32 * 1024 * 1024,
    ...options
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };

run(process.execPath, ['scripts/verify-local-beta-runtime.mjs'], {
  env: { ...process.env, NOWLINE_BETA_URL: 'https://goalstotoday.com', NOWLINE_BETA_VERIFY_TIMEOUT_MS: '300000' },
  stdio: 'inherit'
});

const deployments = JSON.parse(run('ssh', [
  ...sshBase,
  'PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin kubectl --context kind-nowline-local --namespace nowline-local get deployments --output=json'
]));
const byName = new Map(deployments.items.map((item) => [item.metadata.name, item]));
for (const [name, minimum] of [['nowline-backend', 2], ['nowline-frontend', 2], ['nowline-keycloak', 1]]) {
  const deployment = byName.get(name);
  assert(deployment, `${name} deployment is missing`);
  assert((deployment.status.readyReplicas ?? 0) >= minimum, `${name} has ${deployment.status.readyReplicas ?? 0} Ready replicas`);
}

const envMap = (deployment) => Object.fromEntries(
  (deployment.spec.template.spec.containers[0].env ?? []).map((entry) => [entry.name, entry.value])
);
assert(envMap(byName.get('nowline-backend')).NOWLINE_OIDC_ISSUER === 'https://goalstotoday.com/idp/realms/nowline', 'Backend issuer is not the public domain');
assert(envMap(byName.get('nowline-keycloak')).KC_HOSTNAME === 'https://goalstotoday.com/idp', 'Keycloak hostname is not the public domain');

for (const label of ['com.nowline.local-beta', 'com.goalstotoday.tunnel']) {
  const launchDaemon = run('ssh', [
    ...sshBase,
    `launchctl print "system/${label}"`
  ]);
  assert(launchDaemon.includes('state = running'), `${label} headless LaunchDaemon is not running`);
}

console.log('Goals to Today Mac mini Kubernetes runtime verified');
