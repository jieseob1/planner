import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const requireFile = (file) => {
  if (!existsSync(resolve(root, file))) throw new Error(`Missing production file: ${file}`);
};
const requireText = (file, values) => {
  const source = read(file);
  for (const value of values) {
    if (!source.includes(value)) throw new Error(`${file} is missing production contract: ${value}`);
  }
};

[
  'src/auth/NativeOidcNavigator.ts',
  'src/auth/SecureStateStore.ts',
  'src/components/ConflictResolutionModal.tsx',
  'src/data/empty.ts',
  'src/screens/PlansScreen.tsx',
  'src/screens/LegalScreen.tsx',
  'backend/src/main/java/io/nowline/planner/config/SecurityConfiguration.java',
  'backend/src/main/java/io/nowline/planner/security/ApiProtectionFilter.java',
  'backend/src/main/java/io/nowline/planner/config/DataRetentionScheduler.java',
  'backend/src/main/resources/db/migration/V7__add_policy_consent.sql',
  'backend/src/main/resources/db/migration/V8__add_account_entitlement.sql',
  'infra/k8s/overlays/production/migration-job.yaml',
  'infra/k8s/overlays/production/monitoring.yaml',
  'ios/App/App/PrivacyInfo.xcprivacy',
  '.github/workflows/ci.yml',
  '.github/workflows/codeql.yml',
  '.github/workflows/release.yml',
  '.github/workflows/mobile-release.yml',
  'docs/PRODUCTION_SETUP.md',
  'docs/OPERATIONS_RUNBOOK.md',
  'docs/MOBILE_RELEASE.md',
  'docs/PRODUCTION_UX_AUDIT.md',
  'docs/FEATURE_QA_MATRIX.md',
  'docs/RELIABILITY_BASELINE.md',
  'scripts/lib/fake-google-calendar.mjs',
  'scripts/verify-production-e2e.mjs',
  'scripts/verify-production-reliability.mjs',
  'scripts/verify-mysql-contract.mjs',
  'scripts/verify-secrets.mjs',
  'nginx.conf'
].forEach(requireFile);

requireText('nginx.conf', [
  'location /api/', 'gzip off;', 'proxy_pass http://nowline_api'
]);

requireText('src/auth/AuthProvider.tsx', [
  "response_type: 'code'", 'SecureStateStore', 'NativeOidcNavigator', 'max_age: 900', '/api/v1/account/consent'
]);
requireText('backend/src/main/java/io/nowline/planner/config/SecurityConfiguration.java', [
  'oauth2ResourceServer', 'JwtIssuerValidator', 'JwtTimestampValidator', 'Required audience is missing', 'contentSecurityPolicy'
]);
requireText('backend/src/main/java/io/nowline/planner/integration/calendar/GoogleCalendarConnectionService.java', [
  'calendar.events', 'calendar.calendarlist.readonly', 'code_challenge_method', 'offline'
]);
requireText('backend/src/main/java/io/nowline/planner/integration/calendar/GoogleCalendarSyncService.java', [
  'SyncTokenExpiredException', 'nextPageToken', 'googleEtag', 'fullReset'
]);
requireText('backend/src/main/java/io/nowline/planner/integration/calendar/GoogleCalendarHttpGateway.java', [
  'singleEvents', 'showDeleted', 'HttpHeaders.IF_MATCH', 'getStatusCode().value() == 410'
]);
requireText('backend/src/main/java/io/nowline/planner/notification/NotificationService.java', [
  'cipher.encrypt', 'cipher.decrypt', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE'
]);
requireText('infra/k8s/overlays/production/kustomization.yaml', [
  'namespace: nowline-production', 'network-policies.yaml', 'monitoring.yaml', 'ghcr.io/jieseob1/planner-backend'
]);
requireText('.github/workflows/release.yml', [
  'sbom: true', 'provenance: mode=max', 'cosign sign --yes', 'Scan backend image', 'Scan frontend image', 'BACKEND_DIGEST', 'nowline-migrate'
]);
requireText('.github/workflows/mobile-release.yml', [
  'bundleRelease', 'xcodebuild -exportArchive', 'ANDROID_KEYSTORE_BASE64', 'APP_STORE_CONNECT_API_KEY_BASE64'
]);
requireText('README.md', [
  '현재 구현 상태', '공개 배포 전에 반드시 필요한 것', 'Google Calendar',
  'verify:production:e2e', 'verify:production:reliability', 'verify:mysql-contract',
  'FEATURE_QA_MATRIX.md', 'verify:secrets', 'RELIABILITY_BASELINE.md'
]);
requireText('src/state/PlannerProvider.tsx', [
  'createEmptySnapshot', 'plannerReady', 'resetPlanner', 'ACTIVE_PLAN_ABSENT_KEY'
]);
requireText('backend/src/main/java/io/nowline/planner/api/AccountController.java', [
  'authTime.isAfter(now.plusSeconds(30))', 'authTime.isBefore(now.minus(Duration.ofMinutes(15)))'
]);
requireText('docs/FEATURE_QA_MATRIX.md', [
  'QA 완료', '외부 자격 증명 필요', '신규 계정', 'Google Calendar', 'Kubernetes', 'secret scan'
]);
requireText('docs/PRODUCTION_SETUP.md', [
  'sslMode=VERIFY_IDENTITY', 'nowline-production-secrets', 'KUBE_CONFIG_DATA',
  'ANDROID_KEYSTORE_BASE64', 'GOOGLE_SERVICES_JSON_BASE64',
  'APP_STORE_CONNECT_API_KEY_BASE64', 'APPLE_TEAM_ID', '사용자가 제공할 최소 작업'
]);

for (const file of ['README.md', 'docs/BACKEND_ARCHITECTURE.md']) {
  if (read(file).includes('X-Nowline-User-Id')) {
    throw new Error(`${file} still documents the removed trusted user-id header`);
  }
}
if (read('docs/USABILITY_AUDIT.md').startsWith('# Nowline 사용성 감사\n\n감사일:')) {
  throw new Error('docs/USABILITY_AUDIT.md still presents the pre-backend audit as current');
}

const mainJava = [
  'backend/src/main/java/io/nowline/planner/api/PlannerController.java',
  'backend/src/main/java/io/nowline/planner/security/CurrentUserService.java'
].map(read).join('\n');
if (mainJava.includes('X-Nowline-User-Id')) throw new Error('Production identity must not trust a user-id request header');

for (const screenshot of [
  '01-consent-desktop.png', '02-today-desktop.png', '03-settings-desktop.png',
  '04-today-mobile.png', '05-plans-mobile.png', '06-new-plan-mobile.png', '07-settings-mobile.png'
]) {
  const file = resolve(root, 'docs/screenshots/audit', screenshot);
  requireFile(`docs/screenshots/audit/${screenshot}`);
  if (statSync(file).size < 10_000) throw new Error(`Audit screenshot is unexpectedly small: ${screenshot}`);
}

console.log('production implementation contracts verified');
