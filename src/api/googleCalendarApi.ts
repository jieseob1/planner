import { getAccessToken } from '../auth/accessToken';

const API_PATH = '/api/v1/integrations/google-calendar';
const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');

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
    let message = `Google Calendar 요청에 실패했습니다. (${response.status})`;
    try {
      const body = await response.json() as { detail?: string };
      if (body.detail) message = body.detail;
    } catch {
      // Preserve the status-based fallback for empty upstream responses.
    }
    throw new Error(message);
  }
  if (response.status === 204 || response.headers.get('Content-Length') === '0') return undefined as T;
  return response.json() as Promise<T>;
};

export const googleCalendarApi = {
  status: () => request<GoogleCalendarStatus>('/status'),
  connect: (returnPath = '/settings') => request<{ authorizationUrl: string }>('/connect', {
    method: 'POST',
    body: JSON.stringify({ returnPath })
  }),
  calendars: () => request<GoogleCalendarInfo[]>('/calendars'),
  settings: (calendarId: string, direction: CalendarDirection) => request<GoogleCalendarStatus>('/settings', {
    method: 'PUT',
    body: JSON.stringify({ calendarId, direction })
  }),
  sync: () => request<void>('/sync', { method: 'POST' }),
  disconnect: () => request<void>('', { method: 'DELETE' })
};
