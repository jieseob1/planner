import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const required = ['dist/index.html', 'dist/manifest.webmanifest', 'dist/sw.js'];
for (const file of required) {
  if (!existsSync(resolve(root, file))) throw new Error(`Production artifact missing: ${file}`);
}

const manifest = JSON.parse(readFileSync(resolve(root, 'dist/manifest.webmanifest'), 'utf8'));
if (manifest.display !== 'standalone') throw new Error('PWA manifest must use standalone display mode');
if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) throw new Error('PWA manifest icon is missing');

const index = readFileSync(resolve(root, 'dist/index.html'), 'utf8');
if (!index.includes('manifest.webmanifest')) throw new Error('Built page does not reference the PWA manifest');

console.log('frontend production build passed');
