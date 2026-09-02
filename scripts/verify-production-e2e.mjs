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

const activateByKeyboard = async (page, locator, key = 'Enter') => {
  await locator.focus();
  await page.keyboard.press(key);
};

const waitForPlannerSaved = async (page) => {
  await page.waitForFunction(() => (
    [...document.querySelectorAll('.save-status__label')]
      .some((element) => element.textContent?.trim() === '서버에 저장됨')
  ), { timeout: 20_000 });
};

const runAndWaitForPlannerSave = async (page, action, label) => {
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'PUT' && response.url().endsWith('/api/v1/planner')
  ), { timeout: 20_000 });
  await action();
  const response = await responsePromise;
  if (!response.ok()) {
    const requestHeaders = response.request().headers();
    fail(`${label} save failed with ${response.status()} (If-Match: ${requestHeaders['if-match'] ?? 'missing'}, If-None-Match: ${requestHeaders['if-none-match'] ?? 'missing'}): ${await response.text()}`);
  }
  await waitForPlannerSaved(page);
};

const activateAndWaitForPlannerSave = async (page, locator, label, key = 'Enter') => (
  runAndWaitForPlannerSave(page, () => activateByKeyboard(page, locator, key), label)
);

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
  await activateByKeyboard(page, checks.nth(0), 'Space');
  await activateByKeyboard(page, checks.nth(1), 'Space');
  await activateByKeyboard(page, page.getByRole('button', { name: '동의하고 시작하기' }));
  await page.getByRole('heading', { name: '이번 분기에 무엇을 바꿀까요?' }).waitFor();
};

const enterAppFromLanding = async (page) => {
  const startLink = page.getByRole('link', { name: '웹앱 바로 시작' }).first();
  await startLink.waitFor();
  await activateByKeyboard(page, startLink);
  await page.waitForURL(/\/today$/);
};

const completeOnboarding = async (page, prefix) => {
  await page.getByPlaceholder('예: 기술 글 6개를 발행한다').fill(`${prefix} 결과를 검증한다`);
  await activateByKeyboard(page, page.getByRole('button', { name: '계속' }));
  await page.getByPlaceholder('예: 첫 글의 제목과 목차를 정한다').fill(`${prefix} 첫 실행을 완료한다`);
  await activateByKeyboard(page, page.getByRole('button', { name: '계속' }));
  const availableSlot = page.locator('button[role="radio"]:not([disabled])').first();
  await activateByKeyboard(page, availableSlot);
  const onboardingSavePromise = page.waitForResponse((response) => (
    response.request().method() === 'PUT' && response.url().endsWith('/api/v1/planner')
  ));
  await activateByKeyboard(page, page.getByRole('button', { name: /첫 실행 만들기/ }));
  const onboardingSave = await onboardingSavePromise;
  if (!onboardingSave.ok()) {
    fail(`Onboarding save failed with ${onboardingSave.status()}: ${await onboardingSave.text()}`);
  }
  await page.getByRole('heading', { name: '오늘 할 일과 일정을 정리합니다.' }).waitFor();
  await waitForPlannerSaved(page);
};

const assertNoDocumentOverflow = async (page, label) => {
  const result = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth - viewportWidth;
    const offenders = [...document.querySelectorAll('body *')].flatMap((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || (rect.left >= -1 && rect.right <= viewportWidth + 1)) return [];
      return [{
        tag: element.tagName.toLowerCase(),
        className: element.getAttribute('class') ?? '',
        left: Math.round(rect.left * 100) / 100,
        right: Math.round(rect.right * 100) / 100,
        width: Math.round(rect.width * 100) / 100
      }];
    });
    return { overflow, offenders: offenders.slice(0, 8) };
  });
  if (result.overflow > 1) {
    fail(`${label} has ${result.overflow}px horizontal overflow: ${JSON.stringify(result.offenders)}`);
  }
};

