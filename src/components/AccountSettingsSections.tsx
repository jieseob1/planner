import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Bell, BellOff, Download, LogIn, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { accountApi, type AccountEntitlement, type AccountPreferences, type NotificationConfiguration } from '../api/accountApi';
import { useAuth } from '../auth/AuthProvider';
import { Modal } from './Modal';
import { FocusAlert } from './FocusAlert';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { Link } from 'react-router-dom';
import { getPlannerStorageKeys } from '../state/PlannerProvider';
import {
  cleanupNotificationRegistration,
  getOrCreateNotificationDeviceId,
  notificationDeviceStorageKey,
  storedNotificationDeviceId
} from '../auth/notificationRegistration';
import { useTimeZone } from '../timezone/TimeZoneProvider';

const TIMEZONES = Array.from(new Set([
  Intl.DateTimeFormat().resolvedOptions().timeZone,
  'Asia/Seoul',
  'UTC',
  'Asia/Tokyo',
  'America/Los_Angeles',
  'America/New_York',
  'Europe/London'
]));
const LEGACY_PRIVATE_STORAGE_KEYS = [
  'planner.mvp.snapshot.v1',
  'planner.mvp.sync.v1',
  'planner.mvp.last-conflict.v1',
  'nowline.active-plan.absent.v1'
];

export const getPrivateStorageKeys = (subject: string | null) => [
  ...LEGACY_PRIVATE_STORAGE_KEYS,
  ...(subject ? Object.values(getPlannerStorageKeys(subject)) : []),
  ...(subject ? [notificationDeviceStorageKey(subject)] : [])
];

const base64UrlBytes = (value: string) => {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const raw = window.atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
};

const errorMessage = (reason: unknown, fallback: string) => (
  reason instanceof Error ? reason.message : fallback
);

const requiresLogin = (message: string) => /\((401|403)\)|unauthori[sz]ed|forbidden|인증이? 필요|로그인/i.test(message);

