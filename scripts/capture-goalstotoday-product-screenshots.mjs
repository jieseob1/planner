import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(root, 'docs', 'screenshots');
const origin = (process.env.GOALS_TO_TODAY_ORIGIN || 'https://goalstotoday.com').replace(/\/$/, '');
const runId = `${Date.now()}-${randomBytes(4).toString('hex')}`;
const email = `screenshot-${runId}@example.test`;
const password = `Capture!${randomBytes(10).toString('hex')}A9`;

mkdirSync(outputDirectory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`${origin}/today`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '계획을 실행으로 연결하세요' }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '로그인' }).click();
  await page.locator('#kc-registration a').click();
  await page.locator('#firstName').fill('Goals');
  await page.locator('#lastName').fill('Capture');
  await page.locator('#email').fill(email);
  if (await page.locator('#username').count()) await page.locator('#username').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#password-confirm').fill(password);
  await page.locator('#kc-form-buttons input[type="submit"], #kc-form-buttons button[type="submit"]').click();

  await page.getByRole('heading', { name: '내 계획을 안전하게 관리하기 위한 동의' }).waitFor({ timeout: 30_000 });
  await page.getByRole('checkbox').nth(0).check();
  await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('button', { name: '동의하고 시작하기' }).click();
  await page.getByPlaceholder('예: 기술 글 6개를 발행한다').fill('Goals to Today 공개 베타 품질 검증');
  await page.getByRole('button', { name: '계속' }).click();
  await page.getByPlaceholder('예: 첫 글의 제목과 목차를 정한다').fill('공개 서비스 QA 결과 정리');
  await page.getByRole('button', { name: '계속' }).click();
  await page.locator('button[role="radio"]:not([disabled])').first().click();
  await page.getByRole('button', { name: /첫 실행 만들기/ }).click();
  await page.getByRole('heading', { name: '오늘은 하나를 끝냅니다.' }).waitFor({ timeout: 30_000 });
  await page.getByText('서버에 저장됨').waitFor({ timeout: 30_000 });

  const desktopTargets = [
    ['/today', 'today-desktop.jpg'],
    ['/planner', 'planner-desktop.jpg'],
    ['/goals', 'goals-desktop.jpg'],
    ['/review', 'review-desktop.jpg']
  ];
  for (const [route, name] of desktopTargets) {
    await page.goto(`${origin}${route}`, { waitUntil: 'networkidle' });
    await page.locator('.app-shell').waitFor({ state: 'attached', timeout: 20_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outputDirectory, name), type: 'jpeg', quality: 86, fullPage: false });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  for (const [route, name] of [['/today', 'today-mobile.jpg'], ['/planner', 'planner-mobile.jpg']]) {
    await page.goto(`${origin}${route}`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(outputDirectory, name), type: 'jpeg', quality: 86, fullPage: false });
  }
  await context.close();
} finally {
  await browser.close();
}

console.log('Goals to Today authenticated product screenshots captured');