const assertVisibleTargets = async (page, label) => {
  const undersizedTargets = await page.evaluate(() => {
    const controls = [...document.querySelectorAll('button:not([disabled]), a[href], input, select, textarea')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight;
      });
    return controls.flatMap((element) => {
      const labelledControl = element.matches('input[type="checkbox"], input[type="radio"]')
        ? element.closest('label')
        : null;
      const rect = (labelledControl ?? element).getBoundingClientRect();
      if (rect.height >= 44) return [];
      return [{
        height: Math.round(rect.height * 100) / 100,
        tag: element.tagName.toLowerCase(),
        label: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '',
        className: element.getAttribute('class') ?? ''
      }];
    });
  });
  if (undersizedTargets.length > 0) {
    fail(`${label} interactive target is below 44 CSS px: ${JSON.stringify(undersizedTargets.slice(0, 5))}`);
  }
};

const assertVisibleControlsAreLabelled = async (page, label) => {
  const unlabelledControls = await page.evaluate(() => {
    const controls = [...document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight;
      });
    return controls.flatMap((element) => {
      const labelledBy = element.getAttribute('aria-labelledby');
      const hasReferencedLabel = labelledBy?.split(/\s+/).some((id) => document.getElementById(id)?.textContent?.trim());
      const nativeLabels = 'labels' in element ? element.labels : null;
      const hasName = Boolean(
        element.getAttribute('aria-label')?.trim()
        || hasReferencedLabel
        || (nativeLabels && nativeLabels.length > 0)
        || element.textContent?.trim()
        || element.getAttribute('title')?.trim()
      );
      if (hasName) return [];
      return [{
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute('type') ?? '',
        className: element.getAttribute('class') ?? ''
      }];
    });
  });
  if (unlabelledControls.length > 0) {
    fail(`${label} has visible controls without an accessible label: ${JSON.stringify(unlabelledControls.slice(0, 5))}`);
  }
};

