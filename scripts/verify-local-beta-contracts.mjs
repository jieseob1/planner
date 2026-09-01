import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');
const fail = (message) => { throw new Error(message); };
const requireText = (source, value, label) => {
  if (!source.includes(value)) fail(`${label} is missing: ${value}`);
};
const assertAbsent = (source, value, label) => {
  const detectsPositiveControl = `known-positive:${value}`.includes(value);
  if (!detectsPositiveControl) fail(`Absence checker positive control failed for ${value}`);
  if (source.includes(value)) fail(`${label} must not contain: ${value}`);
};

const prepare = spawnSync('sh', ['scripts/prepare-local-beta-env.sh'], { cwd: root, encoding: 'utf8' });
if (prepare.status !== 0) fail(`Local beta environment preparation failed:\n${prepare.stderr || prepare.stdout}`);
const compose = spawnSync('docker', [
  'compose', '--project-name', 'nowline-beta-contract', '--env-file', '.env.local-beta',
  '--file', 'compose.yaml', '--file', 'compose.beta.yaml', 'config'
], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (compose.status !== 0) fail(`Merged local beta Compose model is invalid:\n${compose.stderr || compose.stdout}`);

const model = compose.stdout;
for (const service of ['mysql:', 'mysql-keycloak-bootstrap:', 'keycloak:', 'backend:', 'frontend:']) {
  requireText(model, service, 'Merged Compose model');
}
requireText(read('infra/keycloak/Containerfile'), 'quay.io/keycloak/keycloak:26.7.2', 'Pinned Keycloak image');
requireText(model, 'NOWLINE_OIDC_JWK_SET_URI:', 'Internal JWK configuration');
requireText(model, 'SPRING_PROFILES_ACTIVE: ""', 'Local beta Spring profile override');
requireText(model, 'NOWLINE_DEV_JWT_SECRET: ""', 'Local beta development-secret override');

const realm = read('infra/k8s/overlays/local/files/nowline-realm.json');
for (const contract of [
  '"registrationAllowed": true',
  '"bruteForceProtected": true',
  '"pkce.code.challenge.method": "S256"',
  '"protocolMapper": "oidc-audience-mapper"',
  '"clientId": "nowline-api"',
  '"clientId": "nowline-web"'
]) requireText(realm, contract, 'Keycloak realm');
assertAbsent(realm, 'directAccessGrantsEnabled": true', 'Keycloak public client');

const localOverlay = read('infra/k8s/overlays/local/kustomization.yaml');
requireText(localOverlay, 'NOWLINE_OIDC_JWK_SET_URI', 'Local Kubernetes overlay');
assertAbsent(localOverlay, 'NOWLINE_DEV_JWT_SECRET', 'Local Kubernetes overlay');
assertAbsent(localOverlay, 'local-auth', 'Local Kubernetes overlay');

const security = read('backend/src/main/java/io/nowline/planner/config/SecurityConfiguration.java');
requireText(security, 'NimbusJwtDecoder.withJwkSetUri(jwkSetUri)', 'Spring JWK decoder');
requireText(security, 'new JwtIssuerValidator(issuer)', 'Spring issuer validator');

const migration = read('backend/src/main/resources/db/migration/V8__add_account_entitlement.sql');
requireText(migration, 'CREATE TABLE account_entitlement', 'Beta entitlement migration');
requireText(migration, "plan_code IN ('BETA', 'PRO')", 'Beta entitlement plan constraint');

const betaNginx = read('nginx.beta.conf');
requireText(betaNginx, 'server nowline-keycloak:8080', 'Beta identity proxy');
requireText(betaNginx, 'location ^~ /idp/admin/', 'Public admin-path block');
requireText(betaNginx, 'location ^~ /idp/realms/master/', 'Master-realm block');
requireText(betaNginx, 'location = /auth/silent-callback', 'Silent OIDC callback policy');
requireText(betaNginx, 'add_header X-Frame-Options SAMEORIGIN always;', 'Silent OIDC callback frame policy');

const vite = read('vite.config.ts');
requireText(vite, 'navigateFallbackDenylist: [/^\\/api\\//, /^\\/idp\\//]', 'PWA authentication bypass');

console.log('local beta contracts verified');
