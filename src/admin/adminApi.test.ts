import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccessTokenProvider } from '../auth/accessToken';
import { adminApi, AdminApiError } from './adminApi';

afterEach(() => { vi.unstubAllGlobals(); setAccessTokenProvider(async () => null); });

describe('adminApi', () => {
  it('sends the access token only in the header, makes a GET and bypasses response caches', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    setAccessTokenProvider(async () => 'signed-test-token');
    const controller = new AbortController();
    await expect(adminApi.access(controller.signal)).resolves.toEqual({ allowed: true });
    expect(fetcher).toHaveBeenCalledWith('/api/v1/admin/access', {
      method: 'GET', cache: 'no-store', signal: controller.signal,
      headers: { Accept: 'application/json', Authorization: 'Bearer signed-test-token' }
    });
  });

  it('does not expose raw server errors that could contain secrets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('PRIVATE SQL SECRET', { status: 503 })));
    const error = await adminApi.overview().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(AdminApiError);
    expect((error as Error).message).not.toContain('PRIVATE');
  });
});
