import { createServer } from 'node:http';

const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

const json = (response, status, body, headers = {}) => {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
};

const eventResponse = (body, id = 'nowline-event-1') => ({
  id,
  etag: `"etag-${id}"`,
  status: 'confirmed',
  summary: body.summary ?? 'Nowline block',
  start: body.start,
  end: body.end,
  updated: new Date().toISOString(),
  extendedProperties: body.extendedProperties ?? { private: {} }
});

export const startFakeGoogleCalendar = async ({ quotaFailures = 0, responseDelayMs = 0 } = {}) => {
  const stats = {
    requests: 0,
    activeRequests: 0,
    maxConcurrentRequests: 0,
    quotaResponses: 0,
    eventListRequests: 0,
    tokenRequests: 0,
    watchRequests: 0,
    revokeRequests: 0,
    calls: new Map()
  };
  let remainingQuotaFailures = quotaFailures;

  const server = createServer(async (request, response) => {
    stats.requests += 1;
    stats.activeRequests += 1;
    stats.maxConcurrentRequests = Math.max(stats.maxConcurrentRequests, stats.activeRequests);
    const url = new URL(request.url ?? '/', 'http://fake-google.local');
    const callKey = `${request.method ?? 'GET'} ${url.pathname}`;
    stats.calls.set(callKey, (stats.calls.get(callKey) ?? 0) + 1);

    try {
      if (responseDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, responseDelayMs));
      }
      if (url.pathname === '/auth') {
        const redirectUri = url.searchParams.get('redirect_uri');
        const state = url.searchParams.get('state');
        if (!redirectUri || !state) return json(response, 400, { error: 'missing_redirect_or_state' });
        const callback = new URL(redirectUri);
        callback.searchParams.set('code', 'fake-google-code');
        callback.searchParams.set('state', state);
        response.writeHead(302, { Location: callback.toString(), 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
      if (url.pathname === '/token') {
        stats.tokenRequests += 1;
        const body = await readBody(request);
        const refreshing = body.includes('grant_type=refresh_token');
        return json(response, 200, {
          access_token: `fake-access-${stats.tokenRequests}`,
          refresh_token: refreshing ? undefined : 'fake-refresh-token',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly'
        });
      }
      if (url.pathname === '/revoke') {
        stats.revokeRequests += 1;
        response.writeHead(200, { 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
      if (url.pathname === '/calendar/v3/users/me/calendarList') {
        return json(response, 200, {
          items: [{
            id: 'primary',
            summary: 'Nowline E2E Calendar',
            primary: true,
            accessRole: 'owner',
            timeZone: 'Asia/Seoul'
          }]
        });
      }
      if (url.pathname === '/calendar/v3/channels/stop') {
        response.writeHead(204);
        response.end();
        return;
      }
      if (/^\/calendar\/v3\/calendars\/[^/]+\/events\/watch$/.test(url.pathname)) {
        stats.watchRequests += 1;
        return json(response, 200, {
          resourceId: `resource-${stats.watchRequests}`,
          expiration: Date.now() + 7 * 24 * 60 * 60 * 1000
        });
      }
      if (/^\/calendar\/v3\/calendars\/[^/]+\/events(?:\/[^/]+)?$/.test(url.pathname)) {
        if (request.method === 'GET') {
          stats.eventListRequests += 1;
          if (remainingQuotaFailures > 0) {
            remainingQuotaFailures -= 1;
            stats.quotaResponses += 1;
            return json(response, 429, { error: { code: 429, message: 'quota exceeded' } }, { 'Retry-After': '1' });
          }
          return json(response, 200, { items: [], nextSyncToken: `sync-${stats.eventListRequests}` });
        }
        if (request.method === 'POST' || request.method === 'PUT') {
          const raw = await readBody(request);
          const body = raw ? JSON.parse(raw) : {};
          const id = url.pathname.split('/').at(-1) === 'events'
            ? `nowline-event-${stats.requests}`
            : url.pathname.split('/').at(-1);
          return json(response, request.method === 'POST' ? 200 : 200, eventResponse(body, id));
        }
        if (request.method === 'DELETE') {
          response.writeHead(204);
          response.end();
          return;
        }
      }
      return json(response, 404, { error: 'fake_google_route_not_found', path: url.pathname });
    } catch (error) {
      return json(response, 500, { error: error instanceof Error ? error.message : String(error) });
    } finally {
      stats.activeRequests -= 1;
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fake Google Calendar did not bind a TCP port');
  const port = address.port;

  return {
    port,
    browserBaseUrl: `http://127.0.0.1:${port}`,
    containerBaseUrl: `http://host.docker.internal:${port}`,
    stats,
    setQuotaFailures(value) {
      remainingQuotaFailures = Math.max(0, Number(value) || 0);
    },
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
};
