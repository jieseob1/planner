import { createWriteStream } from 'node:fs';
import { mkdir, lstat, readFile, writeFile, rename, unlink, readdir, chmod, statfs } from 'node:fs/promises';
import { join, dirname, basename, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { inspectLocalBackup, parseS3Object, checkOffhostObject } from './beta-operations.mjs';

const CONTEXT = 'kind-nowline-local';
const LABEL = 'com.goalstotoday.backup';
const OWNER = 'goalstotoday-scheduled-backup-v1';
const DAY = 86_400_000;
const validName = name => /^mysql-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9-]{36}\.sql\.gz$/.test(name);
const stateFor = home => join(home, '.local', 'state', 'goalstotoday-backup');

export const dumpArgs = ['--context', CONTEXT, '-n', 'nowline-local', 'exec', 'nowline-mysql-0', '--', 'sh', '-ec',
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump --user=root --single-transaction --quick --routines --triggers --events --hex-blob --set-gtid-purged=OFF --no-tablespaces --databases nowline keycloak'];

const exists = async file => { try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
async function regularFile(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Expected a regular owned file.');
  return info;
}
async function ownedDirectory(directory) {
  if (!isAbsolute(directory) || basename(directory) !== 'goalstotoday-backup') throw new Error('Unexpected backup directory.');
  // Do not follow a pre-existing symbolic link at any level of our state path.
  for (let part = directory; part !== dirname(part); part = dirname(part)) {
    if (await exists(part) && (await lstat(part)).isSymbolicLink()) throw new Error('Backup path must not contain symbolic links.');
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(directory)).isDirectory()) throw new Error('Backup state is not a directory.');
  const marker = join(directory, 'owner.json');
  if (!await exists(marker)) {
    if ((await readdir(directory)).length) throw new Error('Refusing to claim a nonempty unknown directory.');
    await writeFile(marker, JSON.stringify({ owner: OWNER }), { flag: 'wx', mode: 0o600 });
  } else if ((await readJson(marker)).owner !== OWNER) throw new Error('Backup directory belongs to another application.');
  await chmod(directory, 0o700);
}
async function readJson(file) { await regularFile(file); return JSON.parse(await readFile(file, 'utf8')); }
async function atomicJson(file, value) {
  if (await exists(file)) await regularFile(file);
  const temp = `${file}.${randomUUID()}.pending`;
  await writeFile(temp, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  await rename(temp, file);
}
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: ['launchctl', 'plutil'].includes(command) ? 10_000 : 600_000, maxBuffer: 2 * 1024 ** 2 });
  // CLI errors may include credentials, database names and paths; caller emits
  // a stable phase code, never child stderr/stdout on failures.
  if (result.status !== 0) throw new Error('Operation failed.');
  return result.stdout;
};

export async function writeDump(file, execute = spawn) {
  const child = execute('kubectl', dumpArgs, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 600_000 });
  const completion = new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? accept() : reject(new Error('MySQL dump failed.')));
  });
  // Observe rejections immediately while pipeline drains stdout.
  completion.catch(() => {});
  let compressed = 0;
  try {
    await Promise.all([completion, pipeline(child.stdout, createGzip({ level: 6 }), new Transform({
      transform(chunk, _encoding, callback) {
        compressed += chunk.length;
        callback(compressed > 1024 ** 3 ? new Error('Compressed backup exceeds the 1 GiB safety budget.') : null, chunk);
      },
    }), createWriteStream(file, { flags: 'wx', mode: 0o600 }))]);
  } catch {
    child.kill('SIGTERM');
    throw new Error('MySQL dump failed.');
  }
}

export function backupConfig(env) {
  const prefix = env.NOWLINE_BACKUP_S3_PREFIX?.replace(/\/$/, '') || '';
  if (prefix) parseS3Object(`${prefix}/configuration-check.sql.gz`);
  for (const key of ['AWS_PROFILE', 'AWS_REGION']) if (env[key] && !/^[\w.-]{1,128}$/.test(env[key])) throw new Error(`Invalid ${key}.`);
  return { owner: OWNER, s3Prefix: prefix, awsProfile: env.AWS_PROFILE || '', awsRegion: env.AWS_REGION || '' };
}

