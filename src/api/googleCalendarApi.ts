import { getAccessToken } from '../auth/accessToken';

const API_PATH = '/api/v1/integrations/google-calendar';
const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');

export class GoogleCalendarApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'GoogleCalendarApiError';
  }
}

export type CalendarDirection = 'IMPORT_ONLY' | 'EXPORT_ONLY' | 'BIDIRECTIONAL';

export interface GoogleCalendarStatus {
  configured: boolean;
  connected: boolean;
  accountEmail: string | null;
  calendarId: string | null;
  direction: CalendarDirection;
  syncStatus: 'DISCONNECTED' | 'PENDING' | 'SYNCING' | 'READY' | 'REAUTHORIZE' | 'ERROR';
  lastSyncStartedAt: string | null;
  lastSyncCompletedAt: string | null;
  lastErrorCode: string | null;
}

export interface GoogleCalendarInfo {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  timeZone: string;
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const token = await getAccessToken();
  const response = await fetch(`${baseUrl}${API_PATH}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers
    }
  });
  if (!response.ok) {
    let message = 'Google Calendar 요청에 실패했습니다.';
    try {
      const body = await response.json() as { detail?: string };
      if (body.detail) message = body.detail;
    } catch {
      // Preserve the status-based fallback for empty upstream responses.
    }
    throw new GoogleCalendarApiError(`${message} (${response.status})`, response.status);
  }
  if (response.status === 204) return undefined as T;
  const body = await response.text();
  if (!body.trim()) return undefined as T;
  return JSON.parse(body) as T;
};

export const googleCalendarApi = {
  status: (signal?: AbortSignal) => request<GoogleCalendarStatus>('/status', { signal }),
  connect: (returnPath = '/settings') => request<{ authorizationUrl: string }>('/connect', {
    method: 'POST',
    body: JSON.stringify({ returnPath })
  }),
  calendars: (signal?: AbortSignal) => request<GoogleCalendarInfo[]>('/calendars', { signal }),
  settings: (calendarId: string, direction: CalendarDirection) => request<GoogleCalendarStatus>('/settings', {
    method: 'PUT',
    body: JSON.stringify({ calendarId, direction })
  }),
  sync: () => request<void>('/sync', { method: 'POST' }),
  disconnect: () => request<void>('', { method: 'DELETE' })
};
