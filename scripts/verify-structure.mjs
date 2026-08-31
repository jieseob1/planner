import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const requiredFiles = [
  'src/screens/TodayScreen.tsx',
  'src/screens/PlannerScreen.tsx',
  'src/screens/GoalsScreen.tsx',
  'src/screens/ReviewScreen.tsx',
  'src/screens/OnboardingScreen.tsx',
  'src/components/AppShell.tsx',
  'src/state/PlannerProvider.tsx',
  'vite.config.ts',
  'capacitor.config.ts'
];

const missing = requiredFiles.filter((file) => !existsSync(resolve(root, file)));
if (missing.length > 0) {
  throw new Error(`Missing required frontend files: ${missing.join(', ')}`);
}

const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8');
for (const route of ['/today', '/planner', '/goals', '/review', '/onboarding']) {
  if (!app.includes(route)) throw new Error(`Missing route: ${route}`);
}

const provider = readFileSync(resolve(root, 'src/state/PlannerProvider.tsx'), 'utf8');
for (const capability of ['localStorage', 'scheduleTask', 'startTimer', 'stopTimer', 'setOutcomeDecision', 'updateReview']) {
  if (!provider.includes(capability)) throw new Error(`Missing state capability: ${capability}`);
}

const css = readFileSync(resolve(root, 'src/styles.css'), 'utf8');
if (!css.includes('@media (max-width: 680px)') || !css.includes('.bottom-nav')) {
  throw new Error('Responsive mobile navigation styles are missing');
}

console.log('frontend structure verification passed');
