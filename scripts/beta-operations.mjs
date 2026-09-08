import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import { resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const CONTEXT = 'kind-nowline-local';
const DAY = 86_400_000;
const outcome = (id, status, detail) => ({ id, status, detail });

// No credentials, URLs with tokens, task text, emails or subprocess stderr are
// included in this report. Configuration presence is explicitly not proof.
export function configurationChecks(env = process.env) {
  return [
    outcome('offhost-backup', env.NOWLINE_BACKUP_S3_OBJECT ? 'unverified' : 'not-configured',
      env.NOWLINE_BACKUP_S3_OBJECT ? 'Object configured; verify the exact recent encrypted object against a local dump.' : 'Configure a recent S3 backup object on an independent host/account; a local PVC is not off-host backup.'),
    outcome('external-monitor', env.NOWLINE_EXTERNAL_MONITOR_URL ? 'unverified' : 'not-configured',
      'An independent monitor must probe public health and OIDC discovery and deliver a deliberate failure/recovery alert. A URL alone does not prove this.'),
    outcome('alert-delivery', env.NOWLINE_ALERT_CHANNEL ? 'unverified' : 'not-configured',
      'Prometheus rules are dashboard-visible only until a receiver and real delivery test are configured.'),
    outcome('restore-drill', 'unverified', 'Restore the latest off-host backup into an isolated MySQL instance and compare data; never overwrite the live database.'),
  ];
}

export function parseS3Object(value) {
  if (!/^s3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\/.+\.sql\.gz$/.test(value || '') || /[\s?#\x00-\x1f]/.test(value)) {
    throw new Error('Expected an exact s3://bucket/prefix/backup.sql.gz object, without credentials, query or fragment.');
  }
  const slash = value.indexOf('/', 5);
  const bucket = value.slice(5, slash);
  const key = value.slice(slash + 1);
  if (bucket.includes('..') || key.split('/').some(part => part === '..' || part === '.')) throw new Error('Invalid S3 object path.');
  return { bucket, key };
}

export async function inspectLocalBackup(file, now = Date.now()) {
  if (!isAbsolute(file) || !file.endsWith('.sql.gz')) throw new Error('Backup path must be an absolute .sql.gz file.');
  const info = await stat(file);
  if (!info.isFile() || info.size < 32 || info.size > 1024 ** 3) throw new Error('Backup must be a regular gzip file between 32 bytes and 1 GiB.');
  if (now - info.mtimeMs > 26 * 3_600_000 || info.mtimeMs - now > 300_000) throw new Error('Local backup is stale or has a future modification time.');
  const digest = createHash('sha256');
  let sqlBytes = 0;
  await pipeline(createReadStream(file), new Transform({
    transform(chunk, _encoding, callback) { digest.update(chunk); callback(null, chunk); },
  }), createGunzip(), new Writable({
    write(chunk, _encoding, callback) {
      sqlBytes += chunk.length;
      callback(sqlBytes > 8 * 1024 ** 3 ? new Error('Uncompressed backup exceeded the 8 GiB safety limit.') : undefined);
    },
  }));
  if (sqlBytes < 1024) throw new Error('Backup payload is unexpectedly small.');
  return { bytes: info.size, checksumSHA256: digest.digest('base64'), sqlBytes };
}

export function checkOffhostObject(head, local, now = Date.now()) {
  const modified = Date.parse(head.LastModified);
  if (!Number.isFinite(modified) || now - modified > 26 * 3_600_000 || modified - now > 300_000) {
    return outcome('offhost-backup', 'failed', 'Remote object is stale or has an invalid timestamp.');
  }
  if (head.ContentLength !== local.bytes) return outcome('offhost-backup', 'failed', 'Remote object size does not match the verified local gzip.');
  if (!['AES256', 'aws:kms', 'aws:kms:dsse'].includes(head.ServerSideEncryption)) {
    return outcome('offhost-backup', 'failed', 'Remote encryption at rest could not be established.');
  }
  if (['GLACIER', 'DEEP_ARCHIVE'].includes(head.StorageClass) || head.ArchiveStatus) {
    return outcome('offhost-backup', 'failed', 'The newest backup is archived; retain an immediately retrievable copy for beta recovery.');
  }
  // ETag is not a content hash for multipart/SSE objects. Do not accept custom
  // metadata or a multipart composite checksum as full-object integrity proof.
  if (!head.ChecksumSHA256 || head.ChecksumType === 'COMPOSITE') {
    return outcome('offhost-backup', 'unverified', 'Remote full-object SHA-256 is unavailable; size alone cannot prove integrity. Upload with a full-object checksum or verify a downloaded restore.');
  }
  if (head.ChecksumSHA256 !== local.checksumSHA256) return outcome('offhost-backup', 'failed', 'Remote SHA-256 does not match the local gzip.');
  return outcome('offhost-backup', 'passed', 'Recent encrypted remote object matches local gzip size and full-object SHA-256. This is not a restore test.');
}

export async function publicChecks(fetcher = fetch) {
  const origin = 'https://goalstotoday.com';
  const checks = [
    ['public-health', '/healthz', async response => response.status === 200 && (await response.text()).trim() === 'ok'],
    ['public-version', '/version.json', async response => response.status === 200 && /^[a-f0-9]{40}$/.test((await response.json()).revision ?? '')],
    ['oidc-discovery', '/idp/realms/nowline/.well-known/openid-configuration', async response => response.status === 200 && (await response.json()).issuer === `${origin}/idp/realms/nowline`],
    ['grafana-health', '/ops/grafana/api/health', async response => response.status === 200 && (await response.json()).database === 'ok'],
    ['grafana-anonymous-denied', '/ops/grafana/api/search', async response => [401, 302, 303].includes(response.status)],
    ['metrics-not-public', '/api/actuator/prometheus', async response => [401, 403, 404].includes(response.status)],
  ];
  return Promise.all(checks.map(async ([id, path, validate]) => {
    try {
      const response = await fetcher(`${origin}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(8_000) });
      return outcome(id, await validate(response) ? 'passed' : 'failed', `HTTP ${response.status}; read-only probe, not a real-user workflow test.`);
    } catch {
      return outcome(id, 'failed', 'The read-only probe timed out or returned an invalid response.');
    }
  }));
}

export function podChecks(pods, now = Date.now()) {
  const checks = [];
  for (const namespace of ['nowline-local', 'nowline-observability']) {
    const active = pods.filter(pod => pod.metadata.namespace === namespace && !pod.metadata.deletionTimestamp && !['Succeeded', 'Failed'].includes(pod.status?.phase));
    checks.push(outcome(`${namespace}-ready`, active.length > 0 && active.every(pod => pod.status?.conditions?.some(c => c.type === 'Ready' && c.status === 'True')) ? 'passed' : 'failed', `${active.length} active pods examined; completed jobs excluded.`));
    const recent = active.flatMap(pod => pod.status.containerStatuses || []).filter(c => {
      const state = c.lastState?.terminated;
      return state?.reason === 'OOMKilled' && now - Date.parse(state.finishedAt) < DAY;
    });
    checks.push(outcome(`${namespace}-oom`, recent.length ? 'failed' : 'passed', `${recent.length} active container(s) have a recorded OOM within 24 hours; replaced pods and older history are not covered.`));
  }
  return checks;
}

const executeJson = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 15_000, maxBuffer: 8 * 1024 ** 2 });
  if (result.status !== 0) throw new Error('Read-only command failed; check CLI credentials/connectivity locally.');
  return JSON.parse(result.stdout);
};

export function parseArgs(args) {
  const options = { public: false, runtime: false, offhost: false, strict: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (['--public', '--runtime', '--verify-offhost', '--require-ready'].includes(arg)) {
      options[({ '--public': 'public', '--runtime': 'runtime', '--verify-offhost': 'offhost', '--require-ready': 'strict' })[arg]] = true;
    } else if (arg === '--context' || arg === '--backup-file') {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing ${arg} value.`);
      options[arg === '--context' ? 'context' : 'backupFile'] = args[++index];
    } else throw new Error('Unknown option. Use --public, --runtime --context kind-nowline-local, --verify-offhost --backup-file /absolute/backup.sql.gz, --require-ready.');
  }
  if (options.runtime && options.context !== CONTEXT) throw new Error('Runtime checks require explicit --context kind-nowline-local.');
  if (options.offhost && !options.backupFile) throw new Error('--verify-offhost requires --backup-file.');
  return options;
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const options = parseArgs(args);
  let checks = configurationChecks(env);
  if (options.public) checks.push(...await publicChecks());
  if (options.runtime) {
    try {
      const pods = ['nowline-local', 'nowline-observability'].flatMap(namespace => executeJson('kubectl', ['--context', CONTEXT, '-n', namespace, 'get', 'pods', '-o', 'json']).items);
      checks.push(...podChecks(pods));
    } catch { checks.push(outcome('runtime', 'failed', 'Unable to read local cluster pod health. No mutations attempted.')); }
    try {
      const { verify } = await import('./scheduled-beta-backup.mjs');
      const backup = await verify();
      if (backup.offhost === 'verified') {
        checks = checks.filter(check => check.id !== 'offhost-backup');
        checks.push(outcome('offhost-backup', 'unverified', 'The last scheduled backup recorded a verified remote upload; current remote integrity and restore were not checked by this runtime probe.'));
      }
      checks.push(outcome('daily-backup', backup.status === 'healthy' && !backup.locked ? 'passed' : backup.status === 'not-installed' ? 'not-configured' : 'failed',
        `Host backup status: ${backup.status}; offhost: ${backup.offhost}. This check does not establish a restore or external monitor.`));
    } catch { checks.push(outcome('daily-backup', 'failed', 'Unable to validate host backup status; inspect the local state file without posting its contents.')); }
  }
  if (options.offhost) {
    try {
      const local = await inspectLocalBackup(options.backupFile);
      const { bucket, key } = parseS3Object(env.NOWLINE_BACKUP_S3_OBJECT);
      const head = executeJson('aws', ['s3api', 'head-object', '--bucket', bucket, '--key', key, '--checksum-mode', 'ENABLED', '--output', 'json', '--no-cli-pager']);
      checks = checks.filter(check => check.id !== 'offhost-backup');
      checks.push(checkOffhostObject(head, local));
    } catch { checks = checks.filter(check => check.id !== 'offhost-backup'); checks.push(outcome('offhost-backup', 'failed', 'Backup verification failed. Check the absolute local gzip, exact S3 object and CLI permissions; no dump contents or credentials were printed.')); }
  }
  const ready = checks.every(check => check.status === 'passed');
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'read-only', ready, checks }, null, 2));
  if (options.strict && !ready) return 2;
  return checks.some(check => check.status === 'failed') ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
