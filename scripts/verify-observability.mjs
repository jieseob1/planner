import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { buildStack, renderStack, images, namespace, context } from '../infra/observability/stack.mjs';
import { waitReady, verifyWaitReady } from '../infra/observability/wait-ready.mjs';
import { verifyManifestStartup } from '../infra/observability/startup-check.mjs';
import { operatorDashboards, operatorDashboardFiles } from '../infra/observability/operator-dashboards.mjs';

const directory = fileURLToPath(new URL('../infra/observability/', import.meta.url));
const read = (name) => readFileSync(new URL(name, `file://${directory}`), 'utf8');
const args = process.argv.slice(2);
assert(args.every((arg, i) => ['--runtime', '--containers', '--context'].includes(arg) || args[i - 1] === '--context'), 'Unknown argument');
await verifyWaitReady();
const stack = buildStack();
const pick = (kind, name) => stack.find(object => object.kind === kind && object.metadata.name === name);
const ini = Object.fromEntries(read('grafana.ini').split(/\n(?=\[)/).map(section => {
  const [header, ...lines] = section.trim().split('\n');
  const fields = lines.filter(line => line.includes('=')).map(line => {const i = line.indexOf('='); return [line.slice(0, i).trim(), line.slice(i + 1).trim()];});
  assert.equal(new Set(fields.map(([key]) => key)).size, fields.length, 'Duplicate Grafana setting');
  return [header.replace(/[\[\]]/g, ''), Object.fromEntries(fields)];
}));
const prom = parse(read('prometheus.yml'));
const rules = parse(read('rules.yml')).groups.flatMap(group => group.rules);
const loki = parse(read('loki.yml'));
const dashboard = JSON.parse(read('dashboard.json'));
assert.equal(new Set([dashboard, ...operatorDashboards].map(item => item.uid)).size, 4);
const provisioned = pick('ConfigMap', 'nowline-grafana-dashboard').data;
for (const [name, content] of Object.entries(operatorDashboardFiles)) {
  assert.equal(provisioned[name], content);
  const item = JSON.parse(content);
  assert.equal(item.editable, false);
  assert.equal(new Set(item.panels.map(panel => panel.id)).size, item.panels.length);
  for (const panel of item.panels) {
    assert(['nowline-prometheus', 'nowline-loki'].includes(panel.datasource.uid));
    assert(panel.targets.every(target => typeof target.expr === 'string' && target.expr.length > 0));
  }
}
function checkContract(objects, prometheus, grafana) {
  for (const service of objects.filter(object => object.kind === 'Service')) assert.equal(service.spec.type, 'ClusterIP', 'Only private ClusterIP services');
  assert(!objects.some(object => ['Ingress', 'Secret'].includes(object.kind)), 'No public ingress or plaintext secrets in stack');
  for (const controller of objects.filter(object => ['Deployment', 'DaemonSet'].includes(object.kind))) {
    assert.equal(controller.spec.template.spec.nodeSelector['kubernetes.io/arch'], 'arm64');
    for (const container of controller.spec.template.spec.containers) {
      assert.match(container.image, /:v?\d+\.\d+\.\d+@sha256:[a-f0-9]{64}$/);
      assert.equal(container.securityContext.allowPrivilegeEscalation, false);
      assert.equal(container.securityContext.readOnlyRootFilesystem, true);
      assert.deepEqual(container.securityContext.capabilities.drop, ['ALL']);
      assert(container.resources.requests.memory && container.resources.limits.memory);
    }
  }
  const grafanaContainer = objects.find(object => object.kind === 'Deployment' && object.metadata.name === 'nowline-grafana').spec.template.spec.containers[0];
  assert.equal(grafanaContainer.resources.requests.memory, '384Mi', 'Grafana needs a realistic scheduling reservation');
  assert.equal(grafanaContainer.resources.limits.memory, '768Mi', 'Keep validated post-OOM Grafana headroom');
  assert.equal(grafanaContainer.resources.limits.cpu, '1', 'Grafana startup must not be throttled below the validated limit');
  const backend = prometheus.scrape_configs.find(job => job.job_name === 'nowline-backend');
  assert.equal(backend.metrics_path, '/actuator/prometheus');
  assert.equal(backend.oauth2.client_id, 'nowline-prometheus');
  assert.deepEqual(backend.oauth2.scopes, ['metrics.read']);
  assert.equal(backend.oauth2.client_secret_file, '/etc/metrics-secret/client-secret');
  assert.equal(new URL(backend.oauth2.token_url).protocol, 'https:');
  assert(!backend.oauth2.client_secret && !backend.bearer_token, 'No embedded tokens');
  assert.equal(grafana['auth.anonymous'].enabled, 'false');
  assert.equal(grafana['auth.basic'].enabled, 'false');
  assert.equal(grafana.security.disable_initial_admin_creation, 'true');
  assert.equal(grafana['auth.generic_oauth'].role_attribute_path, "contains(realm_access.roles[*], 'nowline-admin') && 'Admin'");
  assert.equal(grafana['auth.generic_oauth'].role_attribute_strict, 'true');
  assert.equal(grafana['auth.generic_oauth'].use_pkce, 'true');
  assert.equal(grafana.server.root_url, 'https://goalstotoday.com/ops/grafana/');
  assert.equal(grafana.server.serve_from_sub_path, 'true');
}
checkContract(stack, prom, ini);
for (const mutate of [
  objects => objects.find(object => object.kind === 'Service').spec.type = 'NodePort',
  objects => objects.find(object => object.metadata.name === 'nowline-grafana' && object.kind === 'Deployment').spec.template.spec.containers[0].resources.limits.memory = '384Mi',
  (objects, prometheus) => delete prometheus.scrape_configs[0].oauth2.client_secret_file,
  (objects, prometheus, grafana) => grafana['auth.generic_oauth'].role_attribute_strict = 'false',
  (objects, prometheus, grafana) => grafana['auth.generic_oauth'].role_attribute_path += " || 'Viewer'",
  (objects, prometheus, grafana) => grafana['auth.anonymous'].enabled = 'true',
]) {
  const fixture = [structuredClone(stack), structuredClone(prom), structuredClone(ini)];
  mutate(...fixture); assert.throws(() => checkContract(...fixture), 'Unsafe positive control must be rejected');
}
const controllers = stack.filter(object => ['Deployment', 'DaemonSet'].includes(object.kind));
const containers = controllers.flatMap(controller => controller.spec.template.spec.containers);
const memoryMi = value => value.endsWith('Gi') ? parseFloat(value) * 1024 : parseFloat(value);
const requestMi = containers.reduce((sum, container) => sum + memoryMi(container.resources.requests.memory), 0);
const limitMi = containers.reduce((sum, container) => sum + memoryMi(container.resources.limits.memory), 0);
assert(requestMi < 1024 && limitMi <= 3 * 1024, 'One-node resource budget');
assert.equal(rules.length, new Set(rules.map(rule => rule.alert)).size, 'Alert names must be unique');
for (const name of ['NowlineObservabilityDiskMetricsMissing', 'NowlineCollectorMetricsMissing', 'NowlineDatabasePoolWaiting']) {
  assert(rules.some(rule => rule.alert === name && rule.expr && rule.for && rule.labels.severity), `Missing actionable alert ${name}`);
}
assert(rules.find(rule => rule.alert === 'NowlineContainerMemoryHigh').expr.includes('nowline-(local|observability)'), 'Memory alert must cover Grafana itself');
assert.equal(loki.limits_config.retention_period, '72h');
assert.equal(loki.compactor.retention_enabled, true);
assert.equal(loki.compactor.delete_request_store, 'filesystem');
assert(pick('Deployment', 'nowline-prometheus').spec.template.spec.containers[0].args.includes('--storage.tsdb.retention.size=2GB'));
assert(pick('Deployment', 'nowline-prometheus').spec.template.spec.containers[0].args.every(arg => !/^--web\.enable-(admin-api|lifecycle)/.test(arg)), 'Prometheus admin/lifecycle switches must remain absent and disabled by default');
const tailInputs = read('fluent-bit.conf').split(/^\[INPUT\]\s*$/m).slice(1).map(block => block.split(/^\[/m)[0]);
assert.equal(tailInputs.length, 4);
for (const block of tailInputs) {
  const chunk = Number(block.match(/^\s*Buffer_Chunk_Size\s+(\d+)k\s*$/mi)?.[1]);
  const maximum = Number(block.match(/^\s*Buffer_Max_Size\s+(\d+)k\s*$/mi)?.[1]);
  assert(chunk > 0 && chunk <= maximum && maximum <= 32, 'Each tail buffer must explicitly satisfy 0 < chunk <= maximum <= 32 KiB');
}
assert.equal(stack.filter(item => item.kind === 'PersistentVolumeClaim').reduce((sum, item) => sum + parseFloat(item.spec.resources.requests.storage), 0), 9);
const collector = pick('DaemonSet', 'nowline-fluent-bit').spec.template.spec;
assert.equal(collector.automountServiceAccountToken, false);
assert.deepEqual(collector.volumes.filter(volume => volume.hostPath).map(volume => volume.hostPath.path), ['/var/log/pods']);
assert(collector.containers[0].volumeMounts.find(mount => mount.name === 'logs').readOnly);
assert(!stack.filter(item => /Role$/.test(item.kind)).flatMap(item => item.rules).some(rule => rule.verbs.some(verb => !['get', 'list', 'watch'].includes(verb)) || rule.resources.some(resource => ['*', 'secrets', 'pods/exec', 'pods/log', 'nodes/proxy'].includes(resource))));
for (const job of prom.scrape_configs.filter(job => job.job_name.startsWith('kind-'))) {
  assert.equal(job.tls_config.ca_file, '/etc/kubelet-ca/ca.crt');
  assert(!job.tls_config.insecure_skip_verify);
}
const expressions = dashboard.panels.flatMap(panel => panel.targets || []).map(target => target.expr).join('\n');
for (const metric of ['container_cpu_usage_seconds_total', 'container_memory_working_set_bytes', 'jvm_memory_used_bytes', 'process_cpu_usage', 'jvm_gc_pause_seconds_sum', 'kubelet_running_containers']) assert(expressions.includes(metric), `Missing measured ${metric}`);
assert(dashboard.panels.some(panel => panel.type === 'logs' && panel.targets[0].expr.includes('namespace="nowline-local"')));
assert.deepEqual(JSON.parse(renderStack()).items, stack, 'Renderer must faithfully preserve manifest');
for (const script of ['install-observability.mjs', 'provision-observability-identity.mjs']) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], {encoding: 'utf8'});
  assert.equal(result.status, 0, 'Default mode must succeed without kubectl');
  assert.match(result.stdout, /Read-only mode/);
  const rejected = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), '--apply', '--context', 'production'], {encoding: 'utf8'});
  assert.notEqual(rejected.status, 0, 'Wrong context must be refused before kubectl');
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, ...options});
  assert.equal(result.status, 0, `${command} verification failed: ${(result.stderr || result.error?.message || '').slice(0, 1000)}`);
  return result.stdout;
}
if (args.includes('--containers')) {
  const base = ['run', '--rm', '--network', 'none', '--platform', 'linux/arm64', '--mount', `type=bind,source=${directory},target=/fluent-bit/etc/nowline,readonly`];
  for (const image of Object.values(images)) assert.equal(JSON.parse(run('docker', ['image', 'inspect', image]))[0].Architecture, 'arm64');
  // Syntax validators use no cluster access, credentials, or container host mounts.
  const promBase = ['run', '--rm', '--network', 'none', '--platform', 'linux/arm64', '--mount', `type=bind,source=${directory},target=/etc/prometheus,readonly`, '--entrypoint', '/bin/promtool', images.prometheus];
  run('docker', [...promBase, 'check', 'config', '--syntax-only', '/etc/prometheus/prometheus.yml']);
  run('docker', [...promBase, 'check', 'rules', '/etc/prometheus/rules.yml']);
  run('docker', [...promBase, 'test', 'rules', '/etc/prometheus/rules.test.yml']);
  run('docker', [...base, images.loki, '-config.file=/fluent-bit/etc/nowline/loki.yml', '-verify-config=true']);
  run('docker', [...base, '--tmpfs', '/state', images['fluent-bit'], '--dry-run', '-c', '/fluent-bit/etc/nowline/fluent-bit.conf']);
  await verifyManifestStartup();
  // Test the actual deployed Lua code in the actual collector, not a JS rewrite.
  const fixtures = [
    {log: 'ERROR ordinary-positive-control database connection timed out', stream: 'stderr'},
    {log: 'java.lang.IllegalStateException: stack-positive-control'},
    {log: 'GET /api/v1/tasks?private_query_canary=xyz HTTP/1.1 200'},
    {log: 'unlabelled eyJhbGciOiJub25lIn0.eyJzdWIiOiJjYW5hcnkifQ.signature'},
    {log: 'Authorization: Bearer secret_bearer_canary'},
    {log: 'Cookie: session=secret_cookie_canary'},
    {log: '{"password":"secret_password_canary"}'},
    {log: 'token=secret_token_canary'},
    {log: '{"accessToken":"secret_camel_token_canary"}'},
    {log: 'X-Api-Key: secret_api_key_canary'},
    {log: 'INFO harmless', password: 'secret_extra_field_canary'},
    {log: {unexpected: 'secret_wrong_type_canary'}},
    {log: 'secret_partial_fragment_canary', logtag: 'P'},
  ];
  const child = spawn('docker', [...base.slice(0, 1), '-i', ...base.slice(1), images['fluent-bit'], '-c', '/fluent-bit/etc/nowline/sanitize-test.conf'], {stdio: ['pipe', 'pipe', 'pipe']});
  let output = ''; let error = '';
  child.stdout.on('data', chunk => {output += chunk;}); child.stderr.on('data', chunk => {error += chunk;});
  child.stdin.end(fixtures.map(fixture => JSON.stringify(fixture)).join('\n') + '\n');
  const exit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {child.kill('SIGTERM'); reject(new Error('Fluent Bit fixture test timed out'));}, 20000);
    child.on('error', reject); child.on('close', code => {clearTimeout(timer); resolve(code);});
  });
  assert.equal(exit, 0, error.slice(0, 1000));
  assert(output.includes('ordinary-positive-control') && output.includes('stack-positive-control'), 'Collector must preserve useful messages');
  assert(output.includes('[REDACTED]') && output.includes('[REDACTED_JWT]'), 'Redaction paths exercised');
  for (const forbidden of ['secret_', 'private_query_canary', 'eyJhbGci']) assert(!output.includes(forbidden), `Collector leaked ${forbidden}`);
  // Start the real Grafana binary without network access or published ports.
  // The credential below is an intentionally nonfunctional fixture, not an IdP secret.
  const grafanaContainer = run('docker', ['run', '-d', '--network', 'none', '--platform', 'linux/arm64', '--read-only',
    '--memory', '768m', '--cpus', '1', '--tmpfs', '/var/lib/grafana:uid=472,gid=472,mode=0750', '--tmpfs', '/tmp:uid=472,gid=472,mode=0750',
    '--mount', `type=bind,source=${directory}grafana.ini,target=/etc/nowline-grafana.ini,readonly`,
    '--mount', `type=bind,source=${directory}datasources.yml,target=/etc/grafana/provisioning/datasources/nowline.yml,readonly`,
    '--mount', `type=bind,source=${directory}dashboards.yml,target=/etc/grafana/provisioning/dashboards/nowline.yml,readonly`,
    '--mount', `type=bind,source=${directory},target=/var/lib/grafana/dashboards,readonly`,
    '-e', 'GF_PATHS_CONFIG=/etc/nowline-grafana.ini', '-e', 'GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET=nonfunctional-local-fixture',
    '-e', 'GF_SECURITY_SECRET_KEY=local-test-session-key-not-a-production-secret', images.grafana]).trim();
  assert.match(grafanaContainer, /^[a-f0-9]{64}$/);
  const started = Date.now();
  const diagnostics = () => {
    const result = spawnSync('docker', ['inspect', '--format', '{{json .State}}', grafanaContainer], {encoding: 'utf8', timeout: 3000});
    let state;
    try {const raw = JSON.parse(result.stdout); state = {status: raw.Status, running: raw.Running, oomKilled: raw.OOMKilled, exitCode: raw.ExitCode};}
    catch {state = {status: 'inspect-unavailable'};}
    const logs = spawnSync('docker', ['logs', '--tail', '30', grafanaContainer], {encoding: 'utf8', timeout: 3000, maxBuffer: 32768});
    const safeLogs = `${logs.stdout || ''}\n${logs.stderr || ''}`.split('\n')
      .filter(line => !/authorization|cookie|password|secret|token|credential|api[-_]?key/i.test(line))
      .map(line => line.replace(/\?[^\s"'<>]*/g, '?[REDACTED]').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[REDACTED_JWT]'))
      .join('\n').slice(-3000);
    return {state, logs: safeLogs};
  };
  try {
    // Even at the production 1 CPU limit, Grafana's first-start migrations can
    // exceed 30s when backend integration tests share the Docker VM. Keep a
    // finite budget and diagnose an exited/OOM container rather than retry it.
    const deadline = started + 75000;
    let healthy = false;
    while (Date.now() < deadline) {
      const health = spawnSync('docker', ['exec', grafanaContainer, 'wget', '-qO-', 'http://127.0.0.1:3000/ops/grafana/api/health'], {encoding: 'utf8', timeout: 3000});
      if (health.status === 0) {assert.equal(JSON.parse(health.stdout).database, 'ok'); healthy = true; break;}
      const state = spawnSync('docker', ['inspect', '--format', '{{.State.Running}}', grafanaContainer], {encoding: 'utf8', timeout: 3000});
      if (state.status === 0 && state.stdout.trim() === 'false') break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert(healthy, `Real Grafana not ready after ${Math.round((Date.now() - started) / 1000)}s; ${JSON.stringify(diagnostics())}`);
    const denied = spawnSync('docker', ['exec', grafanaContainer, 'wget', '-S', '-O', '/dev/null', 'http://127.0.0.1:3000/ops/grafana/api/search'], {encoding: 'utf8', timeout: 3000});
    assert.notEqual(denied.status, 0, 'Anonymous real Grafana API must fail');
    assert.match(denied.stderr, /401 Unauthorized/);
    const startupLogs = run('docker', ['logs', grafanaContainer]);
    assert(!/Failed to provision|Failed to load config|failed to parse/i.test(startupLogs), 'Grafana provisioning failed');
    console.log(`Grafana healthy after ${Math.round((Date.now() - started) / 1000)}s; anonymous API returned 401`);
  } finally {
    // Only remove the exact temporary fixture created above; no name/glob cleanup.
    run('docker', ['rm', '--force', grafanaContainer]);
  }
  console.log('ARM64 image/config and real collector positive/negative controls verified (Grafana startup and anonymous denial included)');
}

if (args.includes('--runtime')) {
  assert.equal(args[args.indexOf('--context') + 1], context, 'Runtime mode requires explicit --context kind-nowline-local');
  async function verifyRuntimeOnce({remainingMs}) {
    const operationTimeout = () => {
      const remaining = remainingMs();
      assert(remaining > 0, 'Runtime startup deadline reached');
      return Math.min(5000, remaining);
    };
    const kube = (...arguments_) => run('kubectl', ['--context', context, ...arguments_], {timeout: operationTimeout()});
    const json = (...arguments_) => JSON.parse(kube(...arguments_, '-o', 'json'));
    const proxy = (service, port, path) => kube('get', '--raw', `/api/v1/namespaces/${namespace}/services/http:${service}:${port}/proxy${path}`);
    for (const controller of controllers) {
      const object = json('-n', namespace, 'get', controller.kind, controller.metadata.name);
      assert(object.status.observedGeneration >= object.metadata.generation);
      const expected = controller.kind === 'DaemonSet' ? object.status.desiredNumberScheduled : object.spec.replicas;
      const ready = controller.kind === 'DaemonSet' ? object.status.numberReady : object.status.readyReplicas;
      assert(expected > 0 && ready === expected, `${controller.metadata.name} not fully Ready`);
      assert.deepEqual(object.spec.template.spec.containers[0].resources, controller.spec.template.spec.containers[0].resources, `${controller.metadata.name} resource budget not deployed`);
    }
    const pvc = json('-n', namespace, 'get', 'pvc').items;
    for (const component of ['prometheus', 'grafana', 'loki']) assert.equal(pvc.find(item => item.metadata.name === `nowline-${component}`)?.status.phase, 'Bound');
    for (const service of json('-n', namespace, 'get', 'services').items) assert.equal(service.spec.type, 'ClusterIP');
    const targets = JSON.parse(proxy('nowline-prometheus', 9090, '/api/v1/targets')).data.activeTargets;
    const backendTargets = targets.filter(target => target.labels.job === 'nowline-backend');
    const backendPods = json('-n', 'nowline-local', 'get', 'pods', '-l', 'app.kubernetes.io/component=backend').items.filter(pod => pod.status.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True'));
    assert(backendPods.length > 0 && backendTargets.length === backendPods.length, 'Every Ready backend pod must have one target');
    assert(backendTargets.every(target => target.health === 'up' && backendPods.some(pod => pod.metadata.name === target.labels.pod)), 'Authenticated metrics target is not up=1');
    assert(targets.some(target => target.labels.job === 'kind-kubelet' && target.health === 'up'), 'cAdvisor scrape missing');
    const liveDashboards = json('-n', namespace, 'get', 'configmap', 'nowline-grafana-dashboard').data;
    for (const [name, content] of Object.entries(operatorDashboardFiles)) assert.equal(liveDashboards[name], content, `Dashboard ${name} not deployed`);
    let nonEmptyPanels = 0;
    for (const board of operatorDashboards) for (const panel of board.panels) {
      const isLoki = panel.datasource.uid === 'nowline-loki';
      const service = isLoki ? 'nowline-loki' : 'nowline-prometheus';
      const port = isLoki ? 3100 : 9090;
      const path = isLoki ? '/loki/api/v1/query_range' : '/api/v1/query';
      const result = JSON.parse(proxy(service, port, `${path}?query=${encodeURIComponent(panel.targets[0].expr)}${isLoki ? '&limit=20&since=1h' : ''}`));
      assert.equal(result.status, 'success', `Dashboard query failed: ${board.uid}/${panel.id}`);
      if (result.data.result.length) nonEmptyPanels++;
    }
    assert(nonEmptyPanels >= 12, 'Too few populated operator panels');
    for (const query of ['jvm_memory_used_bytes{job="nowline-backend"}', 'container_cpu_usage_seconds_total{namespace="nowline-local",container!=""}', 'container_memory_working_set_bytes{namespace="nowline-local",container!=""}']) {
      const result = JSON.parse(proxy('nowline-prometheus', 9090, `/api/v1/query?query=${encodeURIComponent(query)}`));
      assert(result.status === 'success' && result.data.result.length > 0, `Missing actual metric ${query}`);
    }
    // All values stay local to this check; no log body or API token is printed.
    const logs = JSON.parse(proxy('nowline-loki', 3100, `/loki/api/v1/query_range?query=${encodeURIComponent('{namespace="nowline-local"}')}&limit=100&since=1h`));
    assert(logs.status === 'success' && logs.data.result.some(stream => stream.values.length > 0), 'Loki has no real application logs from the last hour');
    for (const stream of logs.data.result) for (const [, line] of stream.values) {
      const message = JSON.parse(line).message;
      assert(typeof message === 'string' && message.length <= 3000, 'Unexpected raw log schema');
      assert(!/eyJ[\w-]+\.[\w-]+\.[\w-]+|(?:authorization|cookie|password|client_secret|access_token|refresh_token)["'\s]*[:=]/i.test(message), 'Sensitive pattern detected in live sanitized logs');
    }
    const publicHealth = await fetch('https://goalstotoday.com/ops/grafana/api/health', {redirect: 'manual', signal: AbortSignal.timeout(operationTimeout())});
    assert.equal(publicHealth.status, 200, 'Public Grafana health route missing');
    const unauth = await fetch('https://goalstotoday.com/ops/grafana/api/search', {redirect: 'manual', signal: AbortSignal.timeout(operationTimeout())});
    assert([401, 302, 303].includes(unauth.status), 'Anonymous Grafana search must be denied');
    return backendTargets.length;
  }
  try {
    const backendCount = await waitReady(verifyRuntimeOnce);
    console.log(`observability runtime verified: ${backendCount} authenticated backend targets, real JVM/container series, sanitized Loki rows, anonymous Grafana denied`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
console.log(`observability configuration verified: ${requestMi}Mi requests, ${limitMi}Mi limits, 9Gi PVCs, ${dashboard.panels.length} measured/log panels`);
