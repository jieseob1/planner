import { spawnSync } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { startFakeGoogleCalendar } from './lib/fake-google-calendar.mjs';

const repositoryRoot = new URL('..', import.meta.url).pathname;
const runId = `nowline-reliability-${process.pid}`;
const networkName = `${runId}-network`;
const databaseContainer = `${runId}-mysql`;
const backendContainers = [`${runId}-backend-a`, `${runId}-backend-b`];
const imageName = `${runId}:local`;
const databasePassword = randomBytes(24).toString('hex');
const jwtSecret = randomBytes(48).toString('base64url');
const integrationEncryptionKey = randomBytes(32).toString('base64');
const issuer = 'https://identity.reliability.nowline.invalid';
const audience = 'nowline-api';
const soakDurationMs = Math.max(5_000, Number(process.env.NOWLINE_RELIABILITY_SOAK_SECONDS ?? 30) * 1_000);
const startedContainers = [];
let fakeGoogle;

const fail = (message) => { throw new Error(message); };
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const run = (command, args, { allowFailure = false, cwd = repositoryRoot, stdio = 'pipe' } = {}) => {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio
  });
  if (!allowFailure && result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed\n${result.stderr || result.stdout || ''}`);
  }
  return result;
};

const expectStatus = async (response, expected, label) => {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(response.status)) {
    fail(`${label}: expected ${allowed.join('/')}, got ${response.status}: ${await response.text()}`);
  }
  return response;
};

const waitFor = async (label, action, timeoutMs = 240_000, intervalMs = 500) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'condition not met';
  while (Date.now() < deadline) {
    try {
      const result = await action();
      if (result) return result;
      lastError = 'condition not met';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(intervalMs);
  }
  fail(`${label} timed out: ${lastError}`);
};

const base64Url = (value) => Buffer.from(value).toString('base64url');
const tokenFor = (subject, scope = '') => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iss: issuer,
    sub: subject,
    aud: [audience],
    iat: now,
    nbf: now - 5,
    exp: now + 900,
    auth_time: now,
    name: `Reliability ${subject}`,
    email: `${subject}@nowline.invalid`,
    ...(scope ? { scope } : {})
  }));
  const signature = createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
};

const apiHeaders = (token, extra = {}) => ({
  Accept: 'application/json',
  Authorization: `Bearer ${token}`,
  ...extra
});

const consent = async (baseUrl, token) => {
  await expectStatus(await fetch(`${baseUrl}/api/v1/account/consent`, {
    method: 'PUT',
    headers: apiHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ termsAccepted: true, privacyAccepted: true })
  }), 200, 'policy consent');
};

const snapshot = {
  version: 1,
  plan: {
    year: 2026,
    annualDirection: '공개 운영 신뢰성 검증',
    quarter: 3,
    quarterFocus: '다중 인스턴스 일관성 확보',
    quarterEndDate: '2026-09-30'
  },
  plannerWeekOffset: 0,
  tasks: [{
    id: 'task-reliability',
    title: '신뢰성 기준 측정',
    outcomeId: 'outcome-reliability',
    estimateMinutes: 30,
    status: 'todo',
    pinned: true,
    carryCount: 0
  }],
  timeBlocks: [{
    id: 'block-reliability',
    taskId: 'task-reliability',
    title: '신뢰성 기준 측정',
    day: 'mon',
    startMinutes: 600,
    durationMinutes: 30,
    weekOffset: 0
  }],
  timeEntries: [],
  outcomes: [{
    id: 'outcome-reliability',
    title: '운영 신뢰성 기준 통과',
    parentTitle: 'Nowline 공개 운영',
    current: 0,
    target: 1,
    unit: '회',
    confidence: 'high',
    lastUpdatedDays: 0,
    actualHours: 0,
    neededHours: 0.5,
    availableHours: 2,
    evidenceLabel: '검증 시작',
    changeLabel: '다중 인스턴스 검증',
    attention: 'none'
  }],
  timer: null,
  review: {
    blocker: null,
    selectedTopTaskIds: ['task-reliability'],
    metricDraft: '',
    completedAt: null
  }
};

const databaseQuery = (sql) => run('docker', [
  'exec', '--env', `MYSQL_PWD=${databasePassword}`, databaseContainer,
  'mysql', '--user=nowline', '--database=nowline', '--batch', '--skip-column-names', '--execute', sql
]).stdout.trim();

const containerPort = (name) => {
  const output = run('docker', [
    'inspect', '--format', '{{(index (index .NetworkSettings.Ports "8080/tcp") 0).HostPort}}', name
  ]).stdout.trim();
  if (!/^\d+$/.test(output)) fail(`Could not resolve mapped port for ${name}: ${output}`);
  return Number(output);
};

const backendEnvironment = (workerId) => [
  '--env', 'SPRING_DATASOURCE_URL=jdbc:mysql://mysql:3306/nowline?useUnicode=true&characterEncoding=utf8&connectionCollation=utf8mb4_0900_as_ci&serverTimezone=UTC&preserveInstants=true',
  '--env', 'SPRING_DATASOURCE_USERNAME=nowline',
  '--env', `SPRING_DATASOURCE_PASSWORD=${databasePassword}`,
  '--env', 'SPRING_PROFILES_ACTIVE=local-auth',
  '--env', `NOWLINE_OIDC_ISSUER=${issuer}`,
  '--env', `NOWLINE_OIDC_AUDIENCE=${audience}`,
  '--env', `NOWLINE_DEV_JWT_SECRET=${jwtSecret}`,
  '--env', 'NOWLINE_DB_POOL_MAX=8',
  '--env', 'NOWLINE_DB_POOL_MIN=2',
  '--env', 'NOWLINE_GOOGLE_CLIENT_ID=reliability-client',
  '--env', 'NOWLINE_GOOGLE_CLIENT_SECRET=reliability-secret',
  '--env', 'NOWLINE_GOOGLE_REDIRECT_URI=http://127.0.0.1/oauth/callback',
  '--env', 'NOWLINE_GOOGLE_FRONTEND_SUCCESS_URI=http://127.0.0.1/settings',
  '--env', 'NOWLINE_GOOGLE_WEBHOOK_URI=https://nowline.invalid/api/v1/calendar/google/webhook',
  '--env', `NOWLINE_GOOGLE_AUTHORIZATION_URI=${fakeGoogle.containerBaseUrl}/auth`,
  '--env', `NOWLINE_GOOGLE_TOKEN_URI=${fakeGoogle.containerBaseUrl}/token`,
  '--env', `NOWLINE_GOOGLE_REVOKE_URI=${fakeGoogle.containerBaseUrl}/revoke`,
  '--env', `NOWLINE_GOOGLE_API_BASE_URI=${fakeGoogle.containerBaseUrl}/calendar/v3`,
  '--env', `NOWLINE_INTEGRATION_ENCRYPTION_KEY_BASE64=${integrationEncryptionKey}`,
  '--env', 'NOWLINE_INTEGRATION_POLL_DELAY_MS=200',
  '--env', `NOWLINE_INTEGRATION_WORKER_ID=${workerId}`
];

const startBackend = (name, workerId) => {
  const result = run('docker', [
    'run', '--detach', '--name', name,
    '--network', networkName,
    '--add-host', 'host.docker.internal:host-gateway',
    '--publish', '127.0.0.1::8080',
    '--read-only', '--tmpfs', '/tmp:size=64m,mode=1777',
    '--security-opt', 'no-new-privileges:true',
    ...backendEnvironment(workerId),
    imageName
  ]);
  startedContainers.push(name);
  return result.stdout.trim();
};

const percentile = (values, percentileValue) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentileValue) - 1)];
};

const readMetric = (text, name) => {
  const values = text.split('\n')
    .filter((line) => line.startsWith(`${name}{`) || line.startsWith(`${name} `))
    .map((line) => Number(line.trim().split(/\s+/).at(-1)))
    .filter(Number.isFinite);
  return values.length > 0 ? Math.max(...values) : null;
};

const cleanup = () => {
  for (const name of [...startedContainers].reverse()) {
    run('docker', ['rm', '--force', name], { allowFailure: true });
  }
  run('docker', ['rm', '--force', databaseContainer], { allowFailure: true });
  run('docker', ['network', 'rm', networkName], { allowFailure: true });
  run('docker', ['image', 'rm', '--force', imageName], { allowFailure: true });
};

try {
  fakeGoogle = await startFakeGoogleCalendar({ quotaFailures: 1, responseDelayMs: 20 });
  run('./mvnw', ['-q', 'package', '-DskipTests'], { cwd: `${repositoryRoot}backend`, stdio: 'inherit' });
  run('docker', ['build', '--tag', imageName, 'backend'], { stdio: 'inherit' });
  run('docker', ['network', 'create', networkName]);
  run('docker', [
    'run', '--detach', '--name', databaseContainer,
    '--network', networkName, '--network-alias', 'mysql',
    '--env', 'MYSQL_DATABASE=nowline',
    '--env', 'MYSQL_USER=nowline',
    '--env', `MYSQL_PASSWORD=${databasePassword}`,
    '--env', `MYSQL_ROOT_PASSWORD=${databasePassword}-root`,
    'mysql:8.4.10',
    '--character-set-server=utf8mb4',
    '--collation-server=utf8mb4_0900_as_ci',
    '--default-time-zone=+00:00',
    '--log-bin-trust-function-creators=1'
  ]);
  await waitFor('MySQL readiness', () => run('docker', [
    'exec', '--env', `MYSQL_PWD=${databasePassword}`, databaseContainer,
    'mysqladmin', 'ping', '-h', '127.0.0.1', '-u', 'nowline', '--silent'
  ], { allowFailure: true }).status === 0, 90_000);

  startBackend(backendContainers[0], 'reliability-a');
  startBackend(backendContainers[1], 'reliability-b');
  const backendUrls = backendContainers.map((name) => `http://127.0.0.1:${containerPort(name)}`);
  await Promise.all(backendUrls.map((baseUrl) => waitFor(`${baseUrl} readiness`, async () => {
    const response = await fetch(`${baseUrl}/actuator/health/readiness`, { signal: AbortSignal.timeout(3_000) });
    return response.ok;
  })));

  const userAToken = tokenFor('reliability-user-a');
  const userBToken = tokenFor('reliability-user-b');
  await consent(backendUrls[0], userAToken);
  await consent(backendUrls[1], userBToken);

  const createResponse = await expectStatus(await fetch(`${backendUrls[0]}/api/v1/planner`, {
    method: 'PUT',
    headers: apiHeaders(userAToken, {
      'Content-Type': 'application/json',
      'If-None-Match': '*',
      'Idempotency-Key': randomUUID()
    }),
    body: JSON.stringify(snapshot)
  }), 201, 'planner create through backend A');
  const initialEtag = createResponse.headers.get('etag');
  if (!initialEtag) fail('planner create did not return an ETag');
  await expectStatus(await fetch(`${backendUrls[1]}/api/v1/planner`, {
    headers: apiHeaders(userAToken)
  }), 200, 'cross-instance read through backend B');
  await expectStatus(await fetch(`${backendUrls[0]}/api/v1/planner`, {
    headers: apiHeaders(userBToken)
  }), 404, 'tenant isolation');

  const concurrentResults = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
    const candidate = structuredClone(snapshot);
    candidate.plan.quarterFocus = `동시 수정 후보 ${index + 1}`;
    const response = await fetch(`${backendUrls[index % 2]}/api/v1/planner`, {
      method: 'PUT',
      headers: apiHeaders(userAToken, {
        'Content-Type': 'application/json',
        'If-Match': initialEtag,
        'Idempotency-Key': randomUUID()
      }),
      body: JSON.stringify(candidate)
    });
    return response.status;
  }));
  const successfulWrites = concurrentResults.filter((status) => status === 200).length;
  const rejectedWrites = concurrentResults.filter((status) => status === 412).length;
  if (successfulWrites !== 1 || rejectedWrites !== 19) {
    fail(`Concurrent ETag writes were not single-winner: ${JSON.stringify(concurrentResults)}`);
  }

  const loadLatencies = [];
  let loadFailures = 0;
  const loadStartedAt = performance.now();
  let cursor = 0;
  const workers = Array.from({ length: 32 }, async () => {
    while (cursor < 400) {
      const requestIndex = cursor++;
      const startedAt = performance.now();
      try {
        const response = await fetch(`${backendUrls[requestIndex % 2]}/api/v1/planner`, {
          headers: apiHeaders(userAToken),
          signal: AbortSignal.timeout(5_000)
        });
        if (response.status !== 200) loadFailures += 1;
        await response.arrayBuffer();
      } catch {
        loadFailures += 1;
      } finally {
        loadLatencies.push(performance.now() - startedAt);
      }
    }
  });
  await Promise.all(workers);
  const loadDurationMs = performance.now() - loadStartedAt;
  const p95Ms = percentile(loadLatencies, 0.95);
  if (loadFailures !== 0) fail(`Load verification recorded ${loadFailures} failed requests`);
  if (p95Ms > 1_500) fail(`Load p95 exceeded 1500ms: ${p95Ms.toFixed(1)}ms`);

  const soakToken = tokenFor('reliability-soak-user');
  await consent(backendUrls[0], soakToken);
  await expectStatus(await fetch(`${backendUrls[1]}/api/v1/planner`, {
    method: 'PUT',
    headers: apiHeaders(soakToken, {
      'Content-Type': 'application/json',
      'If-None-Match': '*',
      'Idempotency-Key': randomUUID()
    }),
    body: JSON.stringify(snapshot)
  }), 201, 'soak planner create');
  const soakLatencies = [];
  let soakFailures = 0;
  const soakDeadline = performance.now() + soakDurationMs;
  let soakCursor = 0;
  while (performance.now() < soakDeadline) {
    const startedAt = performance.now();
    try {
      const response = await fetch(`${backendUrls[soakCursor % 2]}/api/v1/planner`, {
        headers: apiHeaders(soakToken),
        signal: AbortSignal.timeout(5_000)
      });
      if (response.status !== 200) soakFailures += 1;
      await response.arrayBuffer();
    } catch {
      soakFailures += 1;
    } finally {
      soakLatencies.push(performance.now() - startedAt);
      soakCursor += 1;
    }
    const pacingDelay = 100 - (performance.now() - startedAt);
    if (pacingDelay > 0) await sleep(pacingDelay);
  }
  const soakP95Ms = percentile(soakLatencies, 0.95);
  const minimumSoakRequests = Math.floor(soakDurationMs / 250);
  if (soakFailures !== 0) fail(`Soak verification recorded ${soakFailures} failed requests`);
  if (soakLatencies.length < minimumSoakRequests) {
    fail(`Soak verification completed only ${soakLatencies.length} requests; expected at least ${minimumSoakRequests}`);
  }
  if (soakP95Ms > 1_500) fail(`Soak p95 exceeded 1500ms: ${soakP95Ms.toFixed(1)}ms`);

  const metricsToken = tokenFor('reliability-metrics', 'metrics.read');
  for (const baseUrl of backendUrls) {
    const metricsResponse = await expectStatus(await fetch(`${baseUrl}/actuator/prometheus`, {
      headers: { Authorization: `Bearer ${metricsToken}` }
    }), 200, 'Prometheus metrics');
    const metrics = await metricsResponse.text();
    const maximum = readMetric(metrics, 'hikaricp_connections_max');
    const active = readMetric(metrics, 'hikaricp_connections_active');
    const pending = readMetric(metrics, 'hikaricp_connections_pending');
    if (maximum !== 8 || active === null || pending === null || active > maximum || pending !== 0) {
      fail(`Unexpected DB pool state at ${baseUrl}: max=${maximum}, active=${active}, pending=${pending}`);
    }
  }

  run('docker', ['stop', '--timeout', '20', backendContainers[0]], { stdio: 'inherit' });
  const survivingUrl = backendUrls[1];
  for (let index = 0; index < 100; index++) {
    await expectStatus(await fetch(`${survivingUrl}/api/v1/planner`, {
      headers: apiHeaders(userAToken),
      signal: AbortSignal.timeout(5_000)
    }), 200, `single-instance failover read ${index + 1}`);
  }

  const connectResponse = await expectStatus(await fetch(`${survivingUrl}/api/v1/integrations/google-calendar/connect`, {
    method: 'POST',
    headers: apiHeaders(userAToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ returnPath: '/settings' })
  }), 200, 'Google Calendar connect');
  const authorizationUrl = new URL((await connectResponse.json()).authorizationUrl);
  const state = authorizationUrl.searchParams.get('state');
  if (!state) fail('Google Calendar connect response did not include OAuth state');
  await expectStatus(await fetch(
    `${survivingUrl}/api/v1/integrations/google-calendar/oauth/callback?code=fake-google-code&state=${encodeURIComponent(state)}`,
    { redirect: 'manual' }
  ), 302, 'Google Calendar OAuth callback');

  const syncResponses = await Promise.all(Array.from({ length: 50 }, () => fetch(
    `${survivingUrl}/api/v1/integrations/google-calendar/sync`,
    { method: 'POST', headers: apiHeaders(userAToken) }
  )));
  if (syncResponses.some((response) => response.status !== 202)) {
    fail(`Concurrent calendar sync requests were not accepted: ${syncResponses.map((value) => value.status).join(',')}`);
  }

  const userId = databaseQuery("SELECT user_id FROM app_user WHERE oidc_subject = 'reliability-user-a'");
  if (!/^[0-9a-f-]{36}$/.test(userId)) fail(`Could not resolve reliability user id: ${userId}`);
  const activeJobs = Number(databaseQuery(
    `SELECT count(*) FROM integration_job WHERE user_id = '${userId}' AND job_type = 'GOOGLE_CALENDAR_SYNC' AND status IN ('PENDING', 'RUNNING')`
  ));
  if (activeJobs !== 1) fail(`Calendar sync deduplication left ${activeJobs} active jobs instead of 1`);

  const completedJob = await waitFor('Google Calendar quota retry', () => {
    const result = databaseQuery(
      `SELECT CONCAT(status, '|', attempts) FROM integration_job WHERE user_id = '${userId}' AND job_type = 'GOOGLE_CALENDAR_SYNC' ORDER BY created_at DESC LIMIT 1`
    );
    return result.startsWith('SUCCEEDED|') ? result : false;
  }, 45_000, 500);
  const attempts = Number(completedJob.split('|')[1]);
  if (attempts !== 2 || fakeGoogle.stats.quotaResponses !== 1 || fakeGoogle.stats.eventListRequests !== 2) {
    fail(`Calendar retry was not bounded: job=${completedJob}, quota=${fakeGoogle.stats.quotaResponses}, eventLists=${fakeGoogle.stats.eventListRequests}`);
  }
  if (fakeGoogle.stats.maxConcurrentRequests > 4) {
    fail(`Google integration request concurrency exceeded 4: ${fakeGoogle.stats.maxConcurrentRequests}`);
  }

  console.log(JSON.stringify({
    backendInstances: 2,
    loadRequests: loadLatencies.length,
    loadConcurrency: 32,
    loadDurationMs: Number(loadDurationMs.toFixed(1)),
    p95Ms: Number(p95Ms.toFixed(1)),
    loadFailures,
    soak: {
      durationSeconds: soakDurationMs / 1_000,
      requests: soakLatencies.length,
      p95Ms: Number(soakP95Ms.toFixed(1)),
      failures: soakFailures
    },
    concurrentWrites: { successful: successfulWrites, preconditionRejected: rejectedWrites },
    failoverReads: 100,
    databasePoolMaximumPerInstance: 8,
    calendarSync: {
      acceptedRequests: syncResponses.length,
      activeDeduplicatedJobs: activeJobs,
      attempts,
      quotaResponses: fakeGoogle.stats.quotaResponses,
      maxProviderConcurrency: fakeGoogle.stats.maxConcurrentRequests
    }
  }, null, 2));
  console.log('production reliability verification passed');
} catch (error) {
  for (const name of backendContainers) {
    const logs = run('docker', ['logs', '--tail', '200', name], { allowFailure: true });
    if (logs.stdout) process.stderr.write(logs.stdout);
    if (logs.stderr) process.stderr.write(logs.stderr);
  }
  throw error;
} finally {
  cleanup();
  if (fakeGoogle) await fakeGoogle.close().catch(() => {});
}
