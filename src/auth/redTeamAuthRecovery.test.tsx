import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const pushMocks = vi.hoisted(() => ({
  unregister: vi.fn(async () => undefined)
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => 'web'
  }
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    unregister: pushMocks.unregister
  }
}));

import { accountApi, AccountApiError } from '../api/accountApi';
import { googleCalendarApi, GoogleCalendarApiError } from '../api/googleCalendarApi';
import { setAccessTokenProvider } from './accessToken';
import { AuthProvider, freshOidcSigninRequest, useAuth } from './AuthProvider';
import {
  cleanupNotificationRegistration,
  getOrCreateNotificationDeviceId,
  LEGACY_NOTIFICATION_DEVICE_KEY,
  notificationDeviceStorageKey,
  storedNotificationDeviceId
} from './notificationRegistration';

const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

const jwt = (subject: string) => {
  const payload = window.btoa(JSON.stringify({ sub: subject }))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `header.${payload}.signature`;
};

const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

function AuthProbe() {
  const { subject, reauthenticate, logout } = useAuth();
  return (
    <div>
      <span>{subject}</span>
      <button type="button" onClick={() => void reauthenticate()}>인증 갱신</button>
      <button type="button" onClick={() => void logout()}>로그아웃</button>
    </div>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  setAccessTokenProvider(async () => null);
  pushMocks.unregister.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (originalServiceWorker) {
    Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
  } else {
    Reflect.deleteProperty(navigator, 'serviceWorker');
  }
});

