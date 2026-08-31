import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const css = readFileSync(resolve(root, 'src/styles.css'), 'utf8');
const shell = readFileSync(resolve(root, 'src/components/AppShell.tsx'), 'utf8');

const requiredCss = [
  '--accent: #2e56e8',
  '--text-1: #171b22',
  '--surface-sub: #f5f6f8',
  '--border: #e4e7ec',
  'nowline production overrides',
  'width: 76px',
  'font-variant-numeric: tabular-nums',
  '@media (max-width: 680px)',
  'min-height: 44px',
  'prefers-reduced-motion'
];

for (const token of requiredCss) {
  if (!css.toLowerCase().includes(token)) throw new Error(`Nowline visual token is missing: ${token}`);
}

for (const contract of ['bottom-nav', 'capture-fab', 'app-topbar']) {
  if (!shell.includes(contract)) throw new Error(`Nowline shell contract is missing: ${contract}`);
}

console.log('Claude visual system implementation verified');
