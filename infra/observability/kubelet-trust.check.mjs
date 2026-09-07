import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { parse } from 'yaml';
import { kubeletTlsPlan } from './kubelet-trust.mjs';

const config = readFileSync(new URL('prometheus.yml', import.meta.url), 'utf8');
const rules = readFileSync(new URL('rules.yml', import.meta.url), 'utf8');
const node = {metadata: {name: 'nowline-local-control-plane'}, status: {addresses: [{type: 'InternalIP', address: '172.18.0.2'}]}};
function certificate(san, cn = 'fixture.invalid') {
  // Ephemeral test key is discarded to /dev/null; only public fixture PEM is
  // returned in memory. No live cluster certificate or credential is accessed.
  const result = spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', '/dev/null',
    '-days', '2', '-subj', `/CN=${cn}`, ...(san ? ['-addext', `subjectAltName=${san}`] : [])], {encoding: 'utf8', timeout: 5000});
  assert.equal(result.status, 0, 'OpenSSL could not generate a public test certificate');
  return result.stdout;
}
test('DNS-only kind certificate sets exact server_name while preserving direct IP discovery', () => {
  const pem = certificate('DNS:nowline-local-control-plane');
  const result = kubeletTlsPlan(node, pem, pem, config, rules);
  assert.equal(result.serverName, node.metadata.name);
  for (const job of parse(result.renderedConfig).scrape_configs.filter(job => job.job_name.startsWith('kind-'))) {
    assert.equal(job.tls_config.server_name, node.metadata.name);
    assert(!job.tls_config.insecure_skip_verify);
    assert(!JSON.stringify(job.relabel_configs).includes('__address__'));
  }
  assert.deepEqual(kubeletTlsPlan(node, pem, pem, config, rules), result, 'Identical input must produce stable config/trust hashes');
  const rotated = certificate('DNS:nowline-local-control-plane');
  assert.notEqual(kubeletTlsPlan(node, rotated, pem, config, rules).configChecksum, result.configChecksum);
});
test('matching IP SAN needs no overridden server name', () => {
  const pem = certificate('IP:172.18.0.2');
  const result = kubeletTlsPlan(node, pem, pem, config, rules);
  assert.equal(result.serverName, undefined);
  assert(parse(result.renderedConfig).scrape_configs.filter(job => job.job_name.startsWith('kind-')).every(job => !job.tls_config.server_name));
});
test('wrong SAN, wildcard SAN, CN-only match and expired certificate fail closed', () => {
  for (const pem of [certificate('DNS:wrong.invalid'), certificate('DNS:*.local-control-plane'), certificate(null, node.metadata.name)]) {
    assert.throws(() => kubeletTlsPlan(node, pem, pem, config, rules), /exact node DNS SAN/);
  }
  const pem = certificate('DNS:nowline-local-control-plane');
  assert.throws(() => kubeletTlsPlan(node, pem, pem, config, rules, new Date(new X509Certificate(pem).validTo).getTime() + 1), /not currently valid/);
});
