// Real Nginx regression test: the old compressed proxy weakens ETags and breaks
// conditional writes. This isolated fixture contains no production account data.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const exec = promisify(execFile);
const docker = (...args) => exec('docker', args, { timeout: 120_000 });
const image = process.env.NOWLINE_NGINX_TEST_IMAGE || 'nginx:1.29.1-alpine3.22';
const etag = '"planner-0123456789abcdef-12"';
const body = JSON.stringify({ revision: 12, text: 'disposable fixture '.repeat(400) });
const fixture = createServer((request, response) => {
  const invalid = request.method === 'PUT' && request.headers['if-match'] !== etag;
  response.writeHead(invalid ? 400 : 200, { 'Content-Type': 'application/json', ETag: etag });
  response.end(invalid ? JSON.stringify({ code: 'invalid-precondition' }) : body);
});
const source = await readFile(new URL('../nginx.beta.conf', import.meta.url), 'utf8');
assert.match(source, /location \/api\/ \{[^}]*gzip off;/, 'Beta API must disable gzip');
await new Promise((resolve) => fixture.listen(0, '0.0.0.0', resolve));
const directory = await mkdtemp(path.join(tmpdir(), 'planner-etag-'));
const config = source
  .replaceAll(/server nowline-(?:backend|keycloak):8080;/g, `server host.docker.internal:${fixture.address().port};`)
  .replaceAll('__NOWLINE_DNS_RESOLVER__', '127.0.0.11');
async function exercise(label, configuration) {
  const name = `planner-etag-${randomUUID()}`;
  const file = path.join(directory, `${label}.conf`);
  await writeFile(file, configuration);
  try {
    await docker('run', '-d', '--name', name, '--add-host=host.docker.internal:host-gateway', '-p', '127.0.0.1::8080',
      '-v', `${file}:/etc/nginx/nginx.conf:ro`, '--entrypoint', 'nginx', image, '-g', 'daemon off;');
    const { stdout } = await docker('port', name, '8080/tcp');
    const url = `http://${stdout.trim()}/api/v1/planner`;
    let get;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { get = await fetch(url, { headers: { 'Accept-Encoding': 'gzip' }, signal: AbortSignal.timeout(2000) }); if (get.ok) break; } catch { /* startup only */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(get?.status, 200, `${label} fixture must be reachable`);
    const received = get.headers.get('etag');
    const put = await fetch(url, { method: 'PUT', headers: { 'If-Match': received }, body: '{}' });
    if (label === 'negative-control') {
      assert.equal(get.headers.get('content-encoding'), 'gzip');
      assert.equal(received, `W/${etag}`);
      assert.equal(put.status, 400);
      console.log('negative control reproduced: gzip weak ETag -> conditional PUT 400');
    } else {
      assert.equal(get.headers.get('content-encoding'), null);
      assert.match(get.headers.get('cache-control') ?? '', /(?:^|,\s*)no-transform(?:,|$)/, 'Cloudflare must not transform the API response');
      assert.match(get.headers.get('cache-control') ?? '', /(?:^|,\s*)no-store(?:,|$)/, 'Private API responses must not be cached');
      assert.equal(received, etag);
      assert.equal(put.status, 200);
      console.log('beta proxy strong ETag GET -> conditional PUT passed');
    }
  } finally { await docker('rm', '-f', name).catch(() => {}); }
}
try {
  await exercise('negative-control', config.replace(/gzip off;/, 'gzip on;'));
  await exercise('fixed', config);
} finally {
  await new Promise((resolve) => fixture.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
