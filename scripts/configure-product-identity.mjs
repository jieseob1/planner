import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// Run on the Mac mini. No passwords, client secrets or access tokens leave the Keycloak pod.
const apply = process.argv.includes('--apply');
const theme = process.argv.includes('--activate-theme');
const emailIndex = process.argv.indexOf('--admin-email');
const adminEmail = emailIndex >= 0 ? process.argv[emailIndex + 1]?.trim().toLowerCase() : null;
if (emailIndex >= 0) assert.match(adminEmail || '', /^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Expected a valid admin email');
const config = `/tmp/gtt-product-${randomUUID()}.config`;
const context = ['--context', 'kind-nowline-local', '-n', 'nowline-local'];
const exec = (args, input) => execFileSync('kubectl', [...context, 'exec', '-i', 'deployment/nowline-keycloak', '--', ...args], {
  input, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
});
const admin = (...args) => exec(['/opt/keycloak/bin/kcadm.sh', ...args, '--config', config]);
const get = (resource, ...args) => JSON.parse(admin('get', resource || 'realms/nowline', ...(resource ? ['-r', 'nowline'] : []), ...args));
const write = (method, resource, value) => exec(['/opt/keycloak/bin/kcadm.sh', method, resource || 'realms/nowline', ...(resource ? ['-r', 'nowline'] : []), '--config', config, '-f', '-'], JSON.stringify(value));

try {
  exec(['sh', '-ec', `umask 077; /opt/keycloak/bin/kcadm.sh config credentials --config '${config}' --server http://127.0.0.1:8080/idp --realm master --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null 2>&1`]);
  const roles = get('roles', '--fields', 'id,name');
  let role = roles.find((value) => value.name === 'nowline-admin');
  if (!role && apply) {
    write('create', 'roles', { name: 'nowline-admin', description: 'Read-only Goals to Today operations and Grafana access' });
    role = get('roles/nowline-admin');
  }
  const clients = get('clients', '-q', 'clientId=nowline-mobile', '--fields', 'id,clientId');
  assert.ok(clients.length <= 1, 'Ambiguous mobile client');
  const mobile = {
    clientId: 'nowline-mobile', name: 'Goals to Today mobile', enabled: true, protocol: 'openid-connect',
    publicClient: true, standardFlowEnabled: true, implicitFlowEnabled: false,
    directAccessGrantsEnabled: false, serviceAccountsEnabled: false,
    redirectUris: ['com.jieseob.planner://auth/callback'],
    webOrigins: ['capacitor://localhost', 'http://localhost', 'https://localhost'],
    attributes: { 'pkce.code.challenge.method': 'S256', 'post.logout.redirect.uris': 'com.jieseob.planner://auth/logout' },
    defaultClientScopes: ['web-origins', 'acr', 'profile', 'roles', 'basic', 'email'],
    optionalClientScopes: ['offline_access'],
  };
  if (apply) {
    if (clients[0]) {
      const attributes = get(`clients/${clients[0].id}`).attributes || {};
      write('update', `clients/${clients[0].id}`, { ...mobile, attributes: { ...attributes, ...mobile.attributes } });
    } else write('create', 'clients', mobile);
    const client = get('clients', '-q', 'clientId=nowline-mobile', '--fields', 'id,clientId')[0];
    const mappers = get(`clients/${client.id}/protocol-mappers/models`);
    const audience = { name: 'nowline-api-audience', protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper',
      config: { 'included.client.audience': 'nowline-api', 'access.token.claim': 'true', 'id.token.claim': 'false' } };
    const existing = mappers.find((mapper) => mapper.name === audience.name);
    write(existing ? 'update' : 'create', `clients/${client.id}/protocol-mappers/models${existing ? `/${existing.id}` : ''}`, { ...audience, ...(existing ? { id: existing.id } : {}) });
  }
  if (theme && apply) {
    exec(['test', '-r', '/opt/keycloak/themes/goalstotoday/login/theme.properties']);
    // Partial update preserves SMTP, registration, brute-force protection, and existing sessions.
    write('update', '', { loginTheme: 'goalstotoday' });
  }
  if (adminEmail) {
    const users = get('users', '-q', `email=${adminEmail}`, '-q', 'exact=true', '--fields', 'id,email,enabled')
      .filter((user) => user.email?.toLowerCase() === adminEmail);
    assert.equal(users.length, 1, 'Expected exactly one existing account; will not create or guess an administrator');
    assert.equal(users[0].enabled, true, 'Admin account must be enabled');
    const assigned = get(`users/${users[0].id}/role-mappings/realm`);
    if (!assigned.some((item) => item.name === 'nowline-admin')) {
      assert.ok(role, 'Administrator role is missing; run with --apply');
      if (apply) write('create', `users/${users[0].id}/role-mappings/realm`, [{ id: role.id, name: role.name }]);
    }
    const confirmed = get(`users/${users[0].id}/role-mappings/realm`);
    assert.ok(confirmed.some((item) => item.name === 'nowline-admin'), 'Admin role not assigned');
    console.log('Authorized existing administrator account role verified (email and identity omitted).');
  }
  const realm = get('', '--fields', 'realm,loginTheme');
  assert.ok(role, 'Administrator role missing');
  const client = get('clients', '-q', 'clientId=nowline-mobile', '--fields', 'id,clientId')[0];
  assert.ok(client, 'Mobile client missing; run with --apply');
  // kcadm --fields projection discards dotted attribute keys; inspect in memory without printing the representation.
  const current = get(`clients/${client.id}`);
  assert.equal(current.publicClient, true);
  assert.equal(current.directAccessGrantsEnabled, false);
  assert.equal(current.implicitFlowEnabled, false);
  assert.deepEqual(current.redirectUris, mobile.redirectUris);
  assert.equal(current.attributes['pkce.code.challenge.method'], 'S256');
  if (theme) assert.equal(realm.loginTheme, 'goalstotoday');
  console.log('Product identity verified: explicit administrator role, PKCE mobile client' + (theme ? ', custom login theme.' : '.'));
} finally {
  try { exec(['rm', '-f', config]); } catch { /* Container may have restarted; no host credentials were written. */ }
}
