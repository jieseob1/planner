import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { configurationChecks, parseS3Object, inspectLocalBackup, checkOffhostObject, publicChecks, podChecks, parseArgs } from './beta-operations.mjs';

test('no configuration is never declared ready, and configured destinations remain unverified', () => {
  assert.equal(configurationChecks({}).filter(check => check.status === 'not-configured').length, 3);
  const checks = configurationChecks({ NOWLINE_BACKUP_S3_OBJECT: 's3://private-bucket/backup.sql.gz', NOWLINE_EXTERNAL_MONITOR_URL: 'https://monitor.invalid/secret', NOWLINE_ALERT_CHANNEL: 'private@example.invalid' });
  assert(checks.every(check => check.status === 'unverified'));
  assert(!JSON.stringify(checks).includes('secret'));
  assert(!JSON.stringify(checks).includes('private@example'));
});

test('CLI refuses unsafe cluster and incomplete/unknown arguments before commands run', () => {
  assert.throws(() => parseArgs(['--runtime']));
  assert.throws(() => parseArgs(['--runtime', '--context', 'production']));
  assert.throws(() => parseArgs(['--apply']));
  assert.throws(() => parseArgs(['--verify-offhost']));
  assert.throws(() => parseArgs(['--backup-file', '--public']));
  assert.equal(parseArgs(['--runtime', '--context', 'kind-nowline-local']).runtime, true);
});

test('S3 requires an exact object and rejects URLs/tokens/traversal', () => {
  assert.deepEqual(parseS3Object('s3://backup-bucket/mysql/20260908.sql.gz'), { bucket: 'backup-bucket', key: 'mysql/20260908.sql.gz' });
  for (const bad of ['https://s3.invalid/backup.sql.gz', 's3://bucket/', 's3://bucket/a.sql.gz?token=private', 's3://bucket/../a.sql.gz', 's3://bucket/a\nb.sql.gz']) assert.throws(() => parseS3Object(bad));
});

test('local backup inspector streams valid gzip and rejects corrupt, stale and tiny dumps', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nowline-backup-audit-test-'));
  const file = join(directory, 'fixture.sql.gz');
  try {
    const payload = gzipSync('-- isolated non-production fixture\n'.repeat(100));
    await writeFile(file, payload);
    const local = await inspectLocalBackup(file);
    assert.equal(local.bytes, payload.length);
    assert.equal(local.checksumSHA256, createHash('sha256').update(payload).digest('base64'));
    assert(local.sqlBytes > 1024);
    await utimes(file, new Date('2020-01-01'), new Date('2020-01-01'));
    await assert.rejects(() => inspectLocalBackup(file), /stale/);
    await writeFile(file, Buffer.alloc(100, 42));
    await assert.rejects(() => inspectLocalBackup(file));
    await writeFile(file, gzipSync('small'));
    await assert.rejects(() => inspectLocalBackup(file));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('off-host verification requires full checksum, encryption, recency and immediate retrieval', () => {
  const now = Date.parse('2026-09-08T10:00:00Z');
  const local = { bytes: 4567, checksumSHA256: 'verified-full-object-sha256' };
  const head = { LastModified: '2026-09-08T09:00:00Z', ContentLength: 4567, ChecksumSHA256: local.checksumSHA256, ChecksumType: 'FULL_OBJECT', ServerSideEncryption: 'AES256', StorageClass: 'STANDARD' };
  assert.equal(checkOffhostObject(head, local, now).status, 'passed');
  for (const mutation of [
    { LastModified: '2026-09-01T00:00:00Z' }, { LastModified: 'nonsense' }, { LastModified: '2027-01-01T00:00:00Z' },
    { ContentLength: 10 }, { ServerSideEncryption: undefined }, { ChecksumSHA256: 'different' }, { StorageClass: 'DEEP_ARCHIVE' }, { ArchiveStatus: 'ARCHIVE_ACCESS' },
  ]) assert.equal(checkOffhostObject({ ...head, ...mutation }, local, now).status, 'failed');
  assert.equal(checkOffhostObject({ ...head, ChecksumSHA256: undefined }, local, now).status, 'unverified');
  assert.equal(checkOffhostObject({ ...head, ChecksumType: 'COMPOSITE' }, local, now).status, 'unverified');
});

const responses = {
  '/healthz': ['ok\n', 200], '/version.json': [JSON.stringify({ revision: 'a'.repeat(40) }), 200],
  '/idp/realms/nowline/.well-known/openid-configuration': [JSON.stringify({ issuer: 'https://goalstotoday.com/idp/realms/nowline' }), 200],
  '/ops/grafana/api/health': ['{"database":"ok"}', 200], '/ops/grafana/api/search': ['unauthorized', 401], '/api/actuator/prometheus': ['', 404],
};
const fakeFetch = async (url, options) => {
  assert.equal(options.redirect, 'manual');
  const [body, status] = responses[new URL(url).pathname];
  return new Response(body, { status });
};

test('public probes verify response semantics not just a reachable HTML fallback', async () => {
  assert((await publicChecks(fakeFetch)).every(check => check.status === 'passed'));
  assert((await publicChecks(async () => new Response('<html>login</html>', { status: 200 }))).every(check => check.status === 'failed'));
  const errors = await publicChecks(async () => { throw new Error('secret access token'); });
  assert(errors.every(check => check.status === 'failed'));
  assert(!JSON.stringify(errors).includes('secret'));
});

test('public discovery fails issuer mismatch and anonymous Grafana success is rejected', async () => {
  const checks = await publicChecks(async (url, options) => {
    if (url.includes('openid-configuration')) return new Response('{"issuer":"https://wrong.invalid"}');
    if (url.endsWith('/api/search')) return new Response('[]');
    return fakeFetch(url, options);
  });
  assert.equal(checks.find(check => check.id === 'oidc-discovery').status, 'failed');
  assert.equal(checks.find(check => check.id === 'grafana-anonymous-denied').status, 'failed');
});

test('cluster checks distinguish empty inventory, ready pods, pending pods and a recent OOM', () => {
  const now = Date.parse('2026-09-08T10:00:00Z');
  const pods = ['nowline-local', 'nowline-observability'].map(namespace => ({ metadata: { namespace }, status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }], containerStatuses: [] } }));
  assert(podChecks(pods, now).every(check => check.status === 'passed'));
  assert.equal(podChecks([], now).filter(check => check.status === 'failed').length, 2);
  pods[1].status.containerStatuses.push({ lastState: { terminated: { reason: 'OOMKilled', finishedAt: '2026-09-08T09:00:00Z' } } });
  assert.equal(podChecks(pods, now).find(check => check.id === 'nowline-observability-oom').status, 'failed');
  pods[0].status.conditions = [];
  assert.equal(podChecks(pods, now).find(check => check.id === 'nowline-local-ready').status, 'failed');
});

test('default CLI performs no network/cluster action and strict mode fails for unverified readiness', () => {
  const normal = spawnSync(process.execPath, ['scripts/beta-operations.mjs'], { encoding: 'utf8', env: { PATH: '', NOWLINE_ALERT_CHANNEL: 'sensitive-value' } });
  assert.equal(normal.status, 0);
  assert.equal(JSON.parse(normal.stdout).ready, false);
  assert(!normal.stdout.includes('sensitive-value'));
  const strict = spawnSync(process.execPath, ['scripts/beta-operations.mjs', '--require-ready'], { encoding: 'utf8', env: { PATH: '' } });
  assert.equal(strict.status, 2);
});