const assertDialogFitsViewport = async (dialog, label) => {
  await dialog.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => (
      animation.finished.catch(() => undefined)
    )));
  });
  const metrics = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight
    };
  });
  if (
    metrics.top < -1
    || metrics.left < -1
    || metrics.right > metrics.viewportWidth + 1
    || metrics.bottom > metrics.viewportHeight + 1
  ) {
    fail(`${label} escapes the zoomed viewport: ${JSON.stringify(metrics)}`);
  }
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
  await enterAppFromLanding(page);
  await acceptConsent(page);
  captureState.allowedHttpStatusConsole.delete(404);
  await completeOnboarding(page, '운영 E2E');

  await activateByKeyboard(page, page.getByRole('button', { name: /지금 시작/ }));
  await activateByKeyboard(page, page.getByRole('button', { name: /종료/ }));
  await page.getByRole('dialog', { name: '이번 실행을 정리할까요?' }).waitFor();
  await page.getByPlaceholder('예: 다이어그램 초안 링크, 확인한 실패 케이스').fill('운영 E2E 실행 근거');
  await activateAndWaitForPlannerSave(
    page,
    page.getByRole('button', { name: /이 작업은 완료/ }),
    'Task completion'
  );

  await page.goto(`${frontendUrl}/planner`);
  await activateByKeyboard(page, page.getByRole('button', { name: /새 할 일/ }));
  await page.getByRole('dialog', { name: '새 할 일' }).getByLabel('할 일').fill('운영 E2E 회고 준비');
  await activateAndWaitForPlannerSave(
    page,
    page.getByRole('dialog', { name: '새 할 일' }).getByRole('button', { name: '할 일 추가' }),
    'Planner task creation'
  );
  await page.getByRole('button', { name: '운영 E2E 회고 준비 일정에 배치', exact: true }).waitFor();

  await page.goto(`${frontendUrl}/goals`);
  await activateByKeyboard(page, page.getByRole('button', { name: '계획과 결과 편집' }));
  const planEditor = page.getByRole('dialog', { name: '계획 편집' });
  await planEditor.getByLabel('연간 방향').fill('운영 가능한 계획 서비스 완성');
  await activateAndWaitForPlannerSave(
    page,
    planEditor.getByRole('button', { name: '계획 반영' }),
    'Goal plan update'
  );
  await page.getByText('운영 가능한 계획 서비스 완성').waitFor();

  await page.goto(`${frontendUrl}/review`);
  await page.getByPlaceholder('예: 24').fill('1');
  await page.getByPlaceholder('예: 결제 대시보드 9월 2일 확인').fill('운영 E2E 주간 점검 근거');
  await activateAndWaitForPlannerSave(
    page,
    page.getByRole('button', { name: '반영', exact: true }),
    'Review metric update'
  );
  await activateAndWaitForPlannerSave(
    page,
    page.getByRole('radio', { name: /일이 너무 컸어요/ }),
    'Review blocker update',
    'Space'
  );
  await activateAndWaitForPlannerSave(
    page,
    page.getByRole('button', { name: /운영 E2E 회고 준비/ }),
    'Review priority selection'
  );
  await activateAndWaitForPlannerSave(
    page,
    page.getByRole('button', { name: /주간 점검 완료/ }),
    'Review completion'
  );
  await page.getByRole('heading', { name: '다음 주의 기준이 정해졌습니다.' }).waitFor();
  await page.goto(`${frontendUrl}/today`);
  await waitForPlannerSaved(page);

  const accessToken = await page.evaluate(() => window.sessionStorage.getItem('nowline.local-access-token'));
  if (!accessToken) fail('Browser local-auth session did not store an access token in sessionStorage');
  const authHeaders = { Accept: 'application/json', Authorization: `Bearer ${accessToken}` };
  const currentResponse = await expectResponse(await fetch(`${backendUrl}/api/v1/planner`, { headers: authHeaders }), 200, 'conflict base read');
  const etag = currentResponse.headers.get('etag');
  const envelope = await currentResponse.json();
  if (!etag) fail('Conflict base read did not return an ETag');

  captureState.allowExpectedOfflineErrors = true;
  await context.setOffline(true);
  await page.getByLabel('빠른 메모').fill('오프라인에서 보존할 다음 행동');
  await page.getByRole('button', { name: '추가', exact: true }).click();
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
  await activateByKeyboard(page, page.getByRole('button', { name: '변경 비교' }));
  await page.getByRole('heading', { name: '기기와 서버의 변경을 비교합니다' }).waitFor({ timeout: 20_000 });
  captureState.allowedHttpStatusConsole.delete(412);
  await activateAndWaitForPlannerSave(
    page,
    page.getByRole('button', { name: '선택 항목 병합' }),
    'Conflict merge'
  );

  await page.goto(`${frontendUrl}/plans`);
  await page.getByRole('heading', { name: '연간·분기 계획' }).waitFor();
  const newPlanButton = page.getByRole('button', { name: '새 계획' });
  await newPlanButton.focus();
  await page.keyboard.press('Enter');
  const createPlanDialog = page.getByRole('dialog', { name: '새 연간·분기 계획' });
  await createPlanDialog.waitFor();
  const quarterFocusInput = createPlanDialog.getByLabel('이번 분기 초점');
  if (!await quarterFocusInput.evaluate((element) => element === document.activeElement)) {
    fail('New plan dialog did not move focus to its primary input');
  }
  await page.getByLabel('계획 이름').fill('운영 E2E 다음 분기');
  await quarterFocusInput.fill('공개 운영 시나리오를 자동 검증한다');
  await activateByKeyboard(page, page.getByRole('button', { name: '초안 만들기' }));
  await page.getByText('운영 E2E 다음 분기').waitFor();
  await page.locator('article').filter({ hasText: '운영 E2E 다음 분기' })
    .getByRole('button', { name: '변경 이력' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: '운영 E2E 다음 분기 변경 이력' }).waitFor();
  await page.getByText('계획 생성').waitFor();
  await activateByKeyboard(page, page.getByRole('button', { name: '닫기' }));

  await page.goto(`${frontendUrl}/settings`);
  await page.getByRole('heading', { name: '설정과 연동' }).waitFor();
  await activateByKeyboard(page, page.getByRole('button', { name: 'Google Calendar 연결' }));
  await page.getByText('Google Calendar 연결을 완료했습니다').waitFor({ timeout: 20_000 });
  await page.locator('option').filter({ hasText: 'Nowline E2E Calendar' })
    .waitFor({ state: 'attached', timeout: 20_000 });
  await activateByKeyboard(page, page.getByRole('button', { name: /지금 동기화/ }));
  await page.getByText('동기화를 요청했습니다').waitFor();

  await page.getByLabel('시간대').selectOption('Asia/Seoul');
  await page.getByLabel('오늘 계획 알림', { exact: true }).fill('09:15');
  await page.getByLabel('매일 오늘 계획 알림 받기').check();
  await activateByKeyboard(page, page.getByRole('button', { name: '알림 시간 저장' }));
  await page.getByText('알림 시간과 시간대를 저장했습니다.').waitFor();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /데이터 내보내기/ }).click();
  const download = await downloadPromise;
  if (!download.suggestedFilename().startsWith('goals-to-today-export-')) fail('Account export download filename is invalid');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /연결 해제/ }).click();
  await page.getByText('Google Calendar 연결과 저장된 토큰을 삭제했습니다.').waitFor({ timeout: 20_000 });

  const deleteAccountButton = page.getByRole('button', { name: /계정 삭제/ });
  await deleteAccountButton.focus();
  await page.keyboard.press('Enter');
  const deleteDialog = page.getByRole('dialog', { name: '계정과 모든 데이터를 삭제할까요?' });
  await deleteDialog.waitFor();
  const closeDeleteDialogButton = deleteDialog.getByRole('button', { name: '닫기' });
  if (!await closeDeleteDialogButton.evaluate((element) => element === document.activeElement)) {
    fail('Delete modal did not focus its first actionable control');
  }
  await page.keyboard.press('Shift+Tab');
  const cancelDeleteButton = deleteDialog.getByRole('button', { name: '취소' });
  if (!await cancelDeleteButton.evaluate((element) => element === document.activeElement)) {
    fail('Delete modal did not trap backward keyboard focus');
  }
  await page.keyboard.press('Escape');
  await deleteDialog.waitFor({ state: 'detached' });
  if (!await deleteAccountButton.evaluate((element) => element === document.activeElement)) {
    fail('Delete modal did not restore focus to its trigger');
  }
  await page.keyboard.press('Enter');
  await page.getByLabel('확인을 위해 DELETE 입력').fill('DELETE');
  await activateByKeyboard(page, page.getByRole('button', { name: '영구 삭제' }));
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
  await completeOnboarding(page, '모바일 E2E');
  await page.getByLabel('빠른 메모').fill('모바일에서 추가한 다음 행동');
  await runAndWaitForPlannerSave(
    page,
    () => page.getByRole('button', { name: '추가', exact: true }).click(),
    'Mobile quick capture'
  );
  await page.getByText('수집함에 넣었어요.').waitFor();
  await assertNoDocumentOverflow(page, 'Mobile Today');
  await assertVisibleTargets(page, 'Mobile Today');

  await page.goto(`${frontendUrl}/planner`);
  await page.getByRole('heading', { name: '이번 주 할 일과 일정을 함께 봅니다.' }).waitFor();
  await page.getByRole('button', { name: /새 할 일/ }).click();
  const addDialog = page.getByRole('dialog', { name: '새 할 일' });
  await addDialog.getByLabel('할 일').fill('모바일 계획함 QA');
  await runAndWaitForPlannerSave(
    page,
    () => addDialog.getByRole('button', { name: '할 일 추가' }).click(),
    'Mobile planner task creation'
  );
  await page.getByRole('button', { name: '모바일 계획함 QA 일정에 배치', exact: true }).waitFor();
  await assertNoDocumentOverflow(page, 'Mobile Planner');

  await page.goto(`${frontendUrl}/goals`);
  await page.getByRole('heading', { name: '결과와 결정을 한 화면에서 봅니다.' }).waitFor();
  await assertNoDocumentOverflow(page, 'Mobile Goals');

  await page.goto(`${frontendUrl}/review`);
  await page.getByRole('heading', { name: '한 주를 닫고, 다음 주를 고릅니다.' }).waitFor();
  await assertNoDocumentOverflow(page, 'Mobile Review');

  await page.goto(`${frontendUrl}/plans`);
  await page.getByRole('heading', { name: '연간·분기 계획' }).waitFor();
  await assertNoDocumentOverflow(page, 'Mobile Plans');
  await page.goto(`${frontendUrl}/settings`);
  await page.getByRole('heading', { name: '설정과 연동' }).waitFor();
  await assertNoDocumentOverflow(page, 'Mobile Settings');
  await assertVisibleTargets(page, 'Mobile Settings');
  if (errors.length > 0) fail(`Mobile browser emitted errors:\n${errors.join('\n')}`);
  await context.close();
};

