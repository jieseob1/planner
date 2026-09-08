import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiReviewPanel } from './AiReviewPanel';
import { aiReviewApi, AiReviewApiError, type AiReviewConfig, type AiReviewReport } from '../api/aiReviewApi';
import { periodRange, type PeriodRange } from '../domain/periods';

const auth = vi.hoisted(() => ({ subject: 'test:ai-a' }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('../timezone/TimeZoneProvider', () => ({ useTimeZone: () => ({ timeZone: 'Asia/Seoul' }) }));
vi.mock('../api/aiReviewApi', async original => ({ ...await original<typeof import('../api/aiReviewApi')>(), aiReviewApi: { config: vi.fn(), settings: vi.fn(), list: vi.fn(), get: vi.fn(), generate: vi.fn() } }));
const range = periodRange('week', '2026-08-31');
const config = (consent = true, configured = true): AiReviewConfig => ({ configured, provider: 'OpenAI', model: configured ? 'configured-model' : null, policyVersion: '2026-09-08', monthlyReportLimit: 20, settings: { consent, includeReflections: false, weeklyEnabled: false, monthlyEnabled: false, scheduledTime: '08:00' } });
const report = (id = 'one', status: AiReviewReport['status'] = 'READY', version = 1): AiReviewReport => ({ id, requestId: `request-${id}`, period: 'week', startDate: range.startDate, endDate: range.endDate, version, status, createdAt: '2026-09-07T00:00:00Z', completedAt: status === 'READY' ? '2026-09-07T00:01:00Z' : null, errorCode: null,
  inputSnapshot: { period: 'week', startDate: range.startDate, endDate: range.endDate, timezone: 'Asia/Seoul', capturedAt: '2026-09-07T00:00:00Z', metrics: { completedTasks: 2, plannedMinutes: 90, recordedSeconds: 3600 }, evidence: [{ id: 'task-1', kind: 'task', date: '2026-09-02', title: '문서 검토', details: { done: true } }] },
  report: status === 'READY' ? { summary: `요약 ${version}`, observations: [{ text: '기록된 작업을 마쳤습니다.', evidenceIds: ['task-1'] }], suggestions: [{ text: '다음 주도 작은 작업으로 시작해 보세요.', evidenceIds: [] }] } : null, usage: null, costUsd: null });
const view = (selectedRange = range, route = '/review') => render(<MemoryRouter initialEntries={[route]}><AiReviewPanel range={selectedRange} /></MemoryRouter>);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-08T00:00:00Z'));
  vi.clearAllMocks(); localStorage.clear(); auth.subject = 'test:ai-a';
  vi.mocked(aiReviewApi.config).mockResolvedValue(config());
  vi.mocked(aiReviewApi.list).mockResolvedValue({ reports: [] });
  vi.mocked(aiReviewApi.settings).mockImplementation(async value => value);
  vi.mocked(aiReviewApi.generate).mockResolvedValue(report('queued', 'QUEUED'));
});
afterEach(() => vi.useRealTimers());