describe('red-team authentication recovery', () => {
  it('keeps an HTTP status when a problem detail replaces the fallback message', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse(401, { detail: '최근 로그인이 필요합니다.' }))
      .mockResolvedValueOnce(jsonResponse(403, { detail: '캘린더 접근 권한이 없습니다.' })));

    const accountFailure = await accountApi.preferences().catch((reason) => reason);
    const calendarFailure = await googleCalendarApi.status().catch((reason) => reason);

    expect(accountFailure).toBeInstanceOf(AccountApiError);
    expect(accountFailure).toMatchObject({ status: 401, message: '최근 로그인이 필요합니다. (401)' });
    expect(calendarFailure).toBeInstanceOf(GoogleCalendarApiError);
    expect(calendarFailure).toMatchObject({ status: 403, message: '캘린더 접근 권한이 없습니다. (403)' });
  });

  it('accepts an empty 202 Calendar sync response without relying on Content-Length', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(googleCalendarApi.sync()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/integrations/google-calendar/sync',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('forces a fresh local token and installs it as the current subject', async () => {
    const freshToken = jwt('fresh-local-user');
    window.sessionStorage.setItem('nowline.local-access-token', jwt('stale-local-user'));
    window.sessionStorage.setItem('nowline.local-access-token-expiry', String(Date.now() + 3_600_000));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/dev-token')) {
        return jsonResponse(200, { accessToken: freshToken, expiresIn: 3_600 });
      }
      if (url.endsWith('/api/v1/account/consent')) return jsonResponse(200, { accepted: true });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<MemoryRouter><AuthProvider><AuthProbe /></AuthProvider></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: '인증 갱신' }));

    await waitFor(() => expect(screen.getByText('local:fresh-local-user')).toBeInTheDocument());
    expect(window.sessionStorage.getItem('nowline.local-access-token')).toBe(freshToken);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('requests an interactive OIDC login instead of accepting a cached session', () => {
    expect(freshOidcSigninRequest('/settings')).toEqual({
      state: { returnTo: '/settings', interaction: 'reauthenticate' },
      max_age: 0,
      prompt: 'login'
    });
  });

  it('uses the valid token for device cleanup and still completes local logout when cleanup is offline', async () => {
    const accessToken = jwt('logout-user');
    const events: string[] = [];
    let disableAuthorization = '';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/dev-token')) {
        return jsonResponse(200, { accessToken, expiresIn: 3_600 });
      }
      if (url.endsWith('/api/v1/account/consent')) return jsonResponse(200, { accepted: true });
      if (url.includes('/api/v1/notifications/devices/')) {
        events.push('remote');
        disableAuthorization = new Headers(init?.headers).get('Authorization') ?? '';
        throw new TypeError('offline');
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const unsubscribe = vi.fn(async () => {
      events.push('local');
      return true;
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: vi.fn(async () => ({
          pushManager: { getSubscription: vi.fn(async () => ({ unsubscribe })) }
        }))
      }
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const user = userEvent.setup();
    render(<MemoryRouter><AuthProvider><AuthProbe /></AuthProvider></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: '인증 갱신' }));
    await waitFor(() => expect(screen.getByText('local:logout-user')).toBeInTheDocument());
    window.localStorage.setItem(
      notificationDeviceStorageKey('local:logout-user'),
      '33333333-3333-4333-8333-333333333333'
    );

    await user.click(screen.getByRole('button', { name: '로그아웃' }));

    expect(await screen.findByRole('button', { name: /기존 계정으로 로그인/ })).toBeInTheDocument();
    expect(events).toEqual(['remote', 'local']);
    expect(disableAuthorization).toBe(`Bearer ${accessToken}`);
    expect(window.sessionStorage.getItem('nowline.local-access-token')).toBeNull();
    expect(window.localStorage.getItem(notificationDeviceStorageKey('local:logout-user'))).toBeNull();
  });

  it('isolates two OIDC device identifiers and never adopts an ambiguous legacy key', () => {
    window.localStorage.setItem(LEGACY_NOTIFICATION_DEVICE_KEY, 'legacy-device');

    const first = getOrCreateNotificationDeviceId('oidc:https://issuer.example:user-a');
    const second = getOrCreateNotificationDeviceId('oidc:https://issuer.example:user-b');

    expect(first).not.toBe('legacy-device');
    expect(second).not.toBe('legacy-device');
    expect(first).not.toBe(second);
    expect(window.localStorage.getItem(notificationDeviceStorageKey('oidc:https://issuer.example:user-a'))).toBe(first);
    expect(window.localStorage.getItem(notificationDeviceStorageKey('oidc:https://issuer.example:user-b'))).toBe(second);
    expect(window.localStorage.getItem(LEGACY_NOTIFICATION_DEVICE_KEY)).toBe('legacy-device');
  });

  it('allows only local/test runtime subjects to migrate the legacy device identifier', () => {
    window.localStorage.setItem(LEGACY_NOTIFICATION_DEVICE_KEY, 'local-device');

    expect(storedNotificationDeviceId('local:development-user')).toBe('local-device');
    expect(window.localStorage.getItem(notificationDeviceStorageKey('local:development-user'))).toBe('local-device');
    expect(window.localStorage.getItem(LEGACY_NOTIFICATION_DEVICE_KEY)).toBeNull();
  });

  it('disables the authenticated backend device before revoking its local endpoint', async () => {
    const events: string[] = [];
    const subject = 'oidc:https://issuer.example:user-a';
    window.localStorage.setItem(notificationDeviceStorageKey(subject), '11111111-1111-4111-8111-111111111111');
    const unsubscribe = vi.fn(async () => {
      events.push('local');
      return true;
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: vi.fn(async () => ({
          pushManager: { getSubscription: vi.fn(async () => ({ unsubscribe })) }
        }))
      }
    });
    vi.stubGlobal('fetch', vi.fn(async () => {
      events.push('remote');
      return new Response(null, { status: 204 });
    }));

    const result = await cleanupNotificationRegistration(subject);

    expect(events).toEqual(['remote', 'local']);
    expect(result).toMatchObject({ remote: 'disabled', local: 'revoked', errors: [] });
    expect(window.localStorage.getItem(notificationDeviceStorageKey(subject))).toBeNull();
  });

  it('still revokes the local endpoint and clears ownership when backend cleanup is offline', async () => {
    const subject = 'oidc:https://issuer.example:user-a';
    window.localStorage.setItem(notificationDeviceStorageKey(subject), '22222222-2222-4222-8222-222222222222');
    const unsubscribe = vi.fn(async () => true);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: vi.fn(async () => ({
          pushManager: { getSubscription: vi.fn(async () => ({ unsubscribe })) }
        }))
      }
    });
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('offline');
    }));

    const result = await cleanupNotificationRegistration(subject);

    expect(result.remote).toBe('failed');
    expect(result.local).toBe('revoked');
    expect(result.errors[0]).toContain('offline');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(notificationDeviceStorageKey(subject))).toBeNull();
  });

  it('bounds an unresponsive backend so logout cleanup cannot wait forever', async () => {
    const subject = 'oidc:https://issuer.example:user-a';
    window.localStorage.setItem(notificationDeviceStorageKey(subject), '44444444-4444-4444-8444-444444444444');
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: vi.fn(async () => undefined) }
    });
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    vi.useFakeTimers();

    const cleanup = cleanupNotificationRegistration(subject, { timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(26);
    const result = await cleanup;

    expect(result.remote).toBe('failed');
    expect(result.local).toBe('not-registered');
    expect(result.errors[0]).toContain('시간 초과');
    expect(window.localStorage.getItem(notificationDeviceStorageKey(subject))).toBeNull();
  });
});