const exerciseKeyboardAndZoom = async (frontendUrl) => {
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  attachErrorCapture(page, errors);
  await page.goto(`${frontendUrl}/today`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '오늘 할 일과 일정을 정리합니다.' }).waitFor();

  await page.keyboard.press('Tab');
  const skipFocused = await page.evaluate(() => document.activeElement?.textContent?.trim() === '본문으로 건너뛰기');
  if (!skipFocused) fail('Keyboard flow did not focus the skip link first');
  await page.keyboard.press('Enter');
  const mainFocused = await page.evaluate(() => document.activeElement?.id === 'main-content');
  if (!mainFocused) fail('Skip link did not move focus to the main content');

  const captureButton = page.getByRole('button', { name: '빠른 수집' }).first();
  await captureButton.focus();
  await page.keyboard.press('Enter');
  const captureFocused = await page.evaluate(() => document.activeElement?.id === 'quick-capture');
  if (!captureFocused) fail('Keyboard Capture action did not focus the quick-capture input');

  // At 200% browser zoom a 1440x900 display exposes a 720x450 CSS viewport.
  // CSS `zoom` would scale an already-laid-out desktop page without updating
  // media queries, so use the equivalent CSS viewport for a faithful layout check.
  await page.setViewportSize({ width: 720, height: 450 });
  for (const route of ['/today', '/planner', '/goals', '/review', '/plans', '/settings']) {
    await page.goto(`${frontendUrl}${route}`);
    await page.locator('#main-content').waitFor();
    await assertNoDocumentOverflow(page, `200% zoom ${route}`);
    await assertVisibleControlsAreLabelled(page, `Accessible labels ${route}`);
  }

  await page.goto(`${frontendUrl}/plans`);
  const newPlanButton = page.getByRole('button', { name: '새 계획' });
  await activateByKeyboard(page, newPlanButton);
  const newPlanDialog = page.getByRole('dialog', { name: '새 연간·분기 계획' });
  await newPlanDialog.waitFor();
  await assertDialogFitsViewport(newPlanDialog, '200% zoom new-plan dialog');
  await page.keyboard.press('Escape');
  await newPlanDialog.waitFor({ state: 'detached' });
  if (!await newPlanButton.evaluate((element) => element === document.activeElement)) {
    fail('Zoomed new-plan dialog did not restore trigger focus');
  }

  await page.goto(`${frontendUrl}/settings`);
  const deleteAccountButton = page.getByRole('button', { name: '계정 삭제' });
  await activateByKeyboard(page, deleteAccountButton);
  const deleteDialog = page.getByRole('dialog', { name: '계정과 모든 데이터를 삭제할까요?' });
  await deleteDialog.waitFor();
  await assertDialogFitsViewport(deleteDialog, '200% zoom delete-account dialog');
  await page.keyboard.press('Escape');
  await deleteDialog.waitFor({ state: 'detached' });

  if (errors.length > 0) fail(`Keyboard/zoom browser emitted errors:\n${errors.join('\n')}`);
  await context.close();

  const preferenceContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    reducedMotion: 'reduce'
  });
  const preferencePage = await preferenceContext.newPage();
  await preferencePage.goto(`${frontendUrl}/today`, { waitUntil: 'domcontentloaded' });
  await preferencePage.locator('#main-content').waitFor();
  const preferenceStyles = await preferencePage.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const control = getComputedStyle(document.querySelector('button:not([disabled])'));
    return {
      colorScheme: root.colorScheme,
      animationDuration: control.animationDuration,
      transitionDuration: control.transitionDuration,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      darkMode: window.matchMedia('(prefers-color-scheme: dark)').matches
    };
  });
  if (!preferenceStyles.colorScheme.split(/\s+/).includes('light')) {
    fail(`Dark OS mode changed the verified light-only color scheme: ${JSON.stringify(preferenceStyles)}`);
  }
  if (!preferenceStyles.reducedMotion || !preferenceStyles.darkMode) {
    fail(`Browser preference emulation was not applied: ${JSON.stringify(preferenceStyles)}`);
  }
  const isEffectivelyDisabled = (value) => value.split(',').every((duration) => (
    Number.parseFloat(duration) <= 0.00001
  ));
  if (!isEffectivelyDisabled(preferenceStyles.animationDuration) || !isEffectivelyDisabled(preferenceStyles.transitionDuration)) {
    fail(`Reduced-motion styles were not applied: ${JSON.stringify(preferenceStyles)}`);
  }
  await preferenceContext.close();
};

