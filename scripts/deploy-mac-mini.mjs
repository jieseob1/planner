import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, rmSync, openSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { components, imageTag, validateRelease, verifyImage, verifyImportedManifest, verifyRuntimeImageDigests, verifyWorkloads } from './lib/mac-mini-release.mjs';

const revision = process.env.NOWLINE_RELEASE_SHA;
const images = Object.fromEntries(components.map((name) => [name, process.env[`NOWLINE_${name.toUpperCase()}_IMAGE`]]));
const stateDir = path.join(homedir(), '.local/state/goalstotoday-deploy');
const repoDir = process.env.NOWLINE_SERVER_REPOSITORY || path.join(homedir(), 'develop/planner');
const origin = 'https://goalstotoday.com';
const kubeArgs = ['--context', 'kind-nowline-local', '--namespace', 'nowline-local'];
const run = (command, args, options = {}) => execFileSync(command, args, {
  encoding: 'utf8', timeout: 600_000, maxBuffer: 16 * 1024 * 1024, ...options,
});
const kube = (...args) => run('kubectl', [...kubeArgs, ...args]);
const kubeJson = (...args) => JSON.parse(kube(...args, '-o', 'json'));
const git = (...args) => run('git', ['-C', repoDir, ...args]).trim();
const statePath = path.join(stateDir, 'release.json');

async function waitFor(label, action, timeout = 180_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { return await action(); } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`${label}: ${lastError?.message}`);
}

async function verifyPublic(expected) {
  const get = (pathname) => fetch(`${origin}${pathname}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  await waitFor('public release', async () => {
    const response = await get(`/version.json?revision=${expected}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).revision, expected);
    const health = await get('/healthz');
    assert.equal(health.status, 200);
    assert.equal((await health.text()).trim(), 'ok');
    const discovery = await get('/idp/realms/nowline/.well-known/openid-configuration');
    assert.equal(discovery.status, 200);
    assert.equal((await discovery.json()).issuer, `${origin}/idp/realms/nowline`);
    assert.equal((await get('/api/v1/planner')).status, 401);
  });
}

