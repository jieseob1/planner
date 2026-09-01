import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { startFakeGoogleCalendar } from './lib/fake-google-calendar.mjs';

const repositoryRoot = new URL('..', import.meta.url).pathname;
const projectName = `nowline-production-e2e-${process.pid}`;
const tempDirectory = mkdtempSync(join(tmpdir(), 'nowline-production-e2e-'));
const overrideFile = join(tempDirectory, 'compose.override.yaml');
let fakeGoogle;
let browser;

const fail = (message) => { throw new Error(message); };
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options
  });
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed\n${result.stderr || result.stdout || ''}`);
  return result.stdout;
};

const reservePort = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.unref();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') return reject(new Error('Could not reserve a TCP port'));
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
  fail(`Readiness timed out for ${url}: ${lastError}`);
};

const expectResponse = async (response, expected, label) => {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(response.status)) {
    fail(`${label}: expected ${allowed.join('/')}, got ${response.status}: ${await response.text()}`);
  }
  return response;
};

const runCompose = (args, environment, allowFailure = false) => {
  const result = spawnSync('docker', [
    'compose', '-p', projectName, '-f', 'compose.yaml', '-f', overrideFile, ...args
  ], {
    cwd: repositoryRoot,
    env: environment,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: allowFailure ? 'pipe' : 'inherit'
  });
  if (!allowFailure && result.status !== 0) fail(`docker compose ${args.join(' ')} failed`);
  return result;
};

const attachErrorCapture = (page, errors, captureState = {
  allowExpectedOfflineErrors: false,
  allowedHttpStatusConsole: new Set()
}) => {
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    const expectedOfflineError = captureState.allowExpectedOfflineErrors
      && /(Failed to fetch|ERR_INTERNET_DISCONNECTED|NetworkError|\/api\/v1\/planner)/i.test(text);
    const statusMatch = text.match(/status of (\d{3})/i);
    const expectedHttpStatus = statusMatch
      && captureState.allowedHttpStatusConsole.has(Number(statusMatch[1]));
    if (!expectedOfflineError && !expectedHttpStatus) errors.push(`console: ${text}`);
  });
  return captureState;
};

const acceptConsent = async (page) => {
  await page.getByRole('heading', { name: '내 계획을 안전하게 관리하기 위한 동의' }).waitFor();
  const checks = page.getByRole('checkbox');
  await checks.nth(0).check();
  await checks.nth(1).check();
  await page.getByRole('button', { name: '동의하고 시작하기' }).click();
  await page.getByRole('heading', { name: '오늘은 하나를 끝냅니다.' }).waitFor();
  await page.getByText('서버에 저장됨').waitFor({ timeout: 20_000 });
};

const exerciseDesktop = async (frontendUrl, backendUrl) => {
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const captureState = attachErrorCapture(page, errors, {
    allowExpectedOfflineErrors: false,
    allowedHttpStatusConsole: new Set([404])
  });
  await page.goto(frontendUrl, { waitUntil: 'domcontentloaded' });
  await acceptConsent(page);
  captureState.allowedHttpStatusConsole.delete(404);

  await page.goto(`${frontendUrl}/onboarding`);
  await page.getByPlaceholder('예: 기술 글 6개를 발행한다').fill('운영 E2E 결과를 검증한다');
  await page.getByRole('button', { name: '계속' }).click();
  await page.getByPlaceholder('예: 첫 글의 제목과 목차를 정한다').fill('인증 전체 흐름을 실행한다');
  await page.getByRole('button', { name: '계속' }).click();
  const availableSlot = page.locator('button[role="radio"]:not([disabled])').first();
  await availableSlot.click();
  const onboardingSavePromise = page.waitForResponse((response) => (
    response.request().method() === 'PUT' && response.url().endsWith('/api/v1/planner')
  ));
  await page.getByRole('button', { name: /첫 실행 만들기/ }).click();
  const onboardingSave = await onboardingSavePromise;
  if (!onboardingSave.ok()) {
    fail(`Onboarding save failed with ${onboardingSave.status()}: ${await onboardingSave.text()}`);
  }
  await page.getByRole('heading', { name: '오늘은 하나를 끝냅니다.' }).waitFor();
  await page.getByText('서버에 저장됨').waitFor({ timeout: 20_000 });

  const accessToken = await page.evaluate(() => window.sessionStorage.getItem('nowline.local-access-token'));
  if (!accessToken) fail('Browser local-auth session did not store an access token in sessionStorage');
  const authHeaders = { Accept: 'application/json', Authorization: `Bearer ${accessToken}` };
  const currentResponse = await expectResponse(await fetch(`${backendUrl}/api/v1/planner`, { headers: authHeaders }), 200, 'conflict base read');
  const etag = currentResponse.headers.get('etag');
  const envelope = await currentResponse.json();
  if (!etag) fail('Conflict base read did not return an ETag');

  captureState.allowExpectedOfflineErrors = true;
  await context.setOffline(true);
  await page.getByPlaceholder('예: API 응답 비교하기').fill('오프라인에서 보존할 다음 행동');
  await page.getByRole('button', { name: '수집함에 추가' }).click();
  await page.getByText('오프라인', { exact: true }).waitFor();

  envelope.snapshot.plan.quarterFocus = '서버에서 동시에 변경한 분기 결과';
  await expectResponse(await fetch(`${backendUrl}/api/v1/planner`, {
    method: 'PUT',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
      'If-Match': etag,
      'Idempotency-Key': randomUUID()
    },
    body: JSON.stringify(envelope.snapshot)
  }), 200, 'conflicting server update');

  await context.setOffline(false);
  captureState.allowExpectedOfflineErrors = false;
  captureState.allowedHttpStatusConsole.add(412);
  await page.getByText('서버 저장 충돌').waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: '변경 비교' }).click();
  await page.getByRole('heading', { name: '기기와 서버의 변경을 비교합니다' }).waitFor({ timeout: 20_000 });
  captureState.allowedHttpStatusConsole.delete(412);
  await page.getByRole('button', { name: '선택 항목 병합' }).click();
  await page.getByText('서버에 저장됨').waitFor({ timeout: 20_000 });

  await page.goto(`${frontendUrl}/plans`);
  await page.getByRole('heading', { name: '연간·분기 계획' }).waitFor();
  await page.getByRole('button', { name: '새 계획' }).click();
  await page.getByLabel('계획 이름').fill('운영 E2E 다음 분기');
  await page.getByLabel('이번 분기 핵심 결과').fill('공개 운영 시나리오를 자동 검증한다');
  await page.getByRole('button', { name: '초안 만들기' }).click();
  await page.getByText('운영 E2E 다음 분기').waitFor();
  await page.locator('article').filter({ hasText: '운영 E2E 다음 분기' })
    .getByRole('button', { name: '변경 이력' }).click();
  await page.getByRole('heading', { name: '운영 E2E 다음 분기 변경 이력' }).waitFor();
  await page.getByText('계획 생성').waitFor();
  await page.getByRole('button', { name: '닫기' }).click();

  await page.goto(`${frontendUrl}/settings`);
  await page.getByRole('heading', { name: '설정과 연동' }).waitFor();
  await page.getByRole('button', { name: 'Google Calendar 연결' }).click();
  await page.getByText('Google Calendar 연결을 완료했습니다').waitFor({ timeout: 20_000 });
  await page.locator('option').filter({ hasText: 'Nowline E2E Calendar' })
    .waitFor({ state: 'attached', timeout: 20_000 });
  await page.getByRole('button', { name: /지금 동기화/ }).click();
  await page.getByText('동기화를 요청했습니다').waitFor();

  await page.getByLabel('시간대').selectOption('Asia/Seoul');
  await page.getByLabel('오늘 계획 알림', { exact: true }).fill('09:15');
  await page.getByLabel('매일 오늘 계획 알림 받기').check();
  await page.getByRole('button', { name: '알림 시간 저장' }).click();
  await page.getByText('알림 시간과 시간대를 저장했습니다.').waitFor();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /데이터 내보내기/ }).click();
  const download = await downloadPromise;
  if (!download.suggestedFilename().startsWith('nowline-export-')) fail('Account export download filename is invalid');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /연결 해제/ }).click();
  await page.getByText('Google Calendar 연결과 저장된 토큰을 삭제했습니다.').waitFor({ timeout: 20_000 });

  await page.getByRole('button', { name: /계정 삭제/ }).click();
  await page.getByLabel('확인을 위해 DELETE 입력').fill('DELETE');
  await page.getByRole('button', { name: '영구 삭제' }).click();
  await page.getByRole('heading', { name: '계획을 실행으로 연결하세요' }).waitFor({ timeout: 20_000 });

  if (errors.length > 0) fail(`Desktop browser emitted errors:\n${errors.join('\n')}`);
  await context.close();
};

const exerciseMobile = async (frontendUrl) => {
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const captureState = attachErrorCapture(page, errors, {
    allowExpectedOfflineErrors: false,
    allowedHttpStatusConsole: new Set([404])
  });
  await page.goto(`${frontendUrl}/today`, { waitUntil: 'domcontentloaded' });
  await acceptConsent(page);
  captureState.allowedHttpStatusConsole.delete(404);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) fail(`Mobile Today has ${overflow}px horizontal overflow`);
  await page.goto(`${frontendUrl}/plans`);
  await page.getByRole('heading', { name: '연간·분기 계획' }).waitFor();
  await page.goto(`${frontendUrl}/settings`);
  await page.getByRole('heading', { name: '설정과 연동' }).waitFor();
  const minTarget = await page.evaluate(() => {
    const controls = [...document.querySelectorAll('button:not([disabled]), input, select')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight;
      });
    return controls.reduce((minimum, element) => {
      const labelledControl = element.matches('input[type="checkbox"], input[type="radio"]')
        ? element.closest('label')
        : null;
      const rect = (labelledControl ?? element).getBoundingClientRect();
      return Math.min(minimum, rect.height);
    }, Infinity);
  });
  if (minTarget < 44) fail(`Mobile interactive target is below 44 CSS px: ${minTarget}`);
  if (errors.length > 0) fail(`Mobile browser emitted errors:\n${errors.join('\n')}`);
  await context.close();
};

const backendPort = await reservePort();
const frontendPort = await reservePort();
const environment = {
  ...process.env,
  NOWLINE_BACKEND_PORT: String(backendPort),
  NOWLINE_FRONTEND_PORT: String(frontendPort),
  NOWLINE_POSTGRES_VOLUME: `${projectName}-postgres-data`
};
const frontendUrl = `http://127.0.0.1:${frontendPort}`;
const backendUrl = `http://127.0.0.1:${backendPort}`;

