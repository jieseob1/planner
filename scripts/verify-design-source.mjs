import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const specPath = resolve(process.cwd(), 'DESIGN_SPEC.md');
if (!existsSync(specPath)) throw new Error('DESIGN_SPEC.md is missing');

const spec = readFileSync(specPath, 'utf8');
const required = [
  'Planner_HighFidelity.dc.html',
  'Today',
  'Weekly Planner',
  'Goals',
  'Weekly Review',
  'Onboarding',
  '390 x 844',
  '#2E56E8',
  '#171B22',
  '76px icon rail',
  'Implementation tokens'
];

for (const token of required) {
  if (!spec.includes(token)) throw new Error(`Claude design source is missing: ${token}`);
}

console.log('Claude production design source verified');
