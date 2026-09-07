import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { namespace, context } from '../infra/observability/stack.mjs';

const realm = 'nowline';
const origin = 'https://goalstotoday.com';
const args = process.argv.slice(2);
assert(args.every((arg, i) => ['--apply', '--context'].includes(arg) || args[i - 1] === '--context'), 'Unknown argument');
if (!args.includes('--apply')) {
  console.log('Read-only mode: --apply --context kind-nowline-local provisions only nowline-grafana and nowline-prometheus clients/scopes/Secrets. Existing client secrets and users are preserved.');
  process.exit(0);
}
assert.equal(args[args.indexOf('--context') + 1], context, 'Explicit --context kind-nowline-local is required');

function kube(arguments_, input) {
  const result = spawnSync('kubectl', ['--context', context, ...arguments_], {encoding: 'utf8', input, timeout: 90000, maxBuffer: 4 * 1024 * 1024});
  assert.equal(result.status, 0, 'Observability identity operation failed; command output suppressed because it can contain secrets');
  return result.stdout;
}
function admin(verb, resource, body, query = []) {
  // Both the authentication cache and admin password remain inside the existing
  // Keycloak Pod. No client secret is put in a process argument or printed.
  const command = `umask 077
cfg=$(mktemp /tmp/nowline-observability-kcadm.XXXXXX)
trap 'rm -f "$cfg"' EXIT HUP INT TERM
/opt/keycloak/bin/kcadm.sh config credentials --config "$cfg" --server http://127.0.0.1:8080/idp --realm master --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null 2>&1
/opt/keycloak/bin/kcadm.sh "$@" --config "$cfg"`;
  const result = kube(['-n', 'nowline-local', 'exec', '-i', 'deployment/nowline-keycloak', '-c', 'keycloak', '--', 'sh', '-ec', command, 'nowline-kcadm', verb, resource, '-r', realm, ...query, ...(body === undefined ? [] : ['-f', '-'])], body === undefined ? undefined : JSON.stringify(body));
  return verb === 'get' && result.trim() ? JSON.parse(result) : null;
}
function upsert(resource, existing, desired) {
  if (existing) {admin('update', `${resource}/${existing.id}`, {...desired, id: existing.id}); return existing.id;}
  admin('create', resource, desired);
  const name = desired.clientId || desired.name;
  const matches = admin('get', resource).filter(item => (item.clientId || item.name) === name);
  assert.equal(matches.length, 1, `Expected one ${resource} result`);
  return matches[0].id;
}
function mapper(client, desired) {
  const path = `clients/${client}/protocol-mappers/models`;
  const existing = admin('get', path).find(item => item.name === desired.name);
  upsert(path, existing, desired);
}

// Create the target namespace first, but never mutate the application realm or users.
kube(['apply', '--server-side', '--field-manager=nowline-observability', '-f', '-'], JSON.stringify({apiVersion: 'v1', kind: 'Namespace', metadata: {name: namespace}}));
let roles = admin('get', 'roles');
if (!roles.some(role => role.name === 'nowline-admin')) { admin('create', 'roles', {name: 'nowline-admin', description: 'Nowline operator access'}); roles = admin('get', 'roles'); }
const operatorRole = roles.find(role => role.name === 'nowline-admin');
assert(operatorRole && !operatorRole.composite, 'nowline-admin must be a simple realm role');
const scopeName = 'metrics.read';
const scopes = admin('get', 'client-scopes');
let metricsScope = scopes.find(scope => scope.name === scopeName);
if (!metricsScope) {
  const id = upsert('client-scopes', null, {name: scopeName, protocol: 'openid-connect', attributes: {'include.in.token.scope': 'true', 'display.on.consent.screen': 'false'}});
  metricsScope = {id};
}
const currentClients = admin('get', 'clients');
const existingSecrets = new Map();
for (const client of currentClients.filter(client => ['nowline-grafana', 'nowline-prometheus'].includes(client.clientId))) {
  existingSecrets.set(client.id, admin('get', `clients/${client.id}/client-secret`).value);
}
const grafanaId = upsert('clients', currentClients.find(client => client.clientId === 'nowline-grafana'), {
  clientId: 'nowline-grafana', name: 'Nowline Grafana', enabled: true, protocol: 'openid-connect',
  publicClient: false, clientAuthenticatorType: 'client-secret', standardFlowEnabled: true,
  directAccessGrantsEnabled: false, implicitFlowEnabled: false, serviceAccountsEnabled: false,
  fullScopeAllowed: false, redirectUris: [`${origin}/ops/grafana/login/generic_oauth`], webOrigins: [origin],
  attributes: {'pkce.code.challenge.method': 'S256', 'post.logout.redirect.uris': `${origin}/ops/grafana/`},
  defaultClientScopes: ['profile', 'email', 'roles'], optionalClientScopes: []});