function CardRecovery({
  message,
  onRetry,
  onReauthenticate
}: {
  message: string;
  onRetry: () => void;
  onReauthenticate?: () => void;
}) {
  return (
    <div className="settings-card__feedback">
      <FocusAlert message={message} />
      <p>다른 설정은 그대로 사용할 수 있습니다. 이 카드만 다시 불러오세요.</p>
      <div className="settings-card__feedback-actions">
        <button className="button button--secondary" type="button" onClick={onRetry}>
          <RefreshCw size={16} aria-hidden="true" /> 다시 시도
        </button>
        {onReauthenticate ? (
          <button className="button button--primary" type="button" onClick={onReauthenticate}>
            <LogIn size={16} aria-hidden="true" /> 다시 로그인
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function AccountSettingsSections() {
  const { reauthenticate, logout, subject } = useAuth();
  const { setAccountTimeZone } = useTimeZone();
  const [entitlement, setEntitlement] = useState<AccountEntitlement | null>(null);
  const [entitlementLoading, setEntitlementLoading] = useState(true);
  const [entitlementError, setEntitlementError] = useState('');
  const [preferences, setPreferences] = useState<AccountPreferences | null>(null);
  const [configuration, setConfiguration] = useState<NotificationConfiguration | null>(null);
  const [notificationLoading, setNotificationLoading] = useState(true);
  const [notificationError, setNotificationError] = useState('');
  const [notificationNotice, setNotificationNotice] = useState('');
  const [notificationRegistered, setNotificationRegistered] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [privacyNotice, setPrivacyNotice] = useState('');
  const [privacyError, setPrivacyError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const nativePlatform = Capacitor.getPlatform();
  const isNative = Capacitor.isNativePlatform();

  const loadEntitlement = useCallback(async () => {
    setEntitlementLoading(true);
    setEntitlementError('');
    try {
      setEntitlement(await accountApi.entitlement());
    } catch (reason) {
      setEntitlement(null);
      setEntitlementError(errorMessage(reason, '이용 플랜을 불러오지 못했습니다.'));
    } finally {
      setEntitlementLoading(false);
    }
  }, []);

  const loadNotificationSettings = useCallback(async () => {
    setNotificationLoading(true);
    setNotificationError('');
    try {
      const [preferenceValue, configurationValue] = await Promise.all([
        accountApi.preferences(),
        accountApi.notificationConfiguration()
      ]);
      setPreferences(preferenceValue);
      setConfiguration(configurationValue);
    } catch (reason) {
      setPreferences(null);
      setConfiguration(null);
      setNotificationError(errorMessage(reason, '알림 설정을 불러오지 못했습니다.'));
    } finally {
      setNotificationLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEntitlement();
    void loadNotificationSettings();
  }, [loadEntitlement, loadNotificationSettings]);

  useEffect(() => {
    setNotificationRegistered(Boolean(storedNotificationDeviceId(subject)));
  }, [subject]);

  const reauthenticateEntitlement = async () => {
    setEntitlementError('');
    try {
      await reauthenticate();
      await loadEntitlement();
    } catch (reason) {
      setEntitlementError(errorMessage(reason, '다시 로그인하지 못했습니다.'));
    }
  };

  const reauthenticateNotifications = async () => {
    setNotificationError('');
    try {
      await reauthenticate();
      await loadNotificationSettings();
    } catch (reason) {
      setNotificationError(errorMessage(reason, '다시 로그인하지 못했습니다.'));
    }
  };

  const reauthenticatePrivacy = async () => {
    setPrivacyError('');
    try {
      await reauthenticate();
    } catch (reason) {
      setPrivacyError(errorMessage(reason, '다시 로그인하지 못했습니다.'));
    }
  };

  const savePreferences = async () => {
    if (!preferences) return;
    setNotificationBusy(true);
    setNotificationNotice('');
    setNotificationError('');
    try {
      const saved = await accountApi.savePreferences(preferences);
      setPreferences(saved);
      setAccountTimeZone(saved.timezone);
      setNotificationNotice('알림 시간과 시간대를 저장했습니다.');
      setNotificationError('');
    } catch (reason) {
      setNotificationError(errorMessage(reason, '알림 설정을 저장하지 못했습니다.'));
    } finally {
      setNotificationBusy(false);
    }
  };

  const enableWebPush = async () => {
    if (!configuration?.webConfigured || !configuration.webPublicKey) return;
    setNotificationBusy(true);
    setNotificationNotice('');
    setNotificationError('');
    try {
      const result = await Notification.requestPermission();
      if (result !== 'granted') throw new Error('브라우저 알림 권한이 허용되지 않았습니다.');
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && !storedNotificationDeviceId(subject)) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlBytes(configuration.webPublicKey)
      });
      await accountApi.registerDevice(getOrCreateNotificationDeviceId(subject), subscription.toJSON());
      setNotificationRegistered(true);
      setNotificationNotice('이 기기에서 계획 알림을 받습니다.');
      setNotificationError('');
    } catch (reason) {
      setNotificationError(errorMessage(reason, '알림을 켜지 못했습니다.'));
    } finally {
      setNotificationBusy(false);
    }
  };

  const disableWebPush = async () => {
    setNotificationBusy(true);
    setNotificationNotice('');
    setNotificationError('');
    try {
      const cleanup = await cleanupNotificationRegistration(subject);
      setNotificationRegistered(false);
      if (cleanup.errors.length > 0) throw new Error(cleanup.errors.join(' '));
      setNotificationNotice('이 기기의 계획 알림을 껐습니다.');
      setNotificationError('');
    } catch (reason) {
      setNotificationError(errorMessage(reason, '알림을 끄지 못했습니다.'));
    } finally {
      setNotificationBusy(false);
    }
  };

  const enableNativePush = async () => {
    if (!configuration?.nativeConfigured || !isNative) return;
    setNotificationBusy(true);
    setNotificationNotice('');
    setNotificationError('');
    try {
      const permissionResult = await PushNotifications.requestPermissions();
      if (permissionResult.receive !== 'granted') throw new Error('앱 알림 권한이 허용되지 않았습니다.');
      const token = await new Promise<string>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('푸시 토큰 등록 시간이 초과되었습니다.')), 15000);
        void PushNotifications.addListener('registration', (registration) => {
          window.clearTimeout(timeout);
          resolve(registration.value);
        });
        void PushNotifications.addListener('registrationError', (reason) => {
          window.clearTimeout(timeout);
          reject(new Error(reason.error));
        });
        void PushNotifications.register();
      });
      await accountApi.registerNativeDevice(
        getOrCreateNotificationDeviceId(subject),
        nativePlatform === 'ios' ? 'IOS' : 'ANDROID',
        token
      );
      setNotificationRegistered(true);
      setNotificationNotice('이 앱에서 계획 알림을 받습니다.');
      setNotificationError('');
    } catch (reason) {
      setNotificationError(errorMessage(reason, '앱 알림을 켜지 못했습니다.'));
    } finally {
      await PushNotifications.removeAllListeners();
      setNotificationBusy(false);
    }
  };

  const disableNativePush = async () => {
    setNotificationBusy(true);
    setNotificationNotice('');
    setNotificationError('');
    try {
      const cleanup = await cleanupNotificationRegistration(subject);
      setNotificationRegistered(false);
      if (cleanup.errors.length > 0) throw new Error(cleanup.errors.join(' '));
      setNotificationNotice('이 앱의 계획 알림을 껐습니다.');
      setNotificationError('');
    } catch (reason) {
      setNotificationError(errorMessage(reason, '앱 알림을 끄지 못했습니다.'));
    } finally {
      setNotificationBusy(false);
    }
  };

  const exportData = async () => {
    setPrivacyBusy(true);
    setPrivacyNotice('');
    setPrivacyError('');
    try {
      await accountApi.downloadExport();
      setPrivacyNotice('계정 데이터 내보내기를 시작했습니다.');
    } catch (reason) {
      setPrivacyError(errorMessage(reason, '계정 데이터를 내보내지 못했습니다.'));
    } finally {
      setPrivacyBusy(false);
    }
  };

  const deleteAccount = async () => {
    if (deleteConfirmation !== 'DELETE') return;
    setPrivacyBusy(true);
    setPrivacyNotice('');
    setPrivacyError('');
    try {
      await accountApi.deleteAccount();
      getPrivateStorageKeys(subject).forEach((key) => window.localStorage.removeItem(key));
      setDeleteOpen(false);
      await logout();
    } catch (reason) {
      setPrivacyError(errorMessage(reason, '계정을 삭제하지 못했습니다.'));
      setPrivacyBusy(false);
    }
  };

  return (
    <>
      <section className="settings-card" aria-labelledby="subscription-title">
        <div className="settings-card__heading">
          <span className="settings-card__icon"><BadgeCheck size={22} aria-hidden="true" /></span>
          <div>
            <h2 id="subscription-title">이용 플랜</h2>
            <p>공개 베타 동안 핵심 계획·동기화 기능을 제한 없이 사용할 수 있습니다.</p>
          </div>
          {entitlement && <span className="integration-state integration-state--ready">{entitlement.plan === 'BETA' ? '무료 베타' : 'Pro'}</span>}
        </div>
        {entitlementLoading ? <p role="status">이용 플랜을 확인하고 있습니다…</p> : entitlementError ? (
          <CardRecovery
            message={entitlementError}
            onRetry={() => void loadEntitlement()}
            onReauthenticate={requiresLogin(entitlementError) ? () => void reauthenticateEntitlement() : undefined}
          />
        ) : entitlement ? (
          <div className="integration-settings">
            <div className="integration-account">
              <span>현재 상태</span>
              <strong>{entitlement.status === 'ACTIVE' ? '정상 이용 중' : entitlement.status}</strong>
              <small>{entitlement.paid ? '유료 구독 권한' : '결제 없이 제공되는 베타 권한'}</small>
            </div>
            <p className="settings-hint">유료 플랜이 시작되기 전에는 자동 결제되지 않습니다. 가격과 전환 일정은 별도로 안내합니다.</p>
          </div>
        ) : <p className="settings-hint">이용 플랜 정보가 없습니다.</p>}
      </section>

      <section className="settings-card" aria-labelledby="notification-title">
        <div className="settings-card__heading">
          <span className="settings-card__icon"><Bell size={22} aria-hidden="true" /></span>
          <div>
            <h2 id="notification-title">계획 알림</h2>
            <p>오늘 계획과 내부 시간 블록 시작 전에 등록한 기기로 알려드립니다.</p>
          </div>
        </div>
        {notificationLoading ? <p role="status">알림 설정을 불러오고 있습니다…</p> : notificationError && !preferences ? (
          <CardRecovery
            message={notificationError}
            onRetry={() => void loadNotificationSettings()}
            onReauthenticate={requiresLogin(notificationError) ? () => void reauthenticateNotifications() : undefined}
          />
        ) : preferences ? (
          <div className="integration-settings">
            {notificationNotice ? <div className="inline-success" role="status">{notificationNotice}</div> : null}
            {notificationError ? <FocusAlert message={notificationError} /> : null}
            <div className="form-grid__columns">
              <label className="field">시간대<select value={preferences.timezone} onChange={(event) => setPreferences({ ...preferences, timezone: event.target.value })}>{!TIMEZONES.includes(preferences.timezone) && <option value={preferences.timezone}>{preferences.timezone}</option>}{TIMEZONES.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}</select></label>
              <label className="field">오늘 계획 알림<input type="time" value={preferences.dailyReminderTime.slice(0, 5)} onChange={(event) => setPreferences({ ...preferences, dailyReminderTime: event.target.value })} /></label>
            </div>
            <div className="form-grid__columns">
              <label className="settings-check"><input type="checkbox" checked={preferences.dailyReminderEnabled} onChange={(event) => setPreferences({ ...preferences, dailyReminderEnabled: event.target.checked })} /> 매일 오늘 계획 알림 받기</label>
              <label className="field">시간 블록 사전 알림<select value={preferences.blockReminderMinutes} onChange={(event) => setPreferences({ ...preferences, blockReminderMinutes: Number(event.target.value) })}>{[0, 5, 10, 15, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes === 0 ? '시작 시간' : `${minutes}분 전`}</option>)}</select></label>
            </div>
            <div className="settings-card__actions">
              <button className="button button--primary" type="button" disabled={notificationBusy} onClick={() => void savePreferences()}>알림 시간 저장</button>
              {isNative && configuration?.nativeConfigured ? (
                notificationRegistered
                  ? <button className="button button--ghost" type="button" disabled={notificationBusy} onClick={() => void disableNativePush()}><BellOff size={16} /> 앱 알림 끄기</button>
                  : <button className="button button--secondary" type="button" disabled={notificationBusy} onClick={() => void enableNativePush()}><Bell size={16} /> 앱 알림 켜기</button>
              ) : configuration?.webConfigured ? (
                notificationRegistered
                  ? <button className="button button--secondary" type="button" disabled={notificationBusy} onClick={() => void disableWebPush()}><BellOff size={16} /> 이 기기 알림 끄기</button>
                  : <button className="button button--secondary" type="button" disabled={notificationBusy} onClick={() => void enableWebPush()}><Bell size={16} /> 이 기기 알림 켜기</button>
              ) : <span className="settings-hint">운영 푸시 자격 증명을 설정하면 백그라운드 알림을 켤 수 있습니다.</span>}
            </div>
          </div>
        ) : <p className="settings-hint">알림 설정 정보가 없습니다.</p>}
      </section>

      <section className="settings-card settings-card--privacy" aria-labelledby="privacy-title">
        <div className="settings-card__heading">
          <span className="settings-card__icon"><ShieldCheck size={22} aria-hidden="true" /></span>
          <div>
            <h2 id="privacy-title">내 데이터</h2>
            <p>계획과 이력을 JSON으로 내려받거나 계정 데이터를 영구 삭제할 수 있습니다.</p>
          </div>
        </div>
        {privacyNotice ? <div className="inline-success" role="status">{privacyNotice}</div> : null}
        {privacyError && !deleteOpen ? (
          <div className="settings-card__feedback">
            <FocusAlert message={privacyError} />
            {requiresLogin(privacyError) ? (
              <button className="button button--primary" type="button" onClick={() => void reauthenticatePrivacy()}>
                <LogIn size={16} aria-hidden="true" /> 다시 로그인
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="settings-card__actions">
          <button className="button button--secondary" type="button" disabled={privacyBusy} onClick={() => void exportData()}><Download size={16} /> 데이터 내보내기</button>
          <button className="button button--warning" type="button" disabled={privacyBusy} onClick={() => {
            setPrivacyError('');
            setDeleteConfirmation('');
            setDeleteOpen(true);
          }}><Trash2 size={16} /> 계정 삭제</button>
        </div>
        <p className="settings-hint"><Link to="/privacy" target="_blank">개인정보 처리방침</Link> · <Link to="/terms" target="_blank">이용약관</Link></p>
      </section>

      {deleteOpen && (
        <Modal eyebrow="계정 보안" title="계정과 모든 데이터를 삭제할까요?" description="계획, 실행 기록, 변경 이력, 캘린더 토큰과 알림 기기가 영구 삭제됩니다. 먼저 데이터를 내보내는 것을 권장합니다." onClose={() => {
          setDeleteOpen(false);
          setDeleteConfirmation('');
        }}>
          {privacyError ? <FocusAlert message={privacyError} /> : null}
          {privacyError && requiresLogin(privacyError) ? (
            <button className="button button--primary" type="button" onClick={() => void reauthenticatePrivacy()}>
              <LogIn size={16} aria-hidden="true" /> 다시 로그인 후 삭제
            </button>
          ) : null}
          <label className="field">확인을 위해 DELETE 입력<input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" /></label>
          <div className="modal__actions">
            <button className="button button--secondary" type="button" onClick={() => {
              setDeleteOpen(false);
              setDeleteConfirmation('');
            }}>취소</button>
            <button className="button button--warning" type="button" disabled={privacyBusy || deleteConfirmation !== 'DELETE'} onClick={() => void deleteAccount()}>영구 삭제</button>
          </div>
        </Modal>
      )}
    </>
  );
}
