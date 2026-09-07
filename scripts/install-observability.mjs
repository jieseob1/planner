import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildStack, renderStack, namespace, context } from '../infra/observability/stack.mjs';
import { kubeletTlsPlan } from '../infra/observability/kubelet-trust.mjs';

const args = process.argv.slice(2);
assert(args.every((arg, i) => ['--apply', '--context', '--render'].includes(arg) || args[i - 1] === '--context'), 'Unknown argument');
assert(!(args.includes('--apply') && args.includes('--render')), 'Choose --apply or --render');
if (!args.includes('--apply')) {
  if (args.includes('--render')) console.log(renderStack());
  else console.log('Read-only mode. Use --render to inspect manifests or --apply --context kind-nowline-local to install. Provision OAuth identities first.');
} else {
  assert.equal(args[args.indexOf('--context') + 1], context, 'Explicit --context kind-nowline-local is required');
  function kube(arguments_, input) {
    const result = spawnSync('kubectl', ['--context', context, ...arguments_], {encoding: 'utf8', input, timeout: 180000, maxBuffer: 16 * 1024 * 1024});
    assert.equal(result.status, 0, `kubectl ${arguments_.slice(0, 2).join(' ')} failed (output suppressed to protect credentials)`);
    return result.stdout;
  }
  const nodes = JSON.parse(kube(['get', 'nodes', '-o', 'json'])).items;
  assert.equal(nodes.length, 1, 'This bounded budget is for the existing one-node kind cluster');
  assert(nodes.every(node => node.metadata.labels['kubernetes.io/arch'] === 'arm64'), 'Expected ARM64 nodes');
  assert(JSON.parse(kube(['get', 'storageclass', 'standard', '-o', 'json'])).metadata.name === 'standard');
  for (const [name, keys] of [['nowline-prometheus-oauth', ['client-secret']], ['nowline-grafana-oauth', ['client-secret', 'session-secret']]]) {
    const secret = JSON.parse(kube(['-n', namespace, 'get', 'secret', name, '-o', 'json']));
    for (const key of keys) assert(secret.data?.[key] && Buffer.from(secret.data[key], 'base64').length >= 24, `${name}/${key} missing or too short; run identity provisioning`);
  }
  const nodeName = nodes[0].metadata.name;
  assert.match(nodeName, /^nowline-local-[a-z0-9-]+$/, 'Unexpected kind node name');
  // Trust the serving certificate obtained over the operator's existing local
  // Docker control socket. This reads public certificates, never a private key.
  const certificate = spawnSync('docker', ['exec', nodeName, 'cat', '/var/lib/kubelet/pki/kubelet.crt'], {encoding: 'utf8', timeout: 10000});
  assert.equal(certificate.status, 0, 'Cannot read kind kubelet serving certificate');
  const clusterCa = JSON.parse(kube(['-n', 'nowline-local', 'get', 'configmap', 'kube-root-ca.crt', '-o', 'json'])).data['ca.crt'];
  const items = buildStack();
  const promConfig = items.find(item => item.kind === 'ConfigMap' && item.metadata.name === 'nowline-prometheus');
  const tls = kubeletTlsPlan(nodes[0], certificate.stdout, clusterCa, promConfig.data['prometheus.yml'], promConfig.data['rules.yml']);
  promConfig.data['prometheus.yml'] = tls.renderedConfig;
  items.splice(1, 0, {apiVersion: 'v1', kind: 'ConfigMap', metadata: {name: 'nowline-kubelet-ca', namespace}, data: {'ca.crt': tls.trustBundle}});
  const annotations = items.find(item => item.kind === 'Deployment' && item.metadata.name === 'nowline-prometheus').spec.template.metadata.annotations;
  annotations['nowline.dev/kubelet-ca-sha256'] = tls.trustChecksum;
  annotations['nowline.dev/config-sha256'] = tls.configChecksum;
  console.log(`Kubelet TLS verified using ${tls.serverName ? 'exact node DNS SAN' : 'node IP SAN'}; direct HTTPS with certificate verification enabled`);
  const manifest = JSON.stringify({apiVersion: 'v1', kind: 'List', items});
  kube(['apply', '--server-side', '--dry-run=server', '--field-manager=nowline-observability', '-f', '-'], manifest);
  kube(['apply', '--server-side', '--field-manager=nowline-observability', '-f', '-'], manifest);
  for (const object of buildStack().filter(item => ['Deployment', 'DaemonSet'].includes(item.kind))) {
    kube(['-n', namespace, 'rollout', 'status', `${object.kind.toLowerCase()}/${object.metadata.name}`, '--timeout=180s']);
    console.log(`${object.metadata.name} rollout ready`);
  }
  console.log('Observability workloads installed; run verify-observability.mjs --runtime for data and authentication evidence.');
}
