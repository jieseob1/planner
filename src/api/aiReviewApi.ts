import { getAccessToken } from '../auth/accessToken';

export type AiReviewPeriod = 'week' | 'month';
export interface AiReviewSettings {
  consent: boolean;
  includeReflections: boolean;
  weeklyEnabled: boolean;
  monthlyEnabled: boolean;
  scheduledTime: string;
}
export interface AiReviewConfig {
  configured: boolean;
  provider: string;
  model: string | null;
  policyVersion: string;
  settings: AiReviewSettings;
  monthlyReportLimit: number;
}
export interface AiReviewEvidence { id: string; kind: string; date: string | null; title: string; details: Record<string, unknown> }
export interface AiReviewReport {
  id: string;
  requestId?: string;
  period: AiReviewPeriod;
  startDate: string;
  endDate: string;
  version: number;
  status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'UNKNOWN' | 'CANCELLED';
  createdAt: string;
  completedAt: string | null;
  errorCode: string | null;
  inputSnapshot: {
    period: AiReviewPeriod; startDate: string; endDate: string; timezone: string; capturedAt: string;
    metrics: { completedTasks: number; plannedMinutes: number; recordedSeconds: number };
    evidence: AiReviewEvidence[];
  };
  report: { summary: string; observations: { text: string; evidenceIds: string[] }[]; suggestions: { text: string; evidenceIds: string[] }[] } | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  costUsd: string | null;
}
export class AiReviewApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = 'AiReviewApiError'; }
}
const base = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
const messages: Record<number, string> = {
  401: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
  403: 'AI 이용 동의와 계정 권한을 확인해 주세요.',
  422: '분석할 기록이 없거나 요청 범위를 처리할 수 없습니다.',
  429: '이번 달 AI 보고서 한도 또는 비용 한도에 도달했습니다.',
  503: 'AI 보고서 서비스가 아직 설정되지 않았거나 일시적으로 사용할 수 없습니다.'
};
async function request<T>(path: string, method: 'GET' | 'PUT' | 'POST' = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), 20_000);
  try {
    signal?.throwIfAborted();
    const token = await getAccessToken();
    controller.signal.throwIfAborted();
    if (!token) throw new AiReviewApiError(401, 'unauthenticated', messages[401]);
    const response = await fetch(`${base}/api/v1/ai-reviews${path}`, {
      method, cache: 'no-store', signal: controller.signal,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => null) as { code?: unknown; message?: unknown } | null;
      throw new AiReviewApiError(response.status, typeof problem?.code === 'string' ? problem.code.slice(0, 100) : 'request-failed',
        typeof problem?.message === 'string' ? problem.message.slice(0, 500) : messages[response.status] ?? '보고서 요청을 처리하지 못했습니다. 새로 생성하기 전에 상태를 확인해 주세요.');
    }
    return await response.json() as T;
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}

export const aiReviewApi = {
  config: (signal?: AbortSignal) => request<AiReviewConfig>('/config', 'GET', undefined, signal),
  settings: (settings: AiReviewSettings, signal?: AbortSignal) => request<AiReviewSettings>('/settings', 'PUT', settings, signal),
  list: (period: AiReviewPeriod, startDate: string, signal?: AbortSignal) => request<{ reports: AiReviewReport[] }>(`/reports?${new URLSearchParams({ period, startDate })}`, 'GET', undefined, signal),
  get: (id: string, signal?: AbortSignal) => request<AiReviewReport>(`/reports/${encodeURIComponent(id)}`, 'GET', undefined, signal),
  generate: (period: AiReviewPeriod, startDate: string, requestId: string, signal?: AbortSignal) => request<AiReviewReport>('/reports', 'POST', { period, startDate, requestId }, signal)
};
