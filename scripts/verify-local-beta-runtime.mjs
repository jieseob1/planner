import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright-core';

const baseUrl = (process.env.NOWLINE_BETA_URL || 'http://localhost:8088').replace(/\/$/, '');
const appUrl = `${baseUrl}/today`;
const timeoutMs = Number(process.env.NOWLINE_BETA_VERIFY_TIMEOUT_MS || 240_000);
const runId = `${Date.now()}-${randomBytes(4).toString('hex')}`;
const password = `Beta!${randomBytes(10).toString('hex')}A9`;
const users = [
  { email: `beta-one-${runId}@example.test`, firstName: 'Beta', lastName: 'One', marker: `BETA-ONE-${runId}` },
  { email: `beta-two-${runId}@example.test`, firstName: 'Beta', lastName: 'Two', marker: `BETA-TWO-${runId}` }
];
let browser;

const fail = (message) => { throw new Error(message); };

const waitForReady = async (url) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) return response;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  fail(`Readiness timed out for ${url}: ${lastError}`);
};

const attachErrorCapture = (page, errors) => {
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const location = message.location();
      const expectedEmptyPlanner = /status of 404/i.test(message.text())
        && location.url.endsWith('/api/v1/planner');
      if (expectedEmptyPlanner) return;
      errors.push(`console: ${message.text()}${location.url ? ` (${location.url})` : ''}`);
    }
  });
};

const acceptConsent = async (page) => {
  await page.getByRole('heading', { name: '내 계획을 안전하게 관리하기 위한 동의' }).waitFor({ timeout: 30_000 });
  await page.getByRole('checkbox').nth(0).check();
  await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('button', { name: '동의하고 시작하기' }).click();
  await page.getByRole('heading', { name: '이번 분기에 무엇을 바꿀까요?' }).waitFor({ timeout: 30_000 });
};

const completeOnboarding = async (page, marker) => {
  await page.getByPlaceholder('예: 기술 글 6개를 발행한다').fill(`${marker} 결과`);
  await page.getByRole('button', { name: '계속' }).click();
  await page.getByPlaceholder('예: 첫 글의 제목과 목차를 정한다').fill(`${marker} 첫 실행`);
  await page.getByRole('button', { name: '계속' }).click();
  await page.locator('button[role="radio"]:not([disabled])').first().click();
  const save = page.waitForResponse((response) => (
    response.request().method() === 'PUT' && response.url().endsWith('/api/v1/planner')
  ));
  await page.getByRole('button', { name: /첫 실행 만들기/ }).click();
  const response = await save;
  if (!response.ok()) fail(`Onboarding save failed with ${response.status()}: ${await response.text()}`);
  await page.getByRole('heading', { name: '오늘은 하나를 끝냅니다.' }).waitFor({ timeout: 30_000 });
  await page.getByText('서버에 저장됨').waitFor({ timeout: 30_000 });
};

const openRegistration = async (page) => {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '계획을 실행으로 연결하세요' }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForURL(/\/idp\/realms\/nowline\/protocol\/openid-connect\/auth/, { timeout: 30_000 });
  const registrationLink = page.locator('#kc-registration a');
  await registrationLink.waitFor({ state: 'visible', timeout: 30_000 });
  await registrationLink.click();
  await page.waitForURL(/\/registration(?:\?|\/)/, { timeout: 30_000 });
};

const register = async (page, user) => {
  await openRegistration(page);
  await page.locator('#firstName').fill(user.firstName);
  await page.locator('#lastName').fill(user.lastName);
  await page.locator('#email').fill(user.email);
  const username = page.locator('#username');
  if (await username.count()) await username.fill(user.email);
  await page.locator('#password').fill(password);
  await page.locator('#password-confirm').fill(password);
  await page.locator('#kc-form-buttons input[type="submit"], #kc-form-buttons button[type="submit"]').click();
  await page.waitForURL((url) => url.origin === new URL(baseUrl).origin, { timeout: 60_000 });
  await acceptConsent(page);
  await completeOnboarding(page, user.marker);
};

const login = async (page, user) => {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '계획을 실행으로 연결하세요' }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '로그인' }).click();
  await page.locator('#username').fill(user.email);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  await page.waitForURL((url) => url.origin === new URL(baseUrl).origin, { timeout: 60_000 });
  await page.getByRole('heading', { name: '오늘은 하나를 끝냅니다.' }).waitFor({ timeout: 30_000 });
};

const assertEntitlement = async (page) => {
  await page.getByRole('button', { name: '설정과 연동' }).click();
  await page.getByRole('heading', { name: '이용 플랜' }).waitFor({ timeout: 30_000 });
  await page.getByText('무료 베타', { exact: true }).waitFor();
  await page.getByText('결제 없이 제공되는 베타 권한', { exact: true }).waitFor();
};

const verifyUser = async (user, forbiddenMarker) => {
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  attachErrorCapture(page, errors);
  await register(page, user);
  await page.getByText(user.marker, { exact: false }).first().waitFor({ timeout: 30_000 });
  if (await page.getByText(forbiddenMarker, { exact: false }).count()) {
    fail(`User ${user.email} received another user's planner data`);
  }
  await assertEntitlement(page);
  if (errors.length) fail(`Browser errors for ${user.email}: ${errors.join('\n')}`);
  await context.close();
};

try {
  await waitForReady(`${baseUrl}/healthz`);
  const discovery = await waitForReady(`${baseUrl}/idp/realms/nowline/.well-known/openid-configuration`);
  const metadata = await discovery.json();
  const expectedIssuer = `${baseUrl}/idp/realms/nowline`;
  if (metadata.issuer !== expectedIssuer) fail(`Expected issuer ${expectedIssuer}, got ${metadata.issuer}`);

  const devToken = await fetch(`${baseUrl}/api/v1/auth/dev-token`);
  if (![401, 404].includes(devToken.status)) {
    fail(`Development token endpoint must not return a token, got ${devToken.status}`);
  }

  browser = await chromium.launch({ channel: 'chrome', headless: true });
  await verifyUser(users[0], users[1].marker);
  await verifyUser(users[1], users[0].marker);

  const persistenceErrors = [];
  const persistenceContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const persistencePage = await persistenceContext.newPage();
  attachErrorCapture(persistencePage, persistenceErrors);
  await login(persistencePage, users[0]);
  await persistencePage.getByText(users[0].marker, { exact: false }).first().waitFor({ timeout: 30_000 });
  if (await persistencePage.getByText(users[1].marker, { exact: false }).count()) {
    fail('Persisted account loaded another user\'s planner data');
  }
  if (persistenceErrors.length) fail(`Browser errors after relogin: ${persistenceErrors.join('\n')}`);
  await persistenceContext.close();

  console.log('local beta multi-user runtime verified');
} finally {
  await browser?.close();
}
