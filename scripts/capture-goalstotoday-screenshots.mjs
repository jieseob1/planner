import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(root, 'docs', 'screenshots', 'landing');
const origin = (process.env.GOALS_TO_TODAY_ORIGIN || 'https://goalstotoday.com').replace(/\/$/, '');
const targets = [
  { name: 'implementation-desktop-hero.png', width: 1440, height: 1000 },
  { name: 'implementation-mobile-hero.png', width: 390, height: 844 }
];

mkdirSync(outputDirectory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const target of targets) {
    const context = await browser.newContext({ viewport: { width: target.width, height: target.height } });
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.getByText('GOALS TO TODAY', { exact: true }).first().waitFor({ timeout: 20_000 });
    await page.screenshot({ path: path.join(outputDirectory, target.name), fullPage: false });
    await context.close();
  }
} finally {
  await browser.close();
}

console.log('Goals to Today public landing screenshots captured');
