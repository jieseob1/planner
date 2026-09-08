import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiReviewApi, AiReviewApiError } from './aiReviewApi';
import { getAccessToken } from '../auth/accessToken';

vi.mock('../auth/accessToken', () => ({ getAccessToken: vi.fn() }));
const fetchMock = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); vi.mocked(getAccessToken).mockResolvedValue('account-token'); });
afterEach(() => vi.unstubAllGlobals());
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('AI review client', () => {
  it('reads configuration/history with an authenticated non-cached GET and no provider body', async () => {
    fetchMock.mockResolvedValue(json({ reports: [] }));
    await aiReviewApi.list('week', '2026-08-31');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/ai-reviews/reports?period=week&startDate=2026-08-31', expect.objectContaining({ method: 'GET', cache: 'no-store', headers: { Accept: 'application/json', Authorization: 'Bearer account-token' } }));
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });
  it('sends only explicit generation parameters and retains the supplied request identifier', async () => {
    fetchMock.mockResolvedValue(json({ id: 'report-1' }, 202));
    const id = '6f501b70-bd30-4901-ae48-e7fa857026b4';
    await aiReviewApi.generate('month', '2026-08-01', id);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/ai-reviews/reports', expect.objectContaining({ method: 'POST', body: JSON.stringify({ period: 'month', startDate: '2026-08-01', requestId: id }) }));
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('saves consent/reflections/automation separately without embedding task or reflection text', async () => {
    const settings = { consent: true, includeReflections: false, weeklyEnabled: true, monthlyEnabled: false, scheduledTime: '08:00' };
    fetchMock.mockResolvedValue(json(settings));
    await expect(aiReviewApi.settings(settings)).resolves.toEqual(settings);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: JSON.stringify(settings) });
  });
  it('preserves structured error codes and supplies a usable message when a proxy returns HTML', async () => {
    fetchMock.mockResolvedValueOnce(json({ code: 'ai-not-configured', message: '운영 설정 필요' }, 503));
    await expect(aiReviewApi.config()).rejects.toMatchObject({ status: 503, code: 'ai-not-configured', message: '운영 설정 필요' });
    fetchMock.mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
    await expect(aiReviewApi.config()).rejects.toThrow('이번 달 AI 보고서 한도');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('never sends a request without auth or after the caller aborts while token retrieval is pending', async () => {
    vi.mocked(getAccessToken).mockResolvedValueOnce(null);
    await expect(aiReviewApi.config()).rejects.toBeInstanceOf(AiReviewApiError);
    let resolve!: (value: string) => void;
    vi.mocked(getAccessToken).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const controller = new AbortController();
    const pending = aiReviewApi.config(controller.signal);
    controller.abort(); resolve('old-account-token');
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
