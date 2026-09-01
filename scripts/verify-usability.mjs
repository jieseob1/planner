import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = process.cwd();

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const deadButtons = [];
for (const file of walk(resolve(root, 'src')).filter((path) => path.endsWith('.tsx'))) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/<button\b([\s\S]*?)>/g)) {
    const openingTag = match[0];
    const isStaticButton = /\btype\s*=\s*["']button["']/.test(openingTag);
    const hasAction = /\bonClick\s*=|\bonDrop\s*=/.test(openingTag);
    const isDisabled = /\bdisabled(?:\s|=|>)/.test(openingTag);
    if (isStaticButton && !hasAction && !isDisabled) {
      const line = source.slice(0, match.index).split('\n').length;
      deadButtons.push(`${relative(root, file)}:${line}`);
    }
  }
}

if (deadButtons.length > 0) {
  throw new Error(`Active type=button controls without an action: ${deadButtons.join(', ')}`);
}

const saveStatus = read('src/components/SaveStatus.tsx');
for (const contract of [
  "saved: { label: '서버에 저장됨'",
  "saving: { label: '서버에 저장 중', detail: '변경 내용은 기기에 저장됨'",
  "offline: { label: '오프라인', detail: '변경 내용은 이 기기에 저장됨'",
  "conflict: { label: '서버 저장 충돌'"
]) {
  if (!saveStatus.includes(contract)) {
    throw new Error(`SaveStatus server/local persistence contract is missing: ${contract}`);
  }
}

const shell = read('src/components/AppShell.tsx');
for (const contract of ['초기화', '되돌릴 수 없', 'data-autofocus']) {
  if (!shell.includes(contract)) throw new Error(`Reset confirmation contract is missing: ${contract}`);
}

const planner = read('src/screens/PlannerScreen.tsx');
for (const contract of ['setPlannerWeekOffset', 'addTask', 'placementError', 'horizontal-scroll-hint']) {
  if (!planner.includes(contract)) throw new Error(`Planner usability contract is missing: ${contract}`);
}

const goals = read('src/screens/GoalsScreen.tsx');
for (const contract of ['savePlan', '측정값 없음', 'horizontal-scroll-hint']) {
  if (!goals.includes(contract)) throw new Error(`Goals usability contract is missing: ${contract}`);
}

const review = read('src/screens/ReviewScreen.tsx');
for (const contract of ['updateOutcomeMetric', 'aria-invalid', 'completeReview']) {
  if (!review.includes(contract)) throw new Error(`Review usability contract is missing: ${contract}`);
}

const css = read('src/styles.css');
for (const contract of [
  '--text-3: #667085',
  '.horizontal-scroll-hint',
  '.review-skip',
  '.prompt-chips button',
  'min-height: 44px'
]) {
  if (!css.includes(contract)) throw new Error(`Usability style contract is missing: ${contract}`);
}

for (const path of [
  'index.html',
  'vite.config.ts',
  'capacitor.config.ts',
  'android/app/src/main/res/values/strings.xml',
  'ios/App/App/Info.plist'
]) {
  if (!read(path).includes('Goals to Today')) throw new Error(`Visible product name is inconsistent in ${path}`);
}

console.log('frontend usability verification passed');