try {
  fakeGoogle = await startFakeGoogleCalendar();
  const encryptionKey = randomBytes(32).toString('base64');
  writeFileSync(overrideFile, `services:\n  backend:\n    extra_hosts:\n      - "host.docker.internal:host-gateway"\n    environment:\n      NOWLINE_GOOGLE_CLIENT_ID: production-e2e-client\n      NOWLINE_GOOGLE_CLIENT_SECRET: production-e2e-secret\n      NOWLINE_GOOGLE_REDIRECT_URI: ${backendUrl}/api/v1/integrations/google-calendar/oauth/callback\n      NOWLINE_GOOGLE_FRONTEND_SUCCESS_URI: ${frontendUrl}/settings\n      NOWLINE_GOOGLE_WEBHOOK_URI: ${backendUrl}/api/v1/calendar/google/webhook\n      NOWLINE_GOOGLE_AUTHORIZATION_URI: ${fakeGoogle.browserBaseUrl}/auth\n      NOWLINE_GOOGLE_TOKEN_URI: ${fakeGoogle.containerBaseUrl}/token\n      NOWLINE_GOOGLE_REVOKE_URI: ${fakeGoogle.containerBaseUrl}/revoke\n      NOWLINE_GOOGLE_API_BASE_URI: ${fakeGoogle.containerBaseUrl}/calendar/v3\n      NOWLINE_INTEGRATION_ENCRYPTION_KEY_BASE64: ${encryptionKey}\n      NOWLINE_INTEGRATION_POLL_DELAY_MS: "200"\n`);

  run('npm', ['run', 'build'], { env: { ...process.env, VITE_AUTH_MODE: 'local', VITE_API_BASE_URL: '' }, stdio: 'inherit' });
  run('./mvnw', ['-q', 'package', '-DskipTests'], { cwd: `${repositoryRoot}backend`, stdio: 'inherit' });
  runCompose(['up', '-d', '--build', 'postgres', 'backend', 'frontend'], environment);
  await waitForReady(`${backendUrl}/actuator/health/readiness`);
  await waitForReady(`${frontendUrl}/healthz`);

  browser = await chromium.launch({ channel: process.env.NOWLINE_E2E_BROWSER_CHANNEL || 'chrome', headless: true });
  await exerciseDesktop(frontendUrl, backendUrl);
  await exerciseMobile(frontendUrl);
  if (fakeGoogle.stats.tokenRequests < 2 || fakeGoogle.stats.revokeRequests !== 1) {
    fail(`Calendar connect/refresh/revoke calls were incomplete: ${JSON.stringify(fakeGoogle.stats)}`);
  }
  console.log('production authenticated browser end-to-end verification passed');
} catch (error) {
  const logs = runCompose(['logs', '--no-color', '--tail', '200', 'backend', 'frontend', 'postgres'], environment, true);
  if (logs.stdout) process.stderr.write(logs.stdout);
  if (logs.stderr) process.stderr.write(logs.stderr);
  throw error;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (fakeGoogle) await fakeGoogle.close().catch(() => {});
  if (process.env.KEEP_NOWLINE_E2E !== '1') {
    runCompose(['down', '--volumes', '--remove-orphans'], environment, true);
  }
  rmSync(tempDirectory, { recursive: true, force: true });
}
