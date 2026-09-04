import { getAccessToken } from '../auth/accessToken';
import type { PlanAuditEvent, PlanDetail, PlanSummary, PlannerSnapshot, ProblemDetails } from '../domain/types';
import { PlannerApiError } from './plannerApi';

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
const plansUrl = `${baseUrl}/api/v1/plans`;

const headers = async (json = false) => {
  const accessToken = await getAccessToken();
  return {
    Accept: 'application/json',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
  };
};

const read = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    let problem: ProblemDetails | null = null;
    try { problem = await response.json() as ProblemDetails; } catch { /* no body */ }
    throw new PlannerApiError(
      response.status,
      problem?.detail ?? problem?.title ?? `계획 요청 실패 (${response.status})`,
      problem
    );
  }
  return response.json() as Promise<T>;
};

export const planHistoryApi = {
  async list(): Promise<PlanSummary[]> {
    const response = await fetch(plansUrl, { headers: await headers(), cache: 'no-store' });
    return (await read<{ plans: PlanSummary[] }>(response)).plans;
  },
  async get(planId: string): Promise<PlanDetail> {
    return read(await fetch(`${plansUrl}/${planId}`, { headers: await headers(), cache: 'no-store' }));
  },
  async create(planId: string, title: string, snapshot: PlannerSnapshot): Promise<PlanDetail> {
    return read(await fetch(`${plansUrl}/${planId}`, {
      method: 'PUT',
      headers: await headers(true),
      body: JSON.stringify({ title, snapshot })
    }));
  },
  async action(planId: string, action: 'activate' | 'close' | 'archive' | 'restore'): Promise<PlanDetail | PlanSummary> {
    return read(await fetch(`${plansUrl}/${planId}/${action}`, {
      method: 'POST',
      headers: await headers(true)
    }));
  },
  async audit(planId: string): Promise<PlanAuditEvent[]> {
    return read(await fetch(`${plansUrl}/${planId}/audit`, { headers: await headers(), cache: 'no-store' }));
  }
};