mapper(grafanaId, {name: 'nowline-admin-realm-role', protocol: 'openid-connect', protocolMapper: 'oidc-usermodel-realm-role-mapper', config: {'claim.name': 'realm_access.roles', multivalued: 'true', 'jsonType.label': 'String', 'access.token.claim': 'true', 'id.token.claim': 'true', 'userinfo.token.claim': 'true'}});
admin('create', `clients/${grafanaId}/scope-mappings/realm`, [operatorRole]);
const prometheusId = upsert('clients', currentClients.find(client => client.clientId === 'nowline-prometheus'), {
  clientId: 'nowline-prometheus', name: 'Nowline authenticated metrics scrape', enabled: true, protocol: 'openid-connect',
  publicClient: false, clientAuthenticatorType: 'client-secret', standardFlowEnabled: false,
  directAccessGrantsEnabled: false, implicitFlowEnabled: false, serviceAccountsEnabled: true,
  fullScopeAllowed: false, redirectUris: [], webOrigins: [], defaultClientScopes: [], optionalClientScopes: []});
// This association endpoint supports PUT but not GET-by-id; skip kcadm's merge GET.
admin('update', `clients/${prometheusId}/optional-client-scopes/${metricsScope.id}`, undefined, ['-n']);
mapper(prometheusId, {name: 'nowline-api-audience', protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper', config: {'included.client.audience': 'nowline-api', 'access.token.claim': 'true', 'id.token.claim': 'false'}});
// Read full representations: kcadm --fields can omit nested client attributes.
const grafanaClient = admin('get', `clients/${grafanaId}`);
assert(grafanaClient.publicClient === false && grafanaClient.standardFlowEnabled === true && grafanaClient.attributes?.['pkce.code.challenge.method'] === 'S256', 'Grafana OIDC client configuration did not persist');
const metricsClient = admin('get', `clients/${prometheusId}`);
assert(metricsClient.publicClient === false && metricsClient.serviceAccountsEnabled === true && metricsClient.standardFlowEnabled === false && metricsClient.fullScopeAllowed === false, 'Prometheus confidential service client configuration did not persist');
assert(admin('get', `clients/${prometheusId}/optional-client-scopes`).some(scope => scope.id === metricsScope.id), 'metrics.read association did not persist');
for (const [name, id] of [['nowline-grafana-oauth', grafanaId], ['nowline-prometheus-oauth', prometheusId]]) {
  const secret = admin('get', `clients/${id}/client-secret`).value;
  assert(typeof secret === 'string' && secret.length >= 24, 'Keycloak did not return a strong client secret');
  if (existingSecrets.has(id)) assert(secret === existingSecrets.get(id), 'Existing client secret changed unexpectedly; secret value suppressed');
  const previous = kube(['-n', namespace, 'get', 'secret', name, '--ignore-not-found', '-o', 'json']);
  const stored = previous.trim() ? JSON.parse(previous) : null;
  const data = {'client-secret': Buffer.from(secret).toString('base64')};
  if (name === 'nowline-grafana-oauth') {
    // Secret.data is base64 transport; the decoded env value must be printable,
    // not random binary bytes (which can contain NUL and prevent Pod startup).
    data['session-secret'] = stored?.data?.['session-secret'] || Buffer.from(randomBytes(48).toString('hex')).toString('base64');
    assert(/^[\x21-\x7e]{32,}$/.test(Buffer.from(data['session-secret'], 'base64').toString('utf8')), 'Existing Grafana session key is invalid; review an explicit rotation');
  }
  // Server-side apply avoids storing credentials a second time in a last-applied annotation.
  kube(['apply', '--server-side', '--field-manager=nowline-observability-identity', '-f', '-'], JSON.stringify({apiVersion: 'v1', kind: 'Secret', metadata: {name, namespace}, type: 'Opaque', data}));
}
console.log('Observability identities provisioned; existing client secrets and user role assignments preserved.');