export function planRetention(manifests, now = Date.now()) {
  return manifests.filter(item => item.owner === OWNER && validName(item.file) && Number.isFinite(Date.parse(item.completedAt)))
    .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
    .slice(7).filter(item => now - Date.parse(item.completedAt) > 14 * DAY).map(item => item.file);
}

async function retain(directory, now) {
  const manifests = [];
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.sql.gz.json') || !validName(name.slice(0, -5))) continue;
    try {
      const item = await readJson(join(directory, name));
      if (item.file === name.slice(0, -5)) manifests.push(item);
    } catch { /* Unrecognized, symlinked or malformed artifacts are preserved. */ }
  }
  let removed = 0;
  for (const file of planRetention(manifests, now)) {
    const target = join(directory, file);
    const manifest = join(directory, `${file}.json`);
    if (!await exists(target)) continue;
    const info = await regularFile(target);
    const meta = await readJson(manifest);
    if (info.size !== meta.bytes || meta.owner !== OWNER) continue;
    await unlink(target);
    await unlink(manifest);
    removed++;
  }
  return removed;
}

export async function executeBackup({ home = homedir(), now = () => Date.now(), force = false, dump = writeDump, command = run } = {}) {
  const directory = stateFor(home);
  await ownedDirectory(directory);
  const config = await exists(join(directory, 'config.json')) ? await readJson(join(directory, 'config.json')) : backupConfig({});
  if (config.owner !== OWNER) throw new Error('Invalid backup configuration.');
  if (config.s3Prefix) parseS3Object(`${config.s3Prefix}/configuration-check.sql.gz`);
  const lock = join(directory, 'backup.lock');
  // Never break another process's lock, even if it looks stale; operators must
  // first inspect its PID and the last-run report before removing this one file.
  await writeFile(lock, JSON.stringify({ pid: process.pid, startedAt: new Date(now()).toISOString() }), { flag: 'wx', mode: 0o600 });
  let temporary;
  let unverifiedArtifact;
  let stage = 'preflight';
  try {
    const last = await exists(join(directory, 'last-success.json')) ? await readJson(join(directory, 'last-success.json')) : null;
    const recentRun = await exists(join(directory, 'last-run.json')) ? await readJson(join(directory, 'last-run.json')) : null;
    if (!force && last && recentRun?.status === 'success' && now() - Date.parse(last.completedAt) < DAY && now() >= Date.parse(last.completedAt) && (await verifyBackup({ home, now: now() })).fresh) {
      return { status: 'skipped', reason: 'A successful backup is less than 24 hours old.', offhost: last.offhost };
    }
    const deployLock = join(home, '.local', 'state', 'goalstotoday-deploy', 'deploy.lock');
    if (await exists(deployLock)) throw new Error('Deployment is active.');
    const disk = await statfs(directory);
    if (disk.bavail * disk.bsize < 2 * 1024 ** 3) throw new Error('Less than 2 GiB free disk remains.');
    const file = `mysql-${new Date(now()).toISOString().replaceAll(':', '-').replace('.', '-')}-${randomUUID()}.sql.gz`;
    if (!validName(file)) throw new Error('Invalid generated backup name.');
    temporary = join(directory, `${file}.pending`);
    stage = 'mysql-dump';
    await dump(temporary);
    await regularFile(temporary);
    await chmod(temporary, 0o600);
    const target = join(directory, file);
    await rename(temporary, target);
    temporary = null;
    unverifiedArtifact = target;
    stage = 'gzip-integrity';
    const local = await inspectLocalBackup(target, now());
    if (await exists(deployLock)) throw new Error('Deployment became active; retry once stable.');
    const manifest = { owner: OWNER, status: 'success', file, completedAt: new Date(now()).toISOString(), bytes: local.bytes, checksumSHA256: local.checksumSHA256, offhost: 'not-configured', databases: ['nowline', 'keycloak'], localEncryption: 'none-permissions-only' };
    // An upload failure must not turn a useful local artifact into an orphan
    // that is forever outside retention. The run still fails until S3 verifies.
    await atomicJson(join(directory, `${file}.json`), { ...manifest, offhost: config.s3Prefix ? 'pending' : 'not-configured' });
    unverifiedArtifact = null;
    let offhost = 'not-configured';
    if (config.s3Prefix) {
      stage = 'offhost-upload';
      const { bucket, key } = parseS3Object(`${config.s3Prefix}/${file}`);
      const flags = [...(config.awsProfile ? ['--profile', config.awsProfile] : []), ...(config.awsRegion ? ['--region', config.awsRegion] : []), '--no-cli-pager'];
      command('aws', ['s3api', 'put-object', '--bucket', bucket, '--key', key, '--body', target, '--checksum-algorithm', 'SHA256', '--checksum-sha256', local.checksumSHA256,
        '--server-side-encryption', 'AES256', '--storage-class', 'STANDARD', '--if-none-match', '*', '--output', 'json', ...flags]);
      stage = 'offhost-verification';
      const head = JSON.parse(command('aws', ['s3api', 'head-object', '--bucket', bucket, '--key', key, '--checksum-mode', 'ENABLED', '--output', 'json', ...flags]));
      if (checkOffhostObject(head, local, now()).status !== 'passed') throw new Error('Off-host verification failed.');
      offhost = 'verified';
    }
    stage = 'manifest';
    manifest.offhost = offhost;
    await atomicJson(join(directory, `${file}.json`), manifest);
    await atomicJson(join(directory, 'last-success.json'), manifest);
    await atomicJson(join(directory, 'last-run.json'), manifest);
    stage = 'retention';
    const removed = await retain(directory, now());
    return { status: 'success', bytes: local.bytes, offhost, removedLocalArtifacts: removed, localEncryption: 'none-permissions-only' };
  } catch {
    await atomicJson(join(directory, 'last-run.json'), { owner: OWNER, status: 'failed', failedAt: new Date(now()).toISOString(), stage });
    // Only recognized, integrity-recorded artifacts can be pruned; preserve
    // unknown/incomplete files for investigation.
    await retain(directory, now()).catch(() => {});
    throw new Error(`Scheduled backup failed during ${stage}; previous successful backups were preserved.`);
  } finally {
    if (temporary && await exists(temporary)) { await regularFile(temporary); await unlink(temporary); }
    if (unverifiedArtifact && await exists(unverifiedArtifact)) { await regularFile(unverifiedArtifact); await unlink(unverifiedArtifact); }
    await regularFile(lock);
    await unlink(lock);
  }
}

