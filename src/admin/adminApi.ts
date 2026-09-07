import { getAccessToken } from '../auth/accessToken';

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');

export class AdminApiError extends Error {
  constructor(readonly status: number) {
    super(status === 401 ? '로그인이 만료되었습니다. 다시 로그인해 주세요.'
      : status === 403 ? '관리자 권한이 필요한 화면입니다.'
        : '운영 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    this.name = 'AdminApiError';
  }
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(`${baseUrl}/api/v1/admin${path}`, {
    method: 'GET', cache: 'no-store', signal,
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  });
  if (!response.ok) throw new AdminApiError(response.status);
  return response.json() as Promise<T>;
}

export interface AdminOverview {
  observedAt: string; accounts: number; recentAccounts: number; activePlans: number;
  calendarConnections: number; syncFailures: number; queuedJobs: number; runningJobs: number;
  deadJobs: number; retryingJobs: number; failedNotifications: number; recentAuditEvents: number;
}
export interface AdminPage<T> { items: T[]; page: number; size: number; hasNext: boolean; limited: boolean }
export interface AdminAccount {
  userId: string; maskedEmail: string | null; createdAt: string; lastSeenAt: string;
  deletionRequested: boolean; planCode: string | null; entitlementStatus: string | null; syncStatus: string | null;
}
export interface AdminSyncFailure {
  userId: string; status: string; errorCode: string | null; lastCompletedAt: string | null; updatedAt: string;
}
export interface AdminJobFailure {
  jobId: string; userId: string | null; type: string; status: string; attempts: number; availableAt: string; updatedAt: string;
}
export interface AdminAuditEvent { eventId: string; userId: string; action: string; revision: number | null; occurredAt: string }
export type AdminListKind = 'users' | 'sync-failures' | 'job-failures' | 'audit';
export type AdminRow = AdminAccount | AdminSyncFailure | AdminJobFailure | AdminAuditEvent;

export const adminApi = {
  access: (signal?: AbortSignal) => request<{ allowed: boolean }>('/access', signal),
  overview: (signal?: AbortSignal) => request<AdminOverview>('/overview', signal),
  list: (kind: AdminListKind, page: number, signal?: AbortSignal) =>
    request<AdminPage<AdminRow>>(`/${kind}?page=${page}&size=20`, signal)
};
