import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

for (const file of [
  'src/screens/LandingScreen.tsx',
  'src/screens/LandingScreen.test.tsx',
  'src/landing.css',
  'public/nowline-mark.jpg',
  'docs/screenshots/today-desktop.jpg',
  'docs/screenshots/today-mobile.jpg',
  'docs/screenshots/goals-desktop.jpg',
  'docs/screenshots/planner-desktop.jpg',
  'docs/screenshots/review-desktop.jpg'
]) {
  if (!existsSync(resolve(root, file))) throw new Error(`Landing asset is missing: ${file}`);
}

const app = read('src/App.tsx');
if (!app.includes('<Route path="/" element={<LandingScreen />} />')) {
  throw new Error('The public root route does not render LandingScreen');
}

const localBetaRuntime = read('scripts/verify-local-beta-runtime.mjs');
if (!localBetaRuntime.includes('const appUrl = `${baseUrl}/today`;')
  || !localBetaRuntime.includes("page.goto(appUrl, { waitUntil: 'domcontentloaded' })")) {
  throw new Error('Local beta browser verification must enter the authenticated app through /today');
}

const landing = read('src/screens/LandingScreen.tsx');
for (const contract of [
  '오늘 하는 일이',
  '장기 계획이 오늘의 행동과 연결됩니다',
  '단순한 기록이 아니라 계획을 운영합니다',
  '실행과 회고가 하나의 순환을 만듭니다',
  '쓰는 목적이 다릅니다',
  'Goals to Today가 남기는 세 가지',
  '베타 기간 자동 결제 없음',
  '카드 등록 없음',
  '데이터 내보내기와 삭제 지원',
  'Google Calendar 공개 연동',
  '계정 로그인 · 회원 탈퇴',
  '제공 중',
  'to="/today"',
  'to="/privacy"',
  'to="/terms"'
]) {
  if (!landing.includes(contract)) throw new Error(`Landing contract is missing: ${contract}`);
}

const css = read('src/landing.css');
for (const contract of [
  '--landing-blue: #2e56e8',
  'overflow: clip',
  '.landing-table-scroll',
  '@media (max-width: 680px)',
  'grid-template-columns: 1fr',
  'prefers-reduced-motion',
  'min-height: 44px'
]) {
  if (!css.includes(contract)) throw new Error(`Landing responsive or accessibility contract is missing: ${contract}`);
}

if (landing.includes('계정 로그인과 회원 탈퇴 절차') || landing.includes('베타 이후 제공')) {
  throw new Error('Implemented account access must not be advertised as coming soon');
}

console.log('landing page verification passed');
