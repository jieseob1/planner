import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const requireText = (file, expected) => {
  assert(read(file).includes(expected), `${file} must contain ${JSON.stringify(expected)}`);
};
const requireTextCaseInsensitive = (file, expected) => {
  assert(read(file).toLocaleLowerCase('en-US').includes(expected.toLocaleLowerCase('en-US')), `${file} must contain ${JSON.stringify(expected)} regardless of case`);
};
const rejectText = (file, rejected) => {
  assert(!read(file).includes(rejected), `${file} must not contain ${JSON.stringify(rejected)}`);
};

for (const file of [
  'index.html',
  'src/components/AppShell.tsx',
  'src/auth/AuthProvider.tsx',
  'src/screens/LandingScreen.tsx',
  'src/screens/OnboardingScreen.tsx',
  'src/screens/SettingsScreen.tsx',
  'src/screens/LegalScreen.tsx',
  'vite.config.ts',
  'capacitor.config.ts',
  'android/app/src/main/res/values/strings.xml',
  'ios/App/App/Info.plist'
]) {
  requireTextCaseInsensitive(file, 'Goals to Today');
}

requireText('index.html', 'https://goalstotoday.com/');
requireText('.github/workflows/release.yml', 'https://goalstotoday.com/auth/callback');
requireText('.github/workflows/mobile-release.yml', 'VITE_API_BASE_URL: https://goalstotoday.com');
requireText('infra/k8s/overlays/production/ingress.yaml', 'host: goalstotoday.com');
requireText('infra/k8s/overlays/production/ingress.yaml', 'host: www.goalstotoday.com');
requireText('infra/k8s/overlays/production/backend-patch.yaml', 'https://goalstotoday.com/api/v1/integrations/google-calendar/oauth/callback');
requireText('scripts/k8s-local.sh', 'NOWLINE_PUBLIC_ORIGIN');
requireText('scripts/k8s-local.sh', 'configure-keycloak-public-origin.sh');
requireText('scripts/k8s-local.sh', '/opt/homebrew/opt/openjdk@25/bin/java');
requireText('scripts/migrate-k8s-oidc-issuer.sh', 'mysqldump --single-transaction');
requireText('scripts/mac-mini-goalstotoday-tunnel.sh', 'ops/cloudflared/goalstotoday.yml');
requireText('scripts/mac-mini-nowline-headless.sh', 'colima');
requireText('scripts/install-mac-mini-headless-services.sh', 'launchctl bootstrap system');
requireText('ops/cloudflared/goalstotoday.yml', 'service: http://127.0.0.1:4189');
requireText('scripts/verify-goalstotoday-mac-mini.mjs', 'Goals to Today Mac mini Kubernetes runtime verified');
requireText('ops/macos/com.goalstotoday.tunnel.plist', 'com.goalstotoday.tunnel');
requireText('ops/macos/com.goalstotoday.tunnel.plist', '<key>UserName</key>');
requireText('ops/macos/com.nowline.local-beta.plist', 'mac-mini-nowline-headless.sh');
requireText('nginx.beta.conf', '$nowline_forwarded_proto');
requireText('nginx.beta.conf', 'return 308 https://goalstotoday.com$request_uri;');

for (const file of [
  '.env.example',
  '.github/workflows/release.yml',
  '.github/workflows/mobile-release.yml',
  'infra/k8s/overlays/production/ingress.yaml',
  'infra/k8s/overlays/production/backend-patch.yaml',
  'backend/src/main/java/io/nowline/planner/api/ApiExceptionHandler.java',
  'backend/src/main/java/io/nowline/planner/security/ApiProtectionFilter.java'
]) {
  rejectText(file, 'app.nowline.example');
  rejectText(file, 'nowline.app');
}

console.log('Goals to Today domain and brand contracts verified');
