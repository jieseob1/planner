import { getAccessToken } from '../auth/accessToken';

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');

export class AccountApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'AccountApiError';
  }
}

export interface AccountPreferences {
  timezone: string;
  locale: string;
  dailyReminderEnabled: boolean;
  dailyReminderTime: string;
  blockReminderMinutes: number;
}

export interface NotificationConfiguration {
  webConfigured: boolean;
  nativeConfigured: boolean;
  webPublicKey: string | null;
}

export interface AccountEntitlement {
  plan: 'BETA' | 'PRO';
  status: 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';
  paid: boolean;
  provider: string | null;
  currentPeriodEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  features: string[];
  updatedAt: string;
}

const authorizedFetch = async (path: string, init?: RequestInit) => {
  const token = await getAccessToken();
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers
    }
  });
};

const responseError = async (response: Response, fallback: string) => {
  let message = fallback;
  try {
    const body = await response.json() as { detail?: string };
    if (body.detail) message = body.detail;
  } catch {
    // Keep the operation-specific fallback for empty upstream responses.
  }
  return new AccountApiError(`${message} (${response.status})`, response.status);
};

const json = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await authorizedFetch(path, init);
  if (!response.ok) {
    throw await responseError(response, '요청에 실패했습니다.');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
};

export const accountApi = {
  entitlement: () => json<AccountEntitlement>('/api/v1/account/entitlement'),
  preferences: () => json<AccountPreferences>('/api/v1/account/preferences'),
  savePreferences: (value: AccountPreferences) => json<AccountPreferences>('/api/v1/account/preferences', {
    method: 'PUT', body: JSON.stringify(value)
  }),
  async downloadExport() {
    const response = await authorizedFetch('/api/v1/account/export');
    if (!response.ok) throw await responseError(response, '계정 데이터를 내보내지 못했습니다.');
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `goals-to-today-export-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  },
  deleteAccount: () => json<void>('/api/v1/account', {
    method: 'DELETE', body: JSON.stringify({ confirmation: 'DELETE' })
  }),
  notificationConfiguration: () => json<NotificationConfiguration>('/api/v1/notifications/configuration'),
  registerDevice: (deviceId: string, subscription: PushSubscriptionJSON) => json<void>('/api/v1/notifications/devices', {
    method: 'POST',
    body: JSON.stringify({
      deviceId,
      platform: 'WEB',
      subscription,
      label: `${navigator.platform || 'Web'} · ${navigator.userAgent.slice(0, 60)}`
    })
  }),
  registerNativeDevice: (deviceId: string, platform: 'IOS' | 'ANDROID', token: string) => json<void>('/api/v1/notifications/devices', {
    method: 'POST',
    body: JSON.stringify({
      deviceId,
      platform,
      subscription: { token },
      label: `${platform} · ${navigator.userAgent.slice(0, 60)}`
    })
  }),
  disableDevice: (deviceId: string) => json<void>(`/api/v1/notifications/devices/${deviceId}`, { method: 'DELETE' })
};
