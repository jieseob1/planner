import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';

const context = process.env.NOWLINE_KUBE_CONTEXT || 'kind-nowline-local';
const namespace = 'nowline-local';
const forwards = [];

const fail = (message) => {
  throw new Error(message);
};

const kubectlJson = (args) => {
  const result = spawnSync('kubectl', ['--context', context, ...args, '-o', 'json'], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.status !== 0) fail(result.stderr || `kubectl ${args.join(' ')} failed`);
  return JSON.parse(result.stdout);
};

const startForward = (resource, remotePort) => new Promise((resolve, reject) => {
  const child = spawn('kubectl', [
    '--context', context,
    '--namespace', namespace,
    'port-forward',
    '--address=127.0.0.1',
    resource,
    `:${remotePort}`
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  forwards.push(child);
  let output = '';
  let settled = false;
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    child.kill('SIGTERM');
    reject(new Error(`Timed out starting port-forward for ${resource}: ${output}`));
  }, 15_000);
  const inspect = (chunk) => {
    output += chunk.toString();
    const match = output.match(/Forwarding from 127\.0\.0\.1:(\d+) ->/);
    if (!match || settled) return;
    settled = true;
    clearTimeout(timeout);
    resolve(Number(match[1]));
  };
  child.stdout.on('data', inspect);
  child.stderr.on('data', inspect);
  child.once('exit', (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    reject(new Error(`port-forward for ${resource} exited ${code}: ${output}`));
  });
});

const stopForwards = () => {
  for (const child of forwards) {
    if (!child.killed) child.kill('SIGTERM');
  }
};

let accessToken = '';
let frontendUrl = '';
let cleanupTestAccount = false;
const taskId = `task-${randomUUID()}`;
const outcomeId = `outcome-${randomUUID()}`;
const snapshot = {
  version: 1,
  plan: {
    year: 2026,
    annualDirection: '스케일 아웃 최초 상태',
    quarter: 3,
    quarterFocus: '두 Pod 동시성 검증',
    quarterEndDate: '2026-09-30'
  },
  plannerWeekOffset: 0,
  tasks: [{
    id: taskId,
    title: '두 Pod에서 같은 데이터 읽기',
    outcomeId,
    estimateMinutes: 30,
    status: 'todo',
    pinned: true,
    carryCount: 0
  }],
  timeBlocks: [],
  timeEntries: [],
  outcomes: [{
    id: outcomeId,
    title: '스케일 아웃 검증',
    parentTitle: 'Nowline 백엔드',
    current: 0,
    target: 1,
    unit: '회',
    confidence: 'high',
    lastUpdatedDays: 0,
    actualHours: 0,
    neededHours: 1,
    availableHours: 2,
    evidenceLabel: '런타임 검증',
    changeLabel: '최초 상태',
    attention: 'none'
  }],
  timer: null,
  review: {
    blocker: null,
    selectedTopTaskIds: [taskId],
    metricDraft: '',
    completedAt: null
  }
};

