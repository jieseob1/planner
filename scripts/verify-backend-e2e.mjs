import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';

const repositoryRoot = new URL('..', import.meta.url).pathname;
const projectName = `nowline-e2e-${process.pid}`;
let accessToken = '';

const fail = (message) => {
  throw new Error(message);
};

const runCompose = (args, env, allowFailure = false) => {
  const result = spawnSync(
    'docker',
    ['compose', '-p', projectName, '-f', 'compose.yaml', ...args],
    { cwd: repositoryRoot, env, encoding: 'utf8', stdio: allowFailure ? 'pipe' : 'inherit' }
  );
  if (!allowFailure && result.status !== 0) {
    fail(`docker compose ${args.join(' ')} failed with exit ${result.status}`);
  }
  return result;
};

const packageBackend = () => {
  const result = spawnSync('./mvnw', ['-q', 'package', '-DskipTests'], {
    cwd: `${repositoryRoot}backend`,
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit'
  });
  if (result.status !== 0) fail(`backend packaging failed with exit ${result.status}`);
};

const reservePort = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.unref();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      reject(new Error('Could not allocate a local TCP port'));
      return;
    }
    const { port } = address;
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

const waitForReady = async (url, timeoutMs = 240_000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  fail(`Backend readiness timed out: ${lastError}`);
};

const initialMetricObservedAt = new Date().toISOString();
const snapshot = {
  version: 1,
  plan: {
    year: 2026,
    annualDirection: '검증 가능한 제품 만들기',
    quarter: 3,
    quarterFocus: '서버 동기화 검증',
    quarterEndDate: '2026-09-30'
  },
  plannerWeekOffset: 0,
  tasks: [
    {
      id: 'task-e2e',
      title: 'E2E API 검증',
      outcomeId: 'outcome-e2e',
      estimateMinutes: 30,
      status: 'todo',
      pinned: true,
      carryCount: 0
    }
  ],
  timeBlocks: [
    {
      id: 'block-e2e',
      taskId: 'task-e2e',
      title: 'E2E API 검증',
      day: 'mon',
      startMinutes: 600,
      durationMinutes: 30,
      weekOffset: 0,
      date: '2026-08-31'
    }
  ],
  timeEntries: [],
  outcomes: [
    {
      id: 'outcome-e2e',
      title: '서버 저장 완성',
      parentTitle: 'Nowline 백엔드',
      current: 0,
      target: 1,
      unit: '회',
      confidence: 'high',
      lastUpdatedDays: 0,
      metricUpdatedAt: initialMetricObservedAt,
      nextCheckDate: '2026-09-09',
      metricHistory: [{
        id: 'metric-e2e-initial',
        value: 0,
        observedAt: initialMetricObservedAt,
        evidence: 'E2E 시작'
      }],
      actualHours: 0,
      neededHours: 0.5,
      availableHours: 2,
      evidenceLabel: 'E2E 시작',
      changeLabel: '첫 검증',
      attention: 'none'
    }
  ],
  timer: null,
  review: {
    blocker: null,
    selectedTopTaskIds: ['task-e2e'],
    metricDraft: '',
    completedAt: null
  }
};

const headers = (extra = {}) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${accessToken}`,
  ...extra
});

const expectStatus = async (response, expected, label) => {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(response.status)) {
    const body = await response.text();
    fail(`${label}: expected ${allowed.join('/')}, received ${response.status}: ${body}`);
  }
  return response;
};

const backendPort = await reservePort();
const frontendPort = await reservePort();
const environment = {
  ...process.env,
  NOWLINE_BACKEND_PORT: String(backendPort),
  NOWLINE_FRONTEND_PORT: String(frontendPort),
  NOWLINE_MYSQL_VOLUME: `${projectName}-mysql-data`
};
const plannerUrl = `http://127.0.0.1:${backendPort}/api/v1/planner`;