describe('AI review consent and costs', () => {
  it('recovers a transient configuration failure through a read-only refresh', async () => {
    const user = userEvent.setup(); vi.mocked(aiReviewApi.config).mockRejectedValueOnce(new Error('일시적인 연결 오류')); view();
    expect(await screen.findByRole('alert')).toHaveTextContent('AI 설정을 불러오지 못했습니다');
    await user.click(screen.getByRole('button', { name: '상태 새로고침' }));
    expect(await screen.findByRole('button', { name: 'AI 보고서 작성' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(aiReviewApi.generate).not.toHaveBeenCalled(); expect(aiReviewApi.settings).not.toHaveBeenCalled();
  });
  it('shows a useful not-configured state and never generates from merely opening a review', async () => {
    vi.mocked(aiReviewApi.config).mockResolvedValue(config(false, false)); view();
    await screen.findByText('AI 서비스 연결 준비 중입니다.');
    expect(screen.queryByRole('button', { name: 'AI 보고서 작성' })).not.toBeInTheDocument();
    expect(aiReviewApi.generate).not.toHaveBeenCalled(); expect(aiReviewApi.settings).not.toHaveBeenCalled();
  });
  it('requires explicit saved consent, keeps reflections separate and never starts generation when enabling automation', async () => {
    const user = userEvent.setup(); vi.mocked(aiReviewApi.config).mockResolvedValue(config(false)); view();
    const generate = await screen.findByRole('button', { name: 'AI 보고서 작성' }); expect(generate).toBeDisabled();
    await user.click(screen.getByLabelText('AI 분석을 위한 외부 제공에 동의합니다 (선택)'));
    await user.click(screen.getByLabelText('매주 월요일에 지난주 보고서 자동 작성'));
    expect(generate).toBeDisabled(); expect(aiReviewApi.settings).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'AI 설정 저장' }));
    await waitFor(() => expect(generate).toBeEnabled());
    expect(aiReviewApi.settings).toHaveBeenCalledWith({ consent: true, includeReflections: false, weeklyEnabled: true, monthlyEnabled: false, scheduledTime: '08:00' }, expect.any(AbortSignal));
    expect(aiReviewApi.generate).not.toHaveBeenCalled();
    await user.click(generate);
    expect(aiReviewApi.generate).toHaveBeenCalledTimes(1);
    expect(aiReviewApi.generate).toHaveBeenCalledWith('week', range.startDate, expect.stringMatching(/^[a-f0-9-]{36}$/i), expect.any(AbortSignal));
  });
  it('revokes automation and reflection transfer with consent while retaining old versions', async () => {
    const user = userEvent.setup(); const initial = config(); initial.settings = { ...initial.settings, includeReflections: true, weeklyEnabled: true, monthlyEnabled: true };
    vi.mocked(aiReviewApi.config).mockResolvedValue(initial); vi.mocked(aiReviewApi.list).mockResolvedValue({ reports: [report()] }); view();
    await screen.findByText('요약 1');
    await user.click(screen.getByText('AI 이용 동의와 자동 작성 설정'));
    await user.click(screen.getByLabelText('AI 분석을 위한 외부 제공에 동의합니다 (선택)'));
    await user.click(screen.getByRole('button', { name: 'AI 설정 저장' }));
    await screen.findByText(/AI 이용 동의를 철회하고/);
    expect(aiReviewApi.settings).toHaveBeenCalledWith(expect.objectContaining({ consent: false, includeReflections: false, weeklyEnabled: false, monthlyEnabled: false }), expect.any(AbortSignal));
    expect(screen.getByText('요약 1')).toBeInTheDocument();
  });
  it('does not generate unfinished periods or when history failed to load', async () => {
    const first = view(periodRange('week', '2026-09-08'));
    expect(await screen.findByRole('button', { name: 'AI 보고서 작성' })).toBeDisabled();
    expect(screen.getByText(/아직 끝나지 않은 기간입니다/)).toBeInTheDocument(); first.unmount();
    vi.mocked(aiReviewApi.list).mockRejectedValueOnce(new Error('history offline')); view();
    expect(await screen.findByRole('button', { name: 'AI 보고서 작성' })).toBeDisabled();
    expect(await screen.findByRole('alert')).toHaveTextContent('지난 보고서를 불러오지 못했습니다');
  });
  it('persists an uncertain request identifier across reload and reconciles only by read, never auto-retries POST', async () => {
    const user = userEvent.setup(); vi.mocked(aiReviewApi.generate).mockRejectedValueOnce(new TypeError('Network error'));
    const first = view(); await user.click(await screen.findByRole('button', { name: 'AI 보고서 작성' }));
    await screen.findByText(/이전 요청의 접수 상태/);
    expect(screen.getByRole('button', { name: 'AI 보고서 작성' })).toBeDisabled();
    const requestId = vi.mocked(aiReviewApi.generate).mock.calls[0][2];
    first.unmount(); const second = view(); await screen.findByText(/이전 요청의 접수 상태/);
    expect(aiReviewApi.generate).toHaveBeenCalledTimes(1);
    vi.mocked(aiReviewApi.list).mockResolvedValue({ reports: [{ ...report(), requestId }] });
    await user.click(await screen.findByRole('button', { name: '상태 새로고침' }));
    await screen.findByText('요약 1');
    expect(screen.queryByText(/이전 요청의 접수 상태/)).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0); expect(aiReviewApi.generate).toHaveBeenCalledTimes(1); second.unmount();
  });
  it('blocks UNKNOWN retries and distinguishes a definite budget rejection', async () => {
    const user = userEvent.setup(); vi.mocked(aiReviewApi.list).mockResolvedValueOnce({ reports: [report('uncertain', 'UNKNOWN')] });
    const first = view(); expect(await screen.findByRole('button', { name: '새 버전 작성' })).toBeDisabled();
    expect(screen.getByText(/중복 과금 위험으로 재작성을 막았습니다/)).toBeInTheDocument(); first.unmount();
    vi.mocked(aiReviewApi.generate).mockRejectedValueOnce(new AiReviewApiError(429, 'budget-exhausted', '비용 한도에 도달했습니다.')); view();
    await user.click(await screen.findByRole('button', { name: 'AI 보고서 작성' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('비용 한도');
    expect(localStorage.length).toBe(0); expect(aiReviewApi.generate).toHaveBeenCalledTimes(1);
  });
  it('retains a generic proxy 503 as uncertain, but clears an explicit pre-enqueue not-configured rejection', async () => {
    const user = userEvent.setup();
    vi.mocked(aiReviewApi.generate).mockRejectedValueOnce(new AiReviewApiError(503, 'request-failed', 'Proxy temporarily unavailable'));
    const first = view();
    await user.click(await screen.findByRole('button', { name: 'AI 보고서 작성' }));
    await screen.findByText(/이전 요청의 접수 상태/);
    expect(screen.getByRole('button', { name: 'AI 보고서 작성' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'AI 보고서 작성' }));
    expect(aiReviewApi.generate).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(1);
    first.unmount();
    auth.subject = 'test:ai-definite-rejection';
    vi.mocked(aiReviewApi.generate).mockRejectedValueOnce(new AiReviewApiError(503, 'ai-not-configured', 'AI service is not configured'));
    view();
    await user.click(await screen.findByRole('button', { name: 'AI 보고서 작성' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('AI service is not configured');
    expect(screen.queryByText(/이전 요청의 접수 상태/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI 보고서 작성' })).toBeEnabled();
    // The old account's unresolved identifier must remain; only the definite rejection is removed.
    expect(localStorage.length).toBe(1);
    expect(localStorage.key(0)).toContain(encodeURIComponent('test:ai-a'));
    expect(aiReviewApi.generate).toHaveBeenCalledTimes(2);
  });
});

describe('AI report versions and request isolation', () => {
  it('retains versions with immutable evidence, escapes hostile text and links only to known evidence', async () => {
    const user = userEvent.setup(); const malicious = report('new', 'READY', 2);
    malicious.report!.summary = '<img src=x onerror=alert(1)>';
    malicious.report!.suggestions = [{ text: '<script>not executable</script>', evidenceIds: ['missing'] }];
    vi.mocked(aiReviewApi.list).mockResolvedValue({ reports: [malicious, report('old')] });
    const result = view(); await screen.findByText('<img src=x onerror=alert(1)>');
    expect(result.container.querySelector('img, script')).toBeNull();
    expect(screen.getByText('확인되지 않은 근거')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'task-1' }));
    expect(screen.getByText('문서 검토')).toBeVisible();
    await user.selectOptions(screen.getByLabelText('저장된 버전'), 'old');
    expect(screen.getByText('요약 1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '이 버전 링크' })).toHaveAttribute('href', '/review?period=week&date=2026-08-31&aiReport=old#ai-review');
    expect(aiReviewApi.generate).not.toHaveBeenCalled();
  });
  it('fetches a linked old version but refuses a link to a different period', async () => {
    vi.mocked(aiReviewApi.get).mockResolvedValueOnce(report('linked'));
    const first = view(range, '/review?aiReport=linked'); await screen.findByText('요약 1');
    expect(aiReviewApi.get).toHaveBeenCalledWith('linked', expect.any(AbortSignal)); first.unmount();
    vi.mocked(aiReviewApi.get).mockResolvedValueOnce({ ...report('wrong'), startDate: '2026-08-24' });
    view(range, '/review?aiReport=wrong');
    expect(await screen.findByRole('alert')).toHaveTextContent('선택한 기간과 일치하지 않습니다');
    expect(screen.queryByText('요약 1')).not.toBeInTheDocument();
  });
  it('aborts old-account requests and does not render late responses after switching account/range', async () => {
    let resolve!: (value: { reports: AiReviewReport[] }) => void;
    vi.mocked(aiReviewApi.list).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const instance = view(); const previousSignal = vi.mocked(aiReviewApi.list).mock.calls[0][2]!;
    auth.subject = 'test:ai-b';
    const otherRange: PeriodRange = periodRange('month', '2026-08-01');
    instance.rerender(<MemoryRouter><AiReviewPanel range={otherRange} /></MemoryRouter>);
    expect(previousSignal.aborted).toBe(true);
    await act(async () => resolve({ reports: [report()] }));
    await screen.findByRole('heading', { name: '월간 AI 보고서' });
    expect(screen.queryByText('요약 1')).not.toBeInTheDocument();
    expect(aiReviewApi.generate).not.toHaveBeenCalled();
  });
  it('polls only reads, stops after 24 polls and cancels all scheduled polling on unmount', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-08T00:00:00Z'));
    vi.mocked(aiReviewApi.list).mockResolvedValue({ reports: [report('queued', 'QUEUED')] });
    const instance = view();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(125_000); });
    expect(aiReviewApi.list).toHaveBeenCalledTimes(25);
    expect(screen.getByText(/자동 상태 확인을 멈췄습니다/)).toBeInTheDocument();
    expect(aiReviewApi.generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '상태 새로고침' }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const before = vi.mocked(aiReviewApi.list).mock.calls.length; instance.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(aiReviewApi.list).toHaveBeenCalledTimes(before);
  });
  it('does not mount or call AI endpoints for daily reflection', () => {
    view(periodRange('day', '2026-09-07'));
    expect(screen.queryByRole('region', { name: 'AI 기간 보고서' })).not.toBeInTheDocument();
    expect(aiReviewApi.config).not.toHaveBeenCalled();
  });
});
