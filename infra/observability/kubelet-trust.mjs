import assert from 'node:assert/strict';
import { X509Certificate, createHash } from 'node:crypto';
import { parse, stringify } from 'yaml';

/** Build direct kubelet TLS trust from the operator-read public serving cert. */
export function kubeletTlsPlan(node, servingCertificate, clusterCa, prometheusConfig, rules, now = Date.now()) {
  const nodeName = node.metadata.name;
  assert.match(nodeName, /^nowline-local-[a-z0-9-]+$/, 'Unexpected kind node name');
  const leaf = new X509Certificate(servingCertificate);
  assert(new Date(leaf.validFrom).getTime() <= now && new Date(leaf.validTo).getTime() > now, 'Kubelet serving certificate is not currently valid');
  const nodeIp = node.status.addresses.find(address => address.type === 'InternalIP')?.address;
  assert(nodeIp, 'Kind node has no InternalIP');
  let serverName;
  if (!leaf.checkIP(nodeIp)) {
    // A CN-only match and wildcard SAN are deliberately not accepted. Kind's
    // self-signed serving cert commonly contains only this exact DNS SAN.
    assert.equal(leaf.checkHost(nodeName, {subject: 'never', wildcards: false, partialWildcards: false}), nodeName,
      'Kubelet certificate must contain the node IP or exact node DNS SAN');
    serverName = nodeName;
  }
  const config = parse(prometheusConfig);
  const jobs = config.scrape_configs.filter(job => ['kind-kubelet', 'kind-node'].includes(job.job_name));
  assert.equal(jobs.length, 2, 'Expected both direct kubelet jobs');
  for (const job of jobs) {
    assert.equal(job.scheme, 'https');
    assert.equal(job.tls_config.ca_file, '/etc/kubelet-ca/ca.crt');
    assert(!job.tls_config.insecure_skip_verify, 'Kubelet TLS verification cannot be disabled');
    if (serverName) job.tls_config.server_name = serverName;
    else delete job.tls_config.server_name;
  }
  const trustBundle = `${servingCertificate.trim()}\n${clusterCa.trim()}\n`;
  const renderedConfig = stringify(config);
  return {trustBundle, renderedConfig, serverName,
    trustChecksum: createHash('sha256').update(trustBundle).digest('hex'),
    configChecksum: createHash('sha256').update(JSON.stringify({prometheus: renderedConfig, rules, trustBundle})).digest('hex')};
}