const headers = (extra = {}) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${accessToken}`,
  ...extra
});

const expectStatus = async (response, status, label) => {
  if (response.status !== status) {
    fail(`${label}: expected ${status}, got ${response.status}: ${await response.text()}`);
  }
  return response;
};

const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

const localTestToken = () => {
  const secretResource = kubectlJson([
    '--namespace', namespace,
    'get', 'secret', 'nowline-local-auth'
  ]);
  const secret = Buffer.from(secretResource.data?.['jwt-secret'] ?? '', 'base64').toString('utf8');
  if (!secret) fail('Local auth secret is missing jwt-secret');

  const deployment = kubectlJson([
    '--namespace', namespace,
    'get', 'deployment', 'nowline-backend'
  ]);
  const environment = Object.fromEntries(
    (deployment.spec?.template?.spec?.containers?.[0]?.env ?? [])
      .filter((entry) => typeof entry.value === 'string')
      .map((entry) => [entry.name, entry.value])
  );
  const now = Math.floor(Date.now() / 1_000);
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  const payload = base64url({
    iss: environment.NOWLINE_OIDC_ISSUER || 'https://nowline.local',
    sub: `k8s-scaleout-${randomUUID()}`,
    aud: environment.NOWLINE_OIDC_AUDIENCE || 'nowline-api',
    iat: now,
    nbf: now - 5,
    exp: now + 900,
    auth_time: now,
    name: 'Nowline scale-out verifier',
    email: `scaleout-${randomUUID()}@nowline.invalid`
  });
  const unsigned = `${header}.${payload}`;
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
};

try {
  const podList = kubectlJson([
    '--namespace', namespace,
    'get', 'pods',
    '--selector=app.kubernetes.io/component=backend'
  ]);
  const readyPods = podList.items.filter((pod) => (
    pod.status?.phase === 'Running'
    && pod.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True')
  ));
  if (readyPods.length < 2) {
    fail(`Expected at least two ready backend pods, found ${readyPods.length}`);
  }

  const [frontendPort, firstPodPort, secondPodPort] = await Promise.all([
    startForward('service/nowline-frontend', 80),
    startForward(`pod/${readyPods[0].metadata.name}`, 8080),
    startForward(`pod/${readyPods[1].metadata.name}`, 8080)
  ]);
  frontendUrl = `http://127.0.0.1:${frontendPort}`;
  const plannerUrl = `${frontendUrl}/api/v1/planner`;
  const podUrls = [firstPodPort, secondPodPort]
    .map((port) => `http://127.0.0.1:${port}/api/v1/planner`);

  accessToken = localTestToken();
  await expectStatus(await fetch(
    `${frontendUrl}/api/v1/account/consent`,
    {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ termsAccepted: true, privacyAccepted: true })
    }
  ), 200, 'policy consent');
  cleanupTestAccount = true;

  const createdResponse = await expectStatus(await fetch(plannerUrl, {
    method: 'PUT',
    headers: headers({ 'If-None-Match': '*', 'Idempotency-Key': randomUUID() }),
    body: JSON.stringify(snapshot)
  }), 201, 'frontend-proxied create');
  const firstEtag = createdResponse.headers.get('etag');
  if (firstEtag !== '"1"') fail(`Expected initial ETag "1", got ${firstEtag}`);

  for (const [index, podUrl] of podUrls.entries()) {
    const response = await expectStatus(await fetch(podUrl, { headers: headers() }), 200, `pod ${index + 1} read`);
    const body = await response.json();
    if (body.revision !== 1 || body.snapshot.plan.annualDirection !== snapshot.plan.annualDirection) {
      fail(`pod ${index + 1} did not reconstruct the shared database state`);
    }
  }

  const changes = ['첫 번째 Pod 수정', '두 번째 Pod 수정'].map((annualDirection) => ({
    ...snapshot,
    plan: { ...snapshot.plan, annualDirection }
  }));
  const race = await Promise.all(podUrls.map((podUrl, index) => fetch(podUrl, {
    method: 'PUT',
    headers: headers({ 'If-Match': firstEtag, 'Idempotency-Key': randomUUID() }),
    body: JSON.stringify(changes[index])
  })));
  const statuses = race.map((response) => response.status).sort((left, right) => left - right);
  if (statuses[0] !== 200 || statuses[1] !== 412) {
    const bodies = await Promise.all(race.map((response) => response.text()));
    fail(`Expected one 200 and one 412 from concurrent pods, got ${statuses.join(', ')}: ${bodies.join(' | ')}`);
  }

  const winnerIndex = race.findIndex((response) => response.status === 200);
  const winner = await race[winnerIndex].json();
  const secondEtag = race[winnerIndex].headers.get('etag');
  if (winner.revision !== 2 || secondEtag !== '"2"') {
    fail('Winning concurrent write did not produce revision 2');
  }

  for (const [index, podUrl] of podUrls.entries()) {
    const response = await expectStatus(await fetch(podUrl, { headers: headers() }), 200, `pod ${index + 1} post-race read`);
    const body = await response.json();
    if (body.revision !== 2 || body.snapshot.plan.annualDirection !== winner.snapshot.plan.annualDirection) {
      fail(`pod ${index + 1} disagrees with the winning revision`);
    }
  }

  const hpa = kubectlJson(['--namespace', namespace, 'get', 'horizontalpodautoscaler', 'nowline-backend']);
  if (hpa.spec?.minReplicas !== 2 || hpa.spec?.maxReplicas !== 6 || (hpa.status?.currentReplicas ?? 0) < 2) {
    fail('Backend HPA is not observing the two-replica Deployment');
  }

  console.log('local Kubernetes scale-out verification passed');
} finally {
  if (cleanupTestAccount && accessToken && frontendUrl) {
    try {
      await expectStatus(await fetch(`${frontendUrl}/api/v1/account`, {
        method: 'DELETE',
        headers: headers(),
        body: JSON.stringify({ confirmation: 'DELETE' })
      }), 204, 'isolated test account cleanup');
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
  stopForwards();
}
