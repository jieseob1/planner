import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoSnapshot } from '../data/demo';
import css from '../styles.css?raw';

const mocks = vi.hoisted(() => ({
  planner: {} as Record<string, unknown>,
  login: vi.fn(async () => undefined),
  reauthenticate: vi.fn(async () => undefined),
  logout: vi.fn(async () => undefined),
  entitlement: vi.fn(),
  preferences: vi.fn(),
  savePreferences: vi.fn(),
  setAccountTimeZone: vi.fn(),
  notificationConfiguration: vi.fn(),
  registerDevice: vi.fn(),
  disableDevice: vi.fn(),
  deleteAccount: vi.fn(),
  status: vi.fn(),
  calendars: vi.fn()
}));

vi.mock('../state/PlannerProvider', () => ({
  usePlanner: () => mocks.planner,
  getPlannerStorageKeys: (subject: string) => {
    const suffix = encodeURIComponent(subject);
    return {
      snapshot: `planner.mvp.snapshot.v1:${suffix}`,
      syncMetadata: `planner.mvp.sync.v1:${suffix}`,
      conflictBackup: `planner.mvp.last-conflict.v1:${suffix}`,
      activePlanAbsent: `nowline.active-plan.absent.v1:${suffix}`
    };
  }
}));

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    login: mocks.login,
    reauthenticate: mocks.reauthenticate,
    logout: mocks.logout,
    subject: 'oidc:https://issuer.example:user-a'
  })
}));

vi.mock('../api/accountApi', () => ({
  accountApi: {
    entitlement: mocks.entitlement,
    preferences: mocks.preferences,
    notificationConfiguration: mocks.notificationConfiguration,
    savePreferences: mocks.savePreferences,
    registerDevice: mocks.registerDevice,
    registerNativeDevice: vi.fn(),
    disableDevice: mocks.disableDevice,
    downloadExport: vi.fn(),
    deleteAccount: mocks.deleteAccount
  }
}));

vi.mock('../timezone/TimeZoneProvider', () => ({
  useTimeZone: () => ({
    timeZone: 'Asia/Seoul',
    source: 'account',
    loading: false,
    error: null,
    refreshTimeZone: vi.fn(),
    setAccountTimeZone: mocks.setAccountTimeZone
  })
}));

vi.mock('../api/googleCalendarApi', () => ({
  googleCalendarApi: {
    status: mocks.status,
    calendars: mocks.calendars,
    connect: vi.fn(),
    settings: vi.fn(),
    sync: vi.fn(),
    disconnect: vi.fn()
  }
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'web',
    isNativePlatform: () => false
  }
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: vi.fn(),
    removeAllListeners: vi.fn(),
    requestPermissions: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn()
  }
}));

import { AccountSettingsSections } from './AccountSettingsSections';
import { AppShell } from './AppShell';
import { Modal } from './Modal';
import { GoalsScreen } from '../screens/GoalsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

const preferences = {
  timezone: 'Asia/Seoul',
  locale: 'ko-KR',
  dailyReminderEnabled: true,
  dailyReminderTime: '09:00:00',
  blockReminderMinutes: 10
};

const entitlement = {
  plan: 'BETA',
  status: 'ACTIVE',
  paid: false,
  provider: null,
  currentPeriodEndsAt: null,
  cancelAtPeriodEnd: false,
  features: [],
  updatedAt: '2026-09-02T00:00:00Z'
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  const snapshot = createDemoSnapshot();
  mocks.planner = {
    ...snapshot,
    hasActivePlan: true,
    isOnline: true,
    resetPlanner: vi.fn(async () => true),
    retrySync: vi.fn(),
    saveStatus: 'saved',
    syncConflict: null,
    setOutcomeDecision: vi.fn(),
    savePlan: vi.fn()
  };
  mocks.entitlement.mockResolvedValue(entitlement);
  mocks.preferences.mockResolvedValue(preferences);
  mocks.savePreferences.mockImplementation(async (value) => value);
  mocks.notificationConfiguration.mockResolvedValue({
    webConfigured: false,
    nativeConfigured: false,
    webPublicKey: null
  });
  mocks.status.mockResolvedValue({
    configured: false,
    connected: false,
    accountEmail: null,
    calendarId: null,
    direction: 'BIDIRECTIONAL',
    syncStatus: 'DISCONNECTED',
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastErrorCode: null
  });
  mocks.calendars.mockResolvedValue([]);
  mocks.deleteAccount.mockResolvedValue(undefined);
  mocks.registerDevice.mockResolvedValue(undefined);
  mocks.disableDevice.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalServiceWorker) {
    Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
  } else {
    Reflect.deleteProperty(navigator, 'serviceWorker');
  }
});

