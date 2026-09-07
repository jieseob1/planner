import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStack } from './stack.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const docker = (args, options = {}) => spawnSync('docker', args, {encoding: 'utf8', timeout: 5000, maxBuffer: 65536, ...options});
function command(args) {
  const result = docker(args);
  assert.equal(result.status, 0, `Docker startup fixture command failed: ${(result.stderr || '').slice(0, 500)}`);
  return result.stdout.trim();
}
function diagnostics(id) {
  const raw = docker(['inspect', '--format', '{{json .State}}', id]);
  let state = {};
  try {const value = JSON.parse(raw.stdout); state = {status: value.Status, exitCode: value.ExitCode, oomKilled: value.OOMKilled};} catch {}
  const result = docker(['logs', '--tail', '30', id]);
  const logs = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n')
    .filter(line => !/authorization|cookie|password|secret|token|credential/i.test(line))
    .map(line => line.replace(/\?[^\s"'<>]*/g, '?[REDACTED]')).join('\n').slice(-2000);
  return JSON.stringify({state, logs});
}
function stillRunning(id) {return command(['inspect', '--format', '{{.State.Running}}', id]) === 'true';}
function mounts(source, target) {return ['--mount', `type=bind,source=${source},target=${target},readonly`];}

export async function verifyManifestStartup() {
  const temp = mkdtempSync(join(tmpdir(), 'nowline-observability-startup-'));
  chmodSync(temp, 0o755);
  const controllers = buildStack().filter(object => ['Deployment', 'DaemonSet'].includes(object.kind));
  const pod = name => controllers.find(object => object.metadata.name === `nowline-${name}`).spec.template.spec;
  const spec = name => pod(name).containers[0];
  const launch = (name, args, extra = []) => {
    const container = spec(name);
    const uid = pod(name).securityContext.runAsUser;
    const cpuLimit = container.resources.limits.cpu.endsWith('m') ? parseFloat(container.resources.limits.cpu) / 1000 : parseFloat(container.resources.limits.cpu);
    const id = command(['run', '-d', '--network', 'none', '--platform', 'linux/arm64', '--read-only', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges', '--user', `${uid}:${uid}`,
      '--memory', container.resources.limits.memory.replace('Mi', 'm'), '--cpus', String(cpuLimit),
      '--tmpfs', `/tmp:uid=${uid},gid=${uid},mode=0750,size=32m`, ...extra, container.image, ...args]);
    assert.match(id, /^[a-f0-9]{64}$/);
    return id;
  };
  try {
    // All credentials below are nonfunctional local fixtures. The container has
    // no network and cannot contact the real API server, Keycloak or backend.
    const certificate = spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', '/dev/null', '-days', '2', '-subj', '/CN=fixture.invalid'], {encoding: 'utf8', timeout: 5000});
    assert.equal(certificate.status, 0, 'Cannot prepare public fixture certificate');
    writeFileSync(join(temp, 'ca.crt'), certificate.stdout);
    writeFileSync(join(temp, 'token'), 'nonfunctional-local-fixture\n');
    writeFileSync(join(temp, 'namespace'), 'nowline-observability\n');
    writeFileSync(join(temp, 'client-secret'), 'nonfunctional-local-fixture\n');
    mkdirSync(join(temp, 'logs'));
    for (const component of ['backend', 'frontend', 'keycloak', 'mysql']) {
      const logDirectory = join(temp, 'logs', `nowline-local_nowline-${component}-fixture_fixture`, component);
      mkdirSync(logDirectory, {recursive: true});
      writeFileSync(join(logDirectory, '0.log'), `${new Date().toISOString()} stdout F ordinary startup fixture\n`);
    }
    const promMounts = [...mounts(directory, '/etc/prometheus'), ...mounts(temp, '/var/run/secrets/kubernetes.io/serviceaccount'),
      ...mounts(temp, '/etc/kubelet-ca'), ...mounts(temp, '/etc/metrics-secret'),
      '--tmpfs', '/prometheus:uid=65534,gid=65534,mode=0750,size=256m',
      '-e', 'KUBERNETES_SERVICE_HOST=127.0.0.1', '-e', 'KUBERNETES_SERVICE_PORT=65535'];
    const checkPrometheus = async args => {
      const id = launch('prometheus', args, promMounts);
      try {
        const deadline = Date.now() + 20000;
        let ready = false;
        while (Date.now() < deadline) {
          if (!stillRunning(id)) break;
          const health = docker(['exec', id, '/bin/wget', '-qO-', 'http://127.0.0.1:9090/-/ready']);
          if (health.status === 0) {ready = true; break;}
          await wait(250);
        }
        assert(ready, `Manifest Prometheus did not become ready: ${diagnostics(id)}`);
        const flags = JSON.parse(command(['exec', id, '/bin/wget', '-qO-', 'http://127.0.0.1:9090/api/v1/status/flags']));
        assert.equal(flags.data['web.enable-admin-api'], 'false');
        // Prometheus reports disabled admin APIs as a JSON error (HTTP 500 in
        // this pinned version). Inspect its reason, not a guessed status code.
        const admin = docker(['exec', '-i', id, '/bin/busybox', 'nc', '-w', '3', '127.0.0.1', '9090'], {
          input: 'POST /api/v1/admin/tsdb/snapshot HTTP/1.1\r\nHost: 127.0.0.1:9090\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'});
        assert.equal(admin.status, 0, 'Cannot inspect local admin-API denial');
        assert.match(admin.stdout, /HTTP\/1\.1 500/);
        assert.match(admin.stdout, /admin APIs disabled/i);
      } finally {command(['rm', '--force', id]);}
    };
    await checkPrometheus(spec('prometheus').args);
    await assert.rejects(checkPrometheus([...spec('prometheus').args, '--web.enable-admin-api=false']), /unexpected false/);

    let collectorAttempt = 0;
    const checkFluentBit = async configFile => {
      const stateDirectory = join(temp, `state-${collectorAttempt++}`);
      mkdirSync(stateDirectory);
      const extra = [...mounts(directory, '/fluent-bit/etc/nowline'), ...mounts(join(temp, 'logs'), '/var/log/pods'),
        '--mount', `type=bind,source=${stateDirectory},target=/state`];
      if (configFile) extra.push(...mounts(configFile, '/fluent-bit/etc/nowline/fluent-bit.conf'));
      const id = launch('fluent-bit', spec('fluent-bit').args, extra);
      try {
        const deadline = Date.now() + 10000;
        let initialized = false;
        while (Date.now() < deadline) {
          if (!stillRunning(id)) break;
          // The four tail inputs must each initialize their real SQLite offset
          // DB. A dry-run parser and an unrelated stdin filter cannot prove this.
          initialized = ['backend', 'frontend', 'keycloak', 'mysql'].every(component => {
            const filename = join(stateDirectory, `${component}.db`);
            return existsSync(filename) && readFileSync(filename).subarray(0, 16).toString() === 'SQLite format 3\0';
          });
          if (initialized) break;
          await wait(250);
        }
        assert(initialized, `Manifest tail inputs did not initialize: ${diagnostics(id)}`);
        await wait(500);
        assert(stillRunning(id), `Manifest Fluent Bit exited after initialization: ${diagnostics(id)}`);
      } finally {command(['rm', '--force', id]);}
    };
    await checkFluentBit();
    const broken = join(temp, 'invalid-buffer.conf');
    writeFileSync(broken, readFileSync(new URL('fluent-bit.conf', import.meta.url), 'utf8').replaceAll('Buffer_Chunk_Size 16k', 'Buffer_Chunk_Size 64k'));
    await assert.rejects(checkFluentBit(broken), /buffer_max_size must be >= buffer_chunk/);
    console.log('Manifest Prometheus readiness/admin-API-disabled and four Fluent Bit tail inputs verified; both reported startup regressions rejected');
  } finally {
    // This is only the exact newly generated fixture directory, never user data.
    rmSync(temp, {recursive: true, force: true});
  }
}