const backendPort = await reservePort();
const frontendPort = await reservePort();
const environment = {
  ...process.env,
  NOWLINE_BACKEND_PORT: String(backendPort),
  NOWLINE_FRONTEND_PORT: String(frontendPort),
  NOWLINE_MYSQL_VOLUME: `${projectName}-mysql-data`
};
const frontendUrl = `http://127.0.0.1:${frontendPort}`;
const backendUrl = `http://127.0.0.1:${backendPort}`;

try {
  fakeGoogle = await startFakeGoogleCalendar();
  const encryptionKey = randomBytes(32).toString('base64');
  writeFileSync(overrideFile, `services:\n  backend:\n    extra_hosts:\n      - "host.docker.internal:host-gateway"\n    environment:\n      NOWLINE_GOOGLE_CLIENT_ID: production-e2e-client\n      NOWLINE_GOOGLE_CLIENT_SECRET: production-e2e-secret\n      NOWLINE_GOOGLE_REDIRECT_URI: ${backendUrl}/api/v1/integrations/google-calendar/oauth/callback\n      NOWLINE_GOOGLE_FRONTEND_SUCCESS_URI: ${frontendUrl}/settings\n      NOWLINE_GOOGLE_WEBHOOK_URI: ${backendUrl}/api/v1/calendar/google/webhook\n      NOWLINE_GOOGLE_AUTHORIZATION_URI: ${fakeGoogle.browserBaseUrl}/auth\n      NOWLINE_GOOGLE_TOKEN_URI: ${fakeGoogle.containerBaseUrl}/token\n      NOWLINE_GOOGLE_REVOKE_URI: ${fakeGoogle.containerBaseUrl}/revoke\n      NOWLINE_GOOGLE_API_BASE_URI: ${fakeGoogle.containerBaseUrl}/calendar/v3\n      NOWLINE_INTEGRATION_ENCRYPTION_KEY_BASE64: ${encryptionKey}\n      NOWLINE_INTEGRATION_POLL_DELAY_MS: "200"\n`);

  run('npm', ['run', 'build'], { env: { ...process.env, VITE_AUTH_MODE: 'local', VITE_API_BASE_URL: '' }, stdio: 'inherit' });
  run('./mvnw', ['-q', 'package', '-DskipTests'], { cwd: `${repositoryRoot}backend`, stdio: 'inherit' });
  runCompose(['up', '-d', '--build', 'mysql', 'backend', 'frontend'], environment);
  await waitForReady(`${backendUrl}/actuator/health/readiness`);
  await waitForReady(`${frontendUrl}/healthz`);

  browser = await chromium.launch({ channel: process.env.NOWLINE_E2E_BROWSER_CHANNEL || 'chrome', headless: true });
  await exerciseDesktop(frontendUrl, backendUrl);
  // Account deletion records a sub-second tombstone while local test JWTs use
  // whole-second auth_time/iat claims. Cross the next JWT epoch before the
  // mobile journey proves that a genuinely fresh sign-in can recreate consent.
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  await exerciseMobile(frontendUrl);
  await exerciseKeyboardAndZoom(frontendUrl);
  if (fakeGoogle.stats.tokenRequests < 2 || fakeGoogle.stats.revokeRequests !== 1) {
    fail(`Calendar connect/refresh/revoke calls were incomplete: ${JSON.stringify(fakeGoogle.stats)}`);
  }
  console.log('production authenticated browser end-to-end verification passed');
  console.log('production end-to-end verification passed');
} catch (error) {
  const logs = runCompose(['logs', '--no-color', '--tail', '200', 'backend', 'frontend', 'mysql'], environment, true);
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