describe('red-team interface recovery', () => {
  it('portals a contextual modal outside its transformed rendering parent', () => {
    render(
      <div data-testid="top-bar-actions">
        <Modal eyebrow="동기화 충돌" title="변경 비교" onClose={() => undefined}>
          <button type="button" onClick={() => undefined}>병합</button>
        </Modal>
      </div>
    );

    const dialog = screen.getByRole('dialog', { name: '변경 비교' });
    expect(screen.getByText('동기화 충돌')).toBeInTheDocument();
    expect(dialog.closest('.modal-backdrop')?.parentElement).toBe(document.body);
    expect(screen.getByTestId('top-bar-actions')).toBeEmptyDOMElement();
  });

  it('uses Korean navigation names and exposes one current planning step', () => {
    render(
      <MemoryRouter initialEntries={['/goals']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="goals" element={<div>목표 화면</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    const mainNavigation = screen.getByRole('navigation', { name: '주 메뉴' });
    expect(within(mainNavigation).getByRole('link', { name: '목표 · 목표와 지표' })).toHaveAttribute('aria-current', 'page');
    expect(within(mainNavigation).queryByRole('link', { name: 'Goals' })).not.toBeInTheDocument();

    const journey = screen.getByRole('navigation', { name: '연간 목표에서 주간 회고까지의 계획 흐름' });
    const currentSteps = within(journey).getAllByRole('link').filter((link) => link.hasAttribute('aria-current'));
    expect(currentSteps).toHaveLength(1);
    expect(currentSteps[0]).toHaveAccessibleName('1연간·분기 방향');
  });

  it('keeps successful Settings cards actionable when sibling requests fail', async () => {
    mocks.status.mockRejectedValueOnce(new Error('Google Calendar 요청에 실패했습니다. (403)'));
    mocks.entitlement.mockRejectedValueOnce(new Error('요청에 실패했습니다. (403)'));

    render(
      <MemoryRouter>
        <SettingsScreen />
      </MemoryRouter>
    );

    const googleCard = screen.getByRole('heading', { name: 'Google Calendar' }).closest('section');
    const planCard = screen.getByRole('heading', { name: '이용 플랜' }).closest('section');
    const notificationCard = screen.getByRole('heading', { name: '계획 알림' }).closest('section');
    expect(googleCard).not.toBeNull();
    expect(planCard).not.toBeNull();
    expect(notificationCard).not.toBeNull();

    expect(await within(googleCard as HTMLElement).findByRole('button', { name: '다시 로그인' })).toBeEnabled();
    expect(await within(planCard as HTMLElement).findByRole('button', { name: '다시 로그인' })).toBeEnabled();
    expect(await within(notificationCard as HTMLElement).findByRole('button', { name: '알림 시간 저장' })).toBeEnabled();
    expect(within(notificationCard as HTMLElement).queryByText('알림 설정을 불러오고 있습니다…')).not.toBeInTheDocument();
  });

  it('updates the shared calendar timezone immediately after preferences are saved', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AccountSettingsSections />
      </MemoryRouter>
    );

    const timeZoneSelect = await screen.findByLabelText('시간대');
    await user.selectOptions(timeZoneSelect, 'America/New_York');
    await user.click(screen.getByRole('button', { name: '알림 시간 저장' }));

    expect(mocks.savePreferences).toHaveBeenCalledWith(expect.objectContaining({
      timezone: 'America/New_York'
    }));
    expect(mocks.setAccountTimeZone).toHaveBeenCalledWith('America/New_York');
    expect(screen.getByText('알림 시간과 시간대를 저장했습니다.')).toBeInTheDocument();
  });

  it('retries only the failed entitlement card', async () => {
    const user = userEvent.setup();
    mocks.entitlement
      .mockRejectedValueOnce(new Error('일시적으로 이용 플랜을 불러오지 못했습니다.'))
      .mockResolvedValueOnce(entitlement);

    render(
      <MemoryRouter>
        <AccountSettingsSections />
      </MemoryRouter>
    );

    const planCard = screen.getByRole('heading', { name: '이용 플랜' }).closest('section') as HTMLElement;
    await user.click(await within(planCard).findByRole('button', { name: '다시 시도' }));
    expect(await within(planCard).findByText('정상 이용 중')).toBeInTheDocument();
    expect(mocks.preferences).toHaveBeenCalledTimes(1);
  });

  it('offers a fresh push opt-in when only another account or an ambiguous legacy device is stored', async () => {
    const user = userEvent.setup();
    const events: string[] = [];
    const otherSuffix = encodeURIComponent('oidc:https://issuer.example:user-b');
    window.localStorage.setItem('nowline.notification-device-id.v1', 'ambiguous-device');
    window.localStorage.setItem(`nowline.notification-device-id.v1:subject:${otherSuffix}`, 'other-device');
    mocks.notificationConfiguration.mockResolvedValueOnce({
      webConfigured: true,
      nativeConfigured: false,
      webPublicKey: 'test-public-key'
    });
    vi.stubGlobal('Notification', {
      requestPermission: vi.fn(async () => 'granted')
    });
    const previousSubscription = {
      unsubscribe: vi.fn(async () => {
        events.push('unsubscribe-old-endpoint');
        return true;
      }),
      toJSON: vi.fn(() => ({ endpoint: 'https://push.example/old' }))
    };
    const freshSubscription = {
      unsubscribe: vi.fn(),
      toJSON: vi.fn(() => ({
        endpoint: 'https://push.example/fresh',
        keys: { p256dh: 'key', auth: 'auth' }
      }))
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: vi.fn(async () => previousSubscription),
            subscribe: vi.fn(async () => {
              events.push('subscribe-fresh-endpoint');
              return freshSubscription;
            })
          }
        })
      }
    });
    mocks.registerDevice.mockImplementationOnce(async () => {
      events.push('register-current-account');
    });

    render(
      <MemoryRouter>
        <AccountSettingsSections />
      </MemoryRouter>
    );

    const notificationCard = screen.getByRole('heading', { name: '계획 알림' }).closest('section') as HTMLElement;
    const enable = await within(notificationCard).findByRole('button', { name: '이 기기 알림 켜기' });
    expect(enable).toBeEnabled();
    expect(within(notificationCard).queryByRole('button', { name: '이 기기 알림 끄기' })).not.toBeInTheDocument();
    await user.click(enable);

    expect(events).toEqual([
      'unsubscribe-old-endpoint',
      'subscribe-fresh-endpoint',
      'register-current-account'
    ]);
    expect(mocks.registerDevice).toHaveBeenCalledWith(
      expect.not.stringMatching(/ambiguous-device|other-device/),
      freshSubscription.toJSON()
    );
  });

  it('removes only the deleted subject private cache before logout', async () => {
    const user = userEvent.setup();
    const ownSuffix = encodeURIComponent('oidc:https://issuer.example:user-a');
    const otherSuffix = encodeURIComponent('oidc:https://issuer.example:user-b');
    const ownKeys = [
      `planner.mvp.snapshot.v1:${ownSuffix}`,
      `planner.mvp.sync.v1:${ownSuffix}`,
      `planner.mvp.last-conflict.v1:${ownSuffix}`,
      `nowline.active-plan.absent.v1:${ownSuffix}`
    ];
    ownKeys.forEach((key) => window.localStorage.setItem(key, 'private'));
    window.localStorage.setItem(`planner.mvp.snapshot.v1:${otherSuffix}`, 'other-account');
    const ownDeviceKey = `nowline.notification-device-id.v1:subject:${ownSuffix}`;
    const otherDeviceKey = `nowline.notification-device-id.v1:subject:${otherSuffix}`;
    window.localStorage.setItem(ownDeviceKey, 'device-id');
    window.localStorage.setItem(otherDeviceKey, 'other-device-id');
    window.localStorage.setItem('nowline.notification-device-id.v1', 'ambiguous-legacy-device');

    render(
      <MemoryRouter>
        <AccountSettingsSections />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: '계정 삭제' }));
    const dialog = screen.getByRole('dialog', { name: '계정과 모든 데이터를 삭제할까요?' });
    await user.type(within(dialog).getByLabelText(/확인을 위해 DELETE 입력/), 'DELETE');
    await user.click(within(dialog).getByRole('button', { name: '영구 삭제' }));

    expect(mocks.deleteAccount).toHaveBeenCalledTimes(1);
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    ownKeys.forEach((key) => expect(window.localStorage.getItem(key)).toBeNull());
    expect(window.localStorage.getItem(ownDeviceKey)).toBeNull();
    expect(window.localStorage.getItem(otherDeviceKey)).toBe('other-device-id');
    expect(window.localStorage.getItem('nowline.notification-device-id.v1')).toBe('ambiguous-legacy-device');
    expect(window.localStorage.getItem(`planner.mvp.snapshot.v1:${otherSuffix}`)).toBe('other-account');
  });

  it('keeps reauthentication available inside a failed account deletion dialog', async () => {
    const user = userEvent.setup();
    mocks.deleteAccount.mockRejectedValueOnce(new Error('최근 로그인이 필요합니다. (401)'));
    mocks.reauthenticate.mockRejectedValueOnce(new Error('인증 제공자 창을 열지 못했습니다.'));

    render(
      <MemoryRouter>
        <AccountSettingsSections />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: '계정 삭제' }));
    const dialog = screen.getByRole('dialog', { name: '계정과 모든 데이터를 삭제할까요?' });
    await user.type(within(dialog).getByLabelText(/확인을 위해 DELETE 입력/), 'DELETE');
    await user.click(within(dialog).getByRole('button', { name: '영구 삭제' }));
    await user.click(await within(dialog).findByRole('button', { name: '다시 로그인 후 삭제' }));

    expect(mocks.reauthenticate).toHaveBeenCalledTimes(1);
    expect(await within(dialog).findByText('인증 제공자 창을 열지 못했습니다.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '계정과 모든 데이터를 삭제할까요?' })).toBeInTheDocument();
  });

  it('shows a rejected Google reauthentication inside the Google card', async () => {
    const user = userEvent.setup();
    mocks.status.mockRejectedValueOnce(new Error('세션이 만료되었습니다. (403)'));
    mocks.reauthenticate.mockRejectedValueOnce(new Error('새 로그인 세션을 시작하지 못했습니다.'));

    render(
      <MemoryRouter>
        <SettingsScreen />
      </MemoryRouter>
    );

    const googleCard = screen.getByRole('heading', { name: 'Google Calendar' }).closest('section') as HTMLElement;
    await user.click(await within(googleCard).findByRole('button', { name: '다시 로그인' }));

    expect(mocks.reauthenticate).toHaveBeenCalledTimes(1);
    expect(await within(googleCard).findByText('새 로그인 세션을 시작하지 못했습니다.')).toBeInTheDocument();
  });

  it('opens an existing result directly from its management action', async () => {
    const user = userEvent.setup();
    const firstOutcome = (mocks.planner.outcomes as Array<{ id: string; title: string }>)[0];

    render(
      <MemoryRouter initialEntries={['/goals']}>
        <GoalsScreen />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: `${firstOutcome.title} 결과 수정` }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('결과 이름')).toHaveValue(firstOutcome.title);
    expect(within(dialog).getByRole('button', { name: '결과 저장' })).toBeEnabled();
  });

  it('contains the Goals card layout and restores repeated mobile touch targets', () => {
    expect(css).toMatch(/\.page--goals \.goals-table\s*{[\s\S]*?min-width:\s*0/);
    expect(css).toMatch(/\.bottom-nav\s*{\s*grid-template-columns:\s*repeat\(5/);
    expect(css).toMatch(/\.task-row__status-button,[\s\S]*?\.task-row__tool[\s\S]*?min-width:\s*44px/);
    expect(css).toMatch(/\.backlog-panel__controls button,[\s\S]*?\.task-row__body-button/);
  });
});