try {
  packageBackend();
  runCompose(['up', '-d', '--build', 'mysql', 'backend'], environment);
  await waitForReady(`http://127.0.0.1:${backendPort}/actuator/health/readiness`);
  const tokenResponse = await expectStatus(await fetch(
    `http://127.0.0.1:${backendPort}/api/v1/auth/dev-token`,
    { headers: { Accept: 'application/json' } }
  ), 200, 'local token');
  accessToken = (await tokenResponse.json()).accessToken;
  if (!accessToken) fail('local token: missing accessToken');
  await expectStatus(await fetch(`http://127.0.0.1:${backendPort}/api/v1/account/consent`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify({ termsAccepted: true, privacyAccepted: true })
  }), 200, 'policy consent');

  await expectStatus(await fetch(plannerUrl, { headers: headers() }), 404, 'initial GET');

  const createKey = randomUUID();
  const createResponse = await expectStatus(await fetch(plannerUrl, {
    method: 'PUT',
    headers: headers({ 'If-None-Match': '*', 'Idempotency-Key': createKey }),
    body: JSON.stringify(snapshot)
  }), [200, 201], 'create');
  const firstEtag = createResponse.headers.get('etag');
  if (!firstEtag || !/^"planner-[0-9a-f]{32}-1"$/.test(firstEtag)) {
    fail(`create: missing or non-subject ETag header (${firstEtag})`);
  }
  const created = await createResponse.json();
  if (created.revision !== 1
      || created.snapshot.tasks[0].title !== 'E2E API 검증'
      || created.snapshot.timeBlocks[0].date !== '2026-08-31') {
    fail(`create: unexpected response ${JSON.stringify(created)}`);
  }

  const replayResponse = await expectStatus(await fetch(plannerUrl, {
    method: 'PUT',
    headers: headers({ 'If-None-Match': '*', 'Idempotency-Key': createKey }),
    body: JSON.stringify(snapshot)
  }), [200, 201], 'idempotent replay');
  if (replayResponse.headers.get('etag') !== firstEtag) {
    fail('idempotent replay: revision changed');
  }

  const readResponse = await expectStatus(await fetch(plannerUrl, { headers: headers() }), 200, 'read');
  if (readResponse.headers.get('etag') !== firstEtag) fail('read: ETag does not match create');
  const read = await readResponse.json();
  if (read.snapshot.timeBlocks[0].date !== '2026-08-31') {
    fail(`read: absolute block date was not preserved (${JSON.stringify(read.snapshot.timeBlocks[0])})`);
  }

  const updatedSnapshot = structuredClone(snapshot);
  updatedSnapshot.tasks[0].title = 'E2E API 검증 완료';
  const updateKey = randomUUID();
  const updateResponse = await expectStatus(await fetch(plannerUrl, {
    method: 'PUT',
    headers: headers({ 'If-Match': firstEtag, 'Idempotency-Key': updateKey }),
    body: JSON.stringify(updatedSnapshot)
  }), 200, 'update');
  const secondEtag = updateResponse.headers.get('etag');
  const updated = await updateResponse.json();
  if (!secondEtag || secondEtag === firstEtag || updated.revision !== 2) {
    fail('update: revision did not advance exactly once');
  }
  if (updated.snapshot.timeBlocks[0].date !== '2026-08-31') {
    fail('update: absolute block date was not preserved');
  }

  await expectStatus(await fetch(plannerUrl, {
    method: 'PUT',
    headers: headers({ 'If-Match': firstEtag, 'Idempotency-Key': randomUUID() }),
    body: JSON.stringify(snapshot)
  }), 412, 'stale update');

  const reusedKeySnapshot = structuredClone(updatedSnapshot);
  reusedKeySnapshot.tasks[0].title = '같은 키로 다른 요청';
  await expectStatus(await fetch(plannerUrl, {
    method: 'PUT',
    headers: headers({ 'If-Match': secondEtag, 'Idempotency-Key': updateKey }),
    body: JSON.stringify(reusedKeySnapshot)
  }), 409, 'idempotency key reuse');

  const overlappingSnapshot = structuredClone(updatedSnapshot);
  overlappingSnapshot.timeBlocks.push({
    id: 'block-overlap',
    taskId: null,
    title: '겹치는 일정',
    day: 'mon',
    startMinutes: 615,
    durationMinutes: 30,
    external: false,
    weekOffset: 1,
    date: '2026-08-31'
  });
  await expectStatus(await fetch(plannerUrl, {
    method: 'PUT',
    headers: headers({ 'If-Match': secondEtag, 'Idempotency-Key': randomUUID() }),
    body: JSON.stringify(overlappingSnapshot)
  }), 400, 'overlap validation');

  await expectStatus(await fetch(plannerUrl, {
    method: 'DELETE',
    headers: headers({ 'If-Match': firstEtag, 'Idempotency-Key': randomUUID() })
  }), 412, 'stale delete');

  await expectStatus(await fetch(plannerUrl, {
    method: 'DELETE',
    headers: headers({ 'If-Match': secondEtag, 'Idempotency-Key': randomUUID() })
  }), [200, 204], 'delete');
  await expectStatus(await fetch(plannerUrl, { headers: headers() }), 404, 'GET after delete');

  console.log('backend end-to-end verification passed');
} catch (error) {
  const logs = runCompose(['logs', '--no-color', '--tail', '160', 'backend', 'mysql'], environment, true);
  if (logs.stdout) process.stderr.write(logs.stdout);
  if (logs.stderr) process.stderr.write(logs.stderr);
  throw error;
} finally {
  if (process.env.KEEP_NOWLINE_E2E !== '1') {
    runCompose(['down', '--volumes', '--remove-orphans'], environment, true);
  }
}
