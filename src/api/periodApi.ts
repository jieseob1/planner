import { getAccessToken } from '../auth/accessToken';
import { PlannerApiError } from './plannerApi';
import type { PeriodDocument, PeriodWrite } from '../domain/periods';
import type { PlannerSnapshot } from '../domain/types';

const base = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
async function request<T>(path: string, write?: PeriodWrite, signal?: AbortSignal): Promise<T> {
  const token = await getAccessToken();
  signal?.throwIfAborted();
  const response = await fetch(`${base}/api/v1/period-documents${path}`, {
    method: write ? 'PUT' : 'GET', cache: 'no-store', signal,
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(write ? { 'Content-Type': 'application/json' } : {}) },
    ...(write ? { body: JSON.stringify(write) } : {})
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw new PlannerApiError(response.status, response.status === 412
      ? '다른 탭이나 기기에서 먼저 수정했습니다. 입력은 유지됩니다. 최신 내용과 비교해 주세요.'
      : response.status === 401 ? '로그인이 만료되었습니다. 입력을 보관한 뒤 다시 로그인해 주세요.'
        : typeof problem?.detail === 'string' ? problem.detail.slice(0, 500) : '저장하지 못했습니다. 입력을 유지하고 다시 시도해 주세요.');
  }
  return response.json() as Promise<T>;
}
export const periodApi = {
  list: (signal?: AbortSignal) => request<PeriodDocument[]>('', undefined, signal),
  save: (write: PeriodWrite, signal?: AbortSignal) => request<PeriodDocument>('', write, signal),
  history: (signal?: AbortSignal) => request<PlannerSnapshot[]>('/execution-history', undefined, signal)
};
