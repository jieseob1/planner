import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const origin = (process.env.GOALS_TO_TODAY_ORIGIN || 'https://goalstotoday.com').replace(/\/$/, '');
const expectedHost = new URL(origin).hostname;
const timeoutMs = Number(process.env.GOALS_TO_TODAY_VERIFY_TIMEOUT_MS || 120_000);
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function fetchReady(url, options = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5_000), ...options });
      if (response.status < 500) return response;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

const health = await fetchReady(`${origin}/healthz`);
assert(health.status === 200 && (await health.text()).trim() === 'ok', 'Public health endpoint must return 200 ok');

const landing = await fetchReady(`${origin}/`);
const landingHtml = await landing.text();
assert(landing.status === 200, `Landing page returned ${landing.status}`);
assert(landingHtml.includes('Goals to Today'), 'Landing HTML is missing the public brand');
assert(landing.headers.get('strict-transport-security')?.includes('max-age='), 'HSTS header is missing');
assert(landing.headers.get('content-security-policy')?.includes("default-src 'self'"), 'CSP header is missing');
assert(landing.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options is missing');

const discoveryResponse = await fetchReady(`${origin}/idp/realms/nowline/.well-known/openid-configuration`);
assert(discoveryResponse.status === 200, `OIDC discovery returned ${discoveryResponse.status}`);
const discovery = await discoveryResponse.json();
assert(discovery.issuer === `${origin}/idp/realms/nowline`, `Unexpected OIDC issuer: ${discovery.issuer}`);

const planner = await fetchReady(`${origin}/api/v1/planner`);
assert(planner.status === 401, `Unauthenticated planner request must return 401, got ${planner.status}`);
const devToken = await fetchReady(`${origin}/api/v1/auth/dev-token`);
assert([401, 404].includes(devToken.status), `Development token endpoint returned ${devToken.status}`);

const www = await fetchReady(`https://www.${expectedHost}/`);
assert([301, 302, 307, 308].includes(www.status), `www must redirect, got ${www.status}`);
assert(www.headers.get('location') === `${origin}/`, `www redirected to ${www.headers.get('location')}`);

const ssh = spawnSync('ssh', [
  '-o', 'BatchMode=yes',
  '-o', 'IdentitiesOnly=yes',
  '-o', 'ConnectTimeout=10',
  '-i', `${process.env.HOME}/.ssh/id_ed25519`,
  'mac-mini',
  'hostname'
], { encoding: 'utf8', timeout: 15_000 });
assert(ssh.status === 0 && ssh.stdout.trim().length > 0, `Mac mini SSH check failed: ${ssh.stderr.trim()}`);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(origin, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.getByText('GOALS TO TODAY', { exact: true }).first().waitFor({ timeout: 20_000 });
    assert((await page.title()).startsWith('Goals to Today'), `Unexpected page title: ${await page.title()}`);
    assert(errors.length === 0, `Browser errors at ${viewport.width}px: ${errors.join('; ')}`);
    await context.close();
  }
} finally {
  await browser.close();
}

console.log('Goals to Today public HTTPS, OIDC, SSH, desktop, and mobile verification passed');