const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
export function launchdPlist({ home, repository, nodePath }) {
  if (![home, repository, nodePath].every(isAbsolute)) throw new Error('Launchd paths must be absolute.');
  const directory = stateFor(home);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>${xml(nodePath)}</string><string>${xml(join(repository, 'scripts/scheduled-beta-backup.mjs'))}</string><string>--run</string><string>--context</string><string>${CONTEXT}</string></array>
<key>WorkingDirectory</key><string>${xml(repository)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>15</integer></dict>
<key>StartInterval</key><integer>3600</integer>
<key>RunAtLoad</key><true/>
<key>ProcessType</key><string>Background</string>
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(join(directory, 'scheduler.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(directory, 'scheduler-error.log'))}</string>
</dict></plist>\n`;
}

export function inspectScheduler({ home = homedir(), uid = process.getuid?.(), platform = process.platform, command = run } = {}) {
  const result = { schedulerLoaded: false, schedulerDomain: null, schedulerStatus: 'not-loaded', availableDomains: [], bootPersistenceVerified: false };
  if (platform !== 'darwin') return { ...result, schedulerStatus: 'unsupported-platform' };
  if (!Number.isSafeInteger(uid) || uid <= 0) return { ...result, schedulerStatus: 'non-root-user-required' };
  const plist = join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
  const services = [];
  // OS launchctl(1): gui/<uid> requires a GUI login domain; user/<uid> may
  // exist without one. Query only existing domains for this UID, never create
  // a domain or fall back to the privileged system domain.
  for (const domain of [`gui/${uid}`, `user/${uid}`]) {
    try { command('launchctl', ['print', domain]); result.availableDomains.push(domain); } catch { continue; }
    try {
      const output = command('launchctl', ['print', `${domain}/${LABEL}`]);
      const path = output.match(/^\s*path = (.+)\s*$/m)?.[1].trim().replace(/^"(.*)"$/, '$1');
      services.push({ domain, trusted: path === plist });
    } catch { /* Domain exists, but the service is absent or unreadable. */ }
  }
  if (services.some(service => !service.trusted)) return { ...result, schedulerStatus: 'registration-path-mismatch' };
  if (services.length > 1) return { ...result, schedulerStatus: 'duplicate-registration' };
  if (services.length === 1) return { ...result, schedulerLoaded: true, schedulerDomain: services[0].domain, schedulerStatus: 'loaded' };
  return { ...result, schedulerStatus: result.availableDomains.length ? 'not-loaded' : 'domains-unavailable' };
}

export async function install({ home = homedir(), repository, nodePath = process.execPath, env = process.env, platform = process.platform, uid = process.getuid?.(), command = run } = {}) {
  if (platform !== 'darwin') throw new Error('LaunchAgent installation requires macOS.');
  if (!isAbsolute(repository || '')) throw new Error('--repository must be an absolute path.');
  await regularFile(join(repository, 'scripts/scheduled-beta-backup.mjs'));
  await regularFile(nodePath);
  const scheduler = inspectScheduler({ home, uid, platform, command });
  if (['registration-path-mismatch', 'duplicate-registration'].includes(scheduler.schedulerStatus)) throw new Error('Existing backup registration is ambiguous; no service was stopped.');
  const domain = scheduler.schedulerDomain || scheduler.availableDomains[0];
  if (!domain) throw new Error('No existing same-user launchd domain is available; no privileged fallback attempted.');
  const directory = stateFor(home);
  if (await exists(join(directory, 'backup.lock'))) throw new Error('A backup lock exists; wait for the active backup before installing its schedule.');
  await ownedDirectory(directory);
  // An empty ambient environment must not silently disable an existing remote
  // destination during an ordinary code update.
  const configFile = join(directory, 'config.json');
  const config = backupConfig(env);
  if (config.s3Prefix || !await exists(configFile)) await atomicJson(configFile, config);
  const agents = join(home, 'Library', 'LaunchAgents');
  await mkdir(agents, { recursive: true, mode: 0o700 });
  if ((await lstat(agents)).isSymbolicLink()) throw new Error('LaunchAgents must not be a symlink.');
  const plist = join(agents, `${LABEL}.plist`);
  const desired = launchdPlist({ home, repository, nodePath });
  let unchanged = false;
  if (await exists(plist)) {
    await regularFile(plist);
    const existing = await readFile(plist, 'utf8');
    if (!existing.includes(`<string>${LABEL}</string>`)) throw new Error('Refusing to replace an unrelated LaunchAgent.');
    unchanged = existing === desired;
  }
  // Routine main deployments use the same executable/script paths and need no
  // restart. Do not bootout (which could kill a just-starting backup) at all.
  if (scheduler.schedulerLoaded && !unchanged) throw new Error('Loaded schedule definition differs; review and stop only an idle owned service manually before reinstalling.');
  if (!unchanged) {
    const pending = `${plist}.${randomUUID()}.pending`;
    await writeFile(pending, desired, { flag: 'wx', mode: 0o600 });
    command('plutil', ['-lint', pending]);
    await rename(pending, plist);
  } else command('plutil', ['-lint', plist]);
  const target = `${domain}/${LABEL}`;
  command('launchctl', ['enable', target]);
  if (!scheduler.schedulerLoaded) command('launchctl', ['bootstrap', domain, plist]);
  const verified = inspectScheduler({ home, uid, platform, command });
  if (!verified.schedulerLoaded || verified.schedulerDomain !== domain) throw new Error('Schedule registration could not be verified after install.');
  return { status: 'installed', label: LABEL, ...verified, reusedRegistration: scheduler.schedulerLoaded,
    schedule: '03:15 local time + hourly retry; skip successful backups younger than 24h', offhost: (await readJson(configFile)).s3Prefix ? 'configured-not-yet-verified' : 'not-configured', requiresGuiLogin: domain.startsWith('gui/') };
}

async function verifyBackup({ home = homedir(), now = Date.now() } = {}) {
  const directory = stateFor(home);
  if (!await exists(join(directory, 'owner.json'))) return { status: 'not-installed', fresh: false, offhost: 'not-configured' };
  if ((await readJson(join(directory, 'owner.json'))).owner !== OWNER) throw new Error('Unknown backup state.');
  const lastRun = await exists(join(directory, 'last-run.json')) ? await readJson(join(directory, 'last-run.json')) : null;
  const last = await exists(join(directory, 'last-success.json')) ? await readJson(join(directory, 'last-success.json')) : null;
  const locked = await exists(join(directory, 'backup.lock'));
  if (!last || !validName(last.file)) return { status: lastRun?.status === 'failed' ? 'failed' : 'never-succeeded', fresh: false, offhost: 'unverified', locked, lastFailureStage: lastRun?.stage };
  let valid = false;
  try {
    await regularFile(join(directory, last.file));
    const local = await inspectLocalBackup(join(directory, last.file), now);
    valid = local.bytes === last.bytes && local.checksumSHA256 === last.checksumSHA256;
  } catch { /* invalid/stale artifacts remain failures */ }
  const fresh = valid && now - Date.parse(last.completedAt) <= 26 * 3_600_000 && now >= Date.parse(last.completedAt);
  return { status: lastRun?.status === 'failed' ? 'failed' : fresh ? 'healthy' : 'stale-or-invalid', fresh, locked, completedAt: last.completedAt, offhost: last.offhost,
    lastFailureStage: lastRun?.stage, localEncryption: 'none-permissions-only', restoreVerified: false };
}

export async function verify({ home = homedir(), now = Date.now(), uid = process.getuid?.(), platform = process.platform, command = run } = {}) {
  const backup = await verifyBackup({ home, now });
  const scheduler = inspectScheduler({ home, uid, platform, command });
  return { ...backup, backupStatus: backup.status, ...scheduler,
    status: backup.status === 'healthy' && !scheduler.schedulerLoaded ? 'schedule-not-loaded' : backup.status };
}

export async function main(args = process.argv.slice(2)) {
  const mode = args[0];
  if (!mode) { console.log('Read-only mode. Use --install --context kind-nowline-local --repository /absolute/repo, --run --context kind-nowline-local [--force], or --verify [--require-offhost].'); return 0; }
  if (!['--install', '--run', '--verify'].includes(mode)) throw new Error('Unknown mode.');
  const options = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--context' || args[i] === '--repository') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing option value.');
      options[args[i].slice(2)] = args[++i];
    } else if (args[i] === '--force' && mode === '--run') options.force = true;
    else if (args[i] === '--require-offhost' && mode === '--verify') options.requireOffhost = true;
    else throw new Error('Unknown option.');
  }
  if (mode !== '--verify' && options.context !== CONTEXT) throw new Error('Explicit --context kind-nowline-local is required.');
  const result = mode === '--install' ? await install({ repository: options.repository }) : mode === '--run' ? await executeBackup({ force: options.force }) : await verify();
  console.log(JSON.stringify(result, null, 2));
  return mode === '--verify' && (result.status !== 'healthy' || result.locked || (options.requireOffhost && result.offhost !== 'verified')) ? 2 : 0;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