if (process.argv.includes('--verify')) {
  const release = JSON.parse(readFileSync(statePath, 'utf8'));
  if (revision) assert.equal(release.revision, revision, 'Server release differs from expected revision');
  assert.equal(git('rev-parse', 'HEAD'), release.revision);
  verifyWorkloads(kubeJson('get', 'deployments'), kubeJson('get', 'pods'), release);
  await verifyPublic(release.revision);
  console.log(JSON.stringify(release, null, 2));
} else {
  validateRelease(revision, images);
  assert.equal(run('git', ['rev-parse', 'HEAD']).trim(), revision, 'Runner checkout differs from release');
  assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'Server checkout contains tracked changes');
  git('fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main');
  assert.equal(git('rev-parse', 'origin/main'), revision, 'A newer main exists; do not deploy a stale revision');
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  // Exclusive local lock also protects manual deployments outside Actions concurrency.
  const lock = path.join(stateDir, 'deploy.lock');
  const before = kubeJson('get', 'deployments');
  const previous = Object.fromEntries(components.map((component) => {
    const deployment = before.items.find((item) => item.metadata.name === `nowline-${component}`);
    assert.ok(deployment, `nowline-${component} not installed`);
    return [component, deployment.spec.template];
  }));
  const changed = [];
  const release = { revision, deployedAt: new Date().toISOString(), images: {} };
  writeFileSync(lock, `${process.pid}\n`, { flag: 'wx', mode: 0o600 });
  try {
    writeFileSync(path.join(stateDir, `before-${revision}.json`), JSON.stringify(previous, null, 2), { mode: 0o600 });
    const nodes = run('kind', ['get', 'nodes', '--name', 'nowline-local']).trim().split('\n');
    assert.ok(nodes.length && nodes.every((node) => /^nowline-local-[a-z0-9-]+$/.test(node)), 'Unexpected kind nodes');
    for (const component of components) {
      console.log(`Preparing ${component}: ${images[component]}`);
      run('docker', ['pull', '--platform', 'linux/arm64', images[component]], { stdio: 'inherit' });
      const inspected = JSON.parse(run('docker', ['image', 'inspect', images[component]]))[0];
      verifyImage(inspected, revision);
      // Docker 29's containerd store exposes a manifest ID as .Id; the classic
      // store exposes the config ID. Read the expected config from the registry.
      const publishedManifest = JSON.parse(run('docker', ['manifest', 'inspect', images[component]]));
      const configDigest = publishedManifest.config?.digest;
      assert.match(configDigest || '', /^sha256:[a-f0-9]{64}$/, 'Expected a single-platform image manifest');
      const tag = imageTag(component, revision);
      run('docker', ['tag', images[component], tag]);
      run('kind', ['load', 'docker-image', tag, '--name', 'nowline-local'], { stdio: 'inherit' });
      const nodeDigests = nodes.flatMap((node) => {
        const rows = run('docker', ['exec', node, 'ctr', '-n', 'k8s.io', 'images', 'list']).split('\n');
        const fields = rows.find((line) => line.split(/\s+/)[0] === tag)?.split(/\s+/);
        assert.match(fields?.[2] || '', /^sha256:[a-f0-9]{64}$/, `${node}: imported image missing`);
        const readManifest = (digest) => JSON.parse(run('docker', ['exec', node, 'ctr', '-n', 'k8s.io', 'content', 'get', digest]));
        verifyImportedManifest(readManifest(fields[2]), configDigest);
        const { status } = JSON.parse(run('docker', ['exec', node, 'crictl', 'inspecti', tag]));
        return [fields[2], ...verifyRuntimeImageDigests(status, tag, configDigest, readManifest)];
      });
      release.images[component] = { published: images[component], tag, configDigest, nodeDigests };
    }
    // Recheck after image preparation, before changing live workloads.
    git('fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main');
    assert.equal(git('rev-parse', 'origin/main'), revision, 'A newer main arrived while preparing images');
    // Preserve both application data and login identities before any Flyway-enabled pod starts.
    const backup = path.join(stateDir, `mysql-${revision}-${Date.now()}.sql`);
    const backupFd = openSync(backup, 'wx', 0o600);
    try {
      run('kubectl', [...kubeArgs, 'exec', 'nowline-mysql-0', '--', 'sh', '-ec',
        'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump --user=root --single-transaction --quick --routines --triggers --events --hex-blob --set-gtid-purged=OFF --no-tablespaces --databases nowline keycloak'],
      { stdio: ['ignore', backupFd, 'pipe'] });
    } finally { closeSync(backupFd); }
    run('gzip', [backup]);
    run('gzip', ['-t', `${backup}.gz`]);
    release.backup = { path: `${backup}.gz`, sha256: createHash('sha256').update(readFileSync(`${backup}.gz`)).digest('hex') };
    for (const component of components) {
      const name = `nowline-${component}`;
      const template = structuredClone(previous[component]);
      template.metadata.annotations = { ...template.metadata.annotations, 'nowline.dev/revision': revision };
      template.spec.containers.find((container) => container.name === component).image = release.images[component].tag;
      if (component === 'backend') {
        for (const container of template.spec.initContainers || []) {
          if (container.name === 'wait-for-mysql') container.image = release.images.backend.tag;
        }
      }
      changed.push(component);
      kube('patch', 'deployment', name, '--type=json', '-p', JSON.stringify([{ op: 'replace', path: '/spec/template', value: template }]));
      console.log(kube('rollout', 'status', `deployment/${name}`, '--timeout=300s').trim());
    }
    await waitFor('ready image IDs', () => verifyWorkloads(kubeJson('get', 'deployments'), kubeJson('get', 'pods'), release));
    console.log('All Ready Pods match the verified release image IDs');
    run(process.execPath, ['scripts/configure-product-identity.mjs', '--apply', '--activate-theme'], { stdio: 'inherit' });
    await verifyPublic(revision);
    // Keep the operator checkout and boot scripts on the release that actually passed health checks.
    if (git('branch', '--list', 'main')) git('switch', 'main');
    else git('switch', '-c', 'main', revision);
    git('merge', '--ff-only', revision);
    const fetchSpecs = git('config', '--get-all', 'remote.origin.fetch');
    if (!fetchSpecs.includes('refs/heads/*:') && !fetchSpecs.includes('refs/heads/main:')) git('remote', 'set-branches', '--add', 'origin', 'main');
    git('branch', '--set-upstream-to=origin/main', 'main');
    assert.equal(git('rev-parse', 'HEAD'), revision);
    if (existsSync(statePath)) writeFileSync(path.join(stateDir, 'previous-release.json'), readFileSync(statePath), { mode: 0o600 });
    const pending = `${statePath}.pending`;
    writeFileSync(pending, JSON.stringify(release, null, 2), { mode: 0o600 });
    renameSync(pending, statePath);
    console.log(`Mac mini deployment verified: ${revision}`);
    console.log(JSON.stringify(release, null, 2));
  } catch (error) {
    console.error(`Deployment failed: ${error.message}`);
    for (const component of changed.reverse()) {
      try {
        kube('patch', 'deployment', `nowline-${component}`, '--type=json', '-p', JSON.stringify([{ op: 'replace', path: '/spec/template', value: previous[component] }]));
        console.error(kube('rollout', 'status', `deployment/nowline-${component}`, '--timeout=300s').trim());
      } catch (rollbackError) { console.error(`Rollback failed for ${component}: ${rollbackError.message}`); }
    }
    throw error;
  } finally {
    rmSync(lock);
  }
}
