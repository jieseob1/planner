import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { spawnSync } from 'node:child_process';
import { components, imageRepository, imageTag, validateRelease, verifyImage, verifyWorkloads } from './mac-mini-release.mjs';

const revision = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;
const otherDigest = `sha256:${'c'.repeat(64)}`;
const images = Object.fromEntries(components.map((name) => [name, `${imageRepository(name)}@${digest}`]));
const fixture = () => ({
  release: { revision, images: Object.fromEntries(components.map((c) => [c, { tag: imageTag(c, revision), configDigest: otherDigest, nodeDigests: [digest] }])) },
  deployments: { items: components.map((c) => ({
    metadata: { name: `nowline-${c}`, generation: 3 },
    spec: { replicas: 2, selector: { matchLabels: { component: c } }, template: {
      metadata: { annotations: { 'nowline.dev/revision': revision } }, spec: { containers: [{ name: c, image: imageTag(c, revision) }] },
    } },
    status: { observedGeneration: 3, readyReplicas: 2, updatedReplicas: 2 },
  })) },
  pods: { items: components.flatMap((c) => [0, 1].map((i) => ({
    metadata: { name: `${c}-${i}`, labels: { component: c } },
    spec: { containers: [{ name: c, image: imageTag(c, revision) }] },
    status: { conditions: [{ type: 'Ready', status: 'True' }], containerStatuses: [{ name: c, ready: true, imageID: `${imageRepository(c)}@${digest}` }] },
  }))) },
});
test('accept only full commit SHAs and repository-scoped digests', () => {
  validateRelease(revision, images);
  assert.throws(() => validateRelease('main', images));
  assert.throws(() => validateRelease(revision, { ...images, backend: 'attacker/image:latest' }));
  assert.throws(() => validateRelease(revision, { ...images, frontend: `${imageRepository('frontend')}:latest` }));
});
test('image platform and embedded revision must match the release', () => {
  const image = { Id: digest, Os: 'linux', Architecture: 'arm64', Config: { Labels: { 'org.opencontainers.image.revision': revision } } };
  verifyImage(image, revision);
  assert.throws(() => verifyImage({ ...image, Architecture: 'amd64' }, revision));
  assert.throws(() => verifyImage(image, 'd'.repeat(40)));
});
test('ready replicas running the imported image pass', () => {
  const { deployments, pods, release } = fixture();
  verifyWorkloads(deployments, pods, release);
});
for (const [label, mutate] of [
  ['wrong runtime digest despite matching tag', (f) => { f.pods.items[0].status.containerStatuses[0].imageID = `sha256:${'d'.repeat(64)}`; }],
  ['stale Kubernetes observation', (f) => { f.deployments.items[0].status.observedGeneration = 2; }],
  ['old replicas mixed with new Pods', (f) => { f.pods.items.push(structuredClone(f.pods.items[0])); }],
  ['partly rolled out deployment', (f) => { f.deployments.items[0].status.updatedReplicas = 1; }],
  ['unready container', (f) => { f.pods.items[0].status.containerStatuses[0].ready = false; }],
  ['missing deployment', (f) => { f.deployments.items.pop(); }],
  ['wrong Pod image ref', (f) => { f.pods.items[0].spec.containers[0].image = 'old:local'; }],
]) {
  test(`reject ${label}`, () => {
    const f = fixture(); mutate(f);
    assert.throws(() => verifyWorkloads(f.deployments, f.pods, f.release));
  });
}
test('only main can publish/deploy after all E2E checks, without cancelling a rollout', () => {
  const workflow = parse(readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  const publish = workflow.jobs['publish-mac-mini'];
  const deploy = workflow.jobs['deploy-mac-mini'];
  assert.equal(publish.needs, 'end-to-end');
  assert.equal(deploy.needs, 'publish-mac-mini');
  assert.equal(publish.if, "github.ref == 'refs/heads/main' && github.event_name != 'pull_request'");
  assert.equal(deploy.if, publish.if);
  assert.ok(deploy['runs-on'].includes('goalstotoday-deploy'));
  assert.equal(deploy.concurrency['cancel-in-progress'], false);
  assert.equal(deploy.environment.name, 'mac-mini-production');
});
test('host guard accepts the main deploy job and rejects PRs, other repositories and jobs', () => {
  const env = { ...process.env, GITHUB_REPOSITORY: 'jieseob1/planner', GITHUB_REF: 'refs/heads/main',
    GITHUB_WORKFLOW: 'CI', GITHUB_JOB: 'deploy-mac-mini', GITHUB_EVENT_NAME: 'push' };
  const check = (values) => spawnSync('bash', ['scripts/mac-mini-runner-guard.sh'], { env: values }).status;
  assert.equal(check(env), 0);
  for (const override of [{ GITHUB_REF: 'refs/pull/1/merge' }, { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_REPOSITORY: 'other/planner' }, { GITHUB_JOB: 'frontend' }, { GITHUB_WORKFLOW: 'Untrusted' }]) {
    assert.notEqual(check({ ...env, ...override }), 0);
  }
});
