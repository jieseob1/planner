import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const name = `gtt-login-qa-${randomUUID().slice(0, 8)}`;
const run = (args, input) => execFileSync('docker', args, { input, encoding: 'utf8', timeout: 120_000, stdio: ['pipe', 'pipe', 'pipe'] });
const output = new URL('../artifacts/login-qa/', import.meta.url).pathname;
mkdirSync(output, { recursive: true });
let browser;
try {
  run(['build', '-f', 'infra/keycloak/Containerfile', '-t', 'goalstotoday-keycloak:theme-qa', 'infra/keycloak']);
  run(['run', '-d', '--rm', '--name', name, '-p', '127.0.0.1::8080', '-e', 'KC_BOOTSTRAP_ADMIN_USERNAME=theme-qa-admin',
    '-e', `KC_BOOTSTRAP_ADMIN_PASSWORD=${randomBytes(32).toString('hex')}`, 'goalstotoday-keycloak:theme-qa',
    'start-dev', '--db=dev-file', '--http-relative-path=/idp']);
  const port = run(['port', name, '8080']).trim().split(':').pop();
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try { ready = (await fetch(`${base}/idp/realms/master`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* starting */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert(ready, 'Disposable Keycloak did not become ready');
  run(['exec', name, 'sh', '-ec', 'umask 077; /opt/keycloak/bin/kcadm.sh config credentials --config /tmp/theme-qa.config --server http://127.0.0.1:8080/idp --realm master --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null 2>&1']);
  run(['exec', '-i', name, '/opt/keycloak/bin/kcadm.sh', 'create', 'realms', '--config', '/tmp/theme-qa.config', '-f', '-'], JSON.stringify({
    realm: 'theme-qa', enabled: true, displayName: 'Goals to Today', loginTheme: 'goalstotoday', registrationAllowed: true,
    resetPasswordAllowed: true, rememberMe: true, registrationEmailAsUsername: true,
    internationalizationEnabled: true, supportedLocales: ['ko', 'en'], defaultLocale: 'ko',
    clients: [{ clientId: 'theme-qa', enabled: true, publicClient: true, standardFlowEnabled: true, redirectUris: [`${base}/callback`] }],
  }));
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  // OIDC uses ui_locales. Keep the browser English so CI proves the explicit
  // client preference works rather than accidentally inheriting the host locale.
  const auth = `${base}/idp/realms/theme-qa/protocol/openid-connect/auth?${new URLSearchParams({ client_id: 'theme-qa', redirect_uri: `${base}/callback`, response_type: 'code', scope: 'openid', ui_locales: 'ko' })}`;
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, locale: 'en-US' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(auth);
    await page.locator('#username').waitFor();
    assert.equal(await page.locator('#kc-page-title').innerText(), '오늘의 계획을 이어가세요');
    assert.equal(await page.locator('link[href*="goalstotoday.css"]').count(), 1);
    assert.equal(await page.locator('.gtt-login-footer').count(), 1);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal overflow');
    await page.screenshot({ path: `${output}keycloak-${viewport.width}.png`, fullPage: true });
    await page.locator('#username').fill('nonexistent-qa@example.invalid');
    await page.locator('#password').fill('Invalid-qa-only-123!');
    await page.locator('#kc-login').click();
    await page.locator('#input-error').waitFor();
    assert.equal(await page.locator('#username').getAttribute('aria-invalid'), 'true');
    await page.screenshot({ path: `${output}keycloak-error-${viewport.width}.png`, fullPage: true });
    await page.goto(auth);
    await page.locator('#kc-registration a').click();
    await page.locator('#email').waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Registration overflow');
    await page.screenshot({ path: `${output}keycloak-register-${viewport.width}.png`, fullPage: true });
    await page.goto(auth);
    await page.locator('a[href*="reset-credentials"]').click();
    await page.locator('#username').waitFor();
    await page.screenshot({ path: `${output}keycloak-recovery-${viewport.width}.png`, fullPage: true });
    const englishAuth = new URL(auth);
    englishAuth.searchParams.set('ui_locales', 'en');
    await page.goto(englishAuth.href);
    assert.equal(await page.locator('#kc-page-title').innerText(), 'Pick up where you left off');
    assert.deepEqual(errors, [], 'Login page JS errors');
    await page.close();
  }
  console.log(`Custom Keycloak login, validation, registration and recovery verified on desktop/mobile. Screenshots: ${output}`);
} finally {
  await browser?.close();
  try { run(['rm', '-f', name]); } catch { /* Only this disposable QA container is targeted. */ }
}
