import { useEffect, useState } from 'react';
import { BadgeCheck, Bell, BellOff, Download, ShieldCheck, Trash2 } from 'lucide-react';
import { accountApi, type AccountEntitlement, type AccountPreferences, type NotificationConfiguration } from '../api/accountApi';
import { useAuth } from '../auth/AuthProvider';
import { Modal } from './Modal';
import { FocusAlert } from './FocusAlert';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { Link } from 'react-router-dom';

const DEVICE_KEY = 'nowline.notification-device-id.v1';
const TIMEZONES = Array.from(new Set([
  Intl.DateTimeFormat().resolvedOptions().timeZone,
  'Asia/Seoul',
  'UTC',
  'Asia/Tokyo',
  'America/Los_Angeles',
  'America/New_York',
  'Europe/London'
]));
const PRIVATE_STORAGE_KEYS = [
  'planner.mvp.snapshot.v1',
  'planner.mvp.sync.v1',
  'planner.mvp.last-conflict.v1',
  'nowline.active-plan.absent.v1',
  DEVICE_KEY
];

const base64UrlBytes = (value: string) => {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const raw = window.atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
};

const deviceId = () => {
  const existing = window.localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(DEVICE_KEY, created);
  return created;
};

export function AccountSettingsSections() {
  const { logout } = useAuth();
  const [entitlement, setEntitlement] = useState<AccountEntitlement | null>(null);
  const [preferences, setPreferences] = useState<AccountPreferences | null>(null);
  const [configuration, setConfiguration] = useState<NotificationConfiguration | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>(() => (
    typeof Notification === 'undefined' ? 'denied' : Notification.permission
  ));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const nativePlatform = Capacitor.getPlatform();
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    Promise.all([accountApi.entitlement(), accountApi.preferences(), accountApi.notificationConfiguration()])
      .then(([entitlementValue, preferenceValue, configurationValue]) => {
        setEntitlement(entitlementValue);
        setPreferences(preferenceValue);
        setConfiguration(configurationValue);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '계정 설정을 불러오지 못했습니다.'));
  }, []);

  const savePreferences = async () => {
    if (!preferences) return;
    setBusy(true);
    try {
      setPreferences(await accountApi.savePreferences(preferences));
      setNotice('알림 시간과 시간대를 저장했습니다.');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '알림 설정을 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const enableWebPush = async () => {
    if (!configuration?.webConfigured || !configuration.webPublicKey) return;
    setBusy(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') throw new Error('브라우저 알림 권한이 허용되지 않았습니다.');
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlBytes(configuration.webPublicKey)
      });
      await accountApi.registerDevice(deviceId(), subscription.toJSON());
      setNotice('이 기기에서 계획 알림을 받습니다.');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '알림을 켜지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const disableWebPush = async () => {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
      const id = window.localStorage.getItem(DEVICE_KEY);
      if (id) await accountApi.disableDevice(id);
      setNotice('이 기기의 계획 알림을 껐습니다.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '알림을 끄지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const enableNativePush = async () => {
    if (!configuration?.nativeConfigured || !isNative) return;
    setBusy(true);
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
      await accountApi.registerNativeDevice(deviceId(), nativePlatform === 'ios' ? 'IOS' : 'ANDROID', token);
      setNotice('이 앱에서 계획 알림을 받습니다.');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '앱 알림을 켜지 못했습니다.');
    } finally {
      await PushNotifications.removeAllListeners();
      setBusy(false);
    }
  };

  const disableNativePush = async () => {
    setBusy(true);
    try {
      const id = window.localStorage.getItem(DEVICE_KEY);
      if (id) await accountApi.disableDevice(id);
      await PushNotifications.unregister();
      setNotice('이 앱의 계획 알림을 껐습니다.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '앱 알림을 끄지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    if (deleteConfirmation !== 'DELETE') return;
    setBusy(true);
    try {
      await accountApi.deleteAccount();
      PRIVATE_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
      setDeleteOpen(false);
      await logout();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '계정을 삭제하지 못했습니다.');
      setBusy(false);
    }
  };

  return (
    <>
      {notice && <div className="inline-success" role="status">{notice}</div>}
      {error && <FocusAlert message={error} />}

      <section className="settings-card" aria-labelledby="subscription-title">
        <div className="settings-card__heading">
          <span className="settings-card__icon"><BadgeCheck size={22} aria-hidden="true" /></span>
          <div>
            <h2 id="subscription-title">이용 플랜</h2>
            <p>공개 베타 동안 핵심 계획·동기화 기능을 제한 없이 사용할 수 있습니다.</p>
          </div>
          {entitlement && <span className="integration-state integration-state--ready">{entitlement.plan === 'BETA' ? '무료 베타' : 'Pro'}</span>}
        </div>
        {entitlement ? (
          <div className="integration-settings">
            <div className="integration-account">
              <span>현재 상태</span>
              <strong>{entitlement.status === 'ACTIVE' ? '정상 이용 중' : entitlement.status}</strong>
              <small>{entitlement.paid ? '유료 구독 권한' : '결제 없이 제공되는 베타 권한'}</small>
            </div>
            <p className="settings-hint">유료 플랜이 시작되기 전에는 자동 결제되지 않습니다. 가격과 전환 일정은 별도로 안내합니다.</p>
          </div>
        ) : <p role="status">이용 플랜을 확인하고 있습니다…</p>}
      </section>

      <section className="settings-card" aria-labelledby="notification-title">
        <div className="settings-card__heading">
          <span className="settings-card__icon"><Bell size={22} aria-hidden="true" /></span>
          <div>
            <h2 id="notification-title">계획 알림</h2>
            <p>오늘 계획과 내부 시간 블록 시작 전에 등록한 기기로 알려드립니다.</p>
          </div>
        </div>
        {preferences ? (
          <div className="integration-settings">
            <div className="form-grid__columns">
              <label className="field">시간대<select value={preferences.timezone} onChange={(event) => setPreferences({ ...preferences, timezone: event.target.value })}>{!TIMEZONES.includes(preferences.timezone) && <option value={preferences.timezone}>{preferences.timezone}</option>}{TIMEZONES.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}</select></label>
              <label className="field">오늘 계획 알림<input type="time" value={preferences.dailyReminderTime.slice(0, 5)} onChange={(event) => setPreferences({ ...preferences, dailyReminderTime: event.target.value })} /></label>
            </div>
            <div className="form-grid__columns">
              <label className="settings-check"><input type="checkbox" checked={preferences.dailyReminderEnabled} onChange={(event) => setPreferences({ ...preferences, dailyReminderEnabled: event.target.checked })} /> 매일 오늘 계획 알림 받기</label>
              <label className="field">시간 블록 사전 알림<select value={preferences.blockReminderMinutes} onChange={(event) => setPreferences({ ...preferences, blockReminderMinutes: Number(event.target.value) })}>{[0, 5, 10, 15, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes === 0 ? '시작 시간' : `${minutes}분 전`}</option>)}</select></label>
            </div>
            <div className="settings-card__actions">
              <button className="button button--primary" type="button" disabled={busy} onClick={() => void savePreferences()}>알림 시간 저장</button>
              {isNative && configuration?.nativeConfigured ? (
                <>
                  <button className="button button--secondary" type="button" disabled={busy} onClick={() => void enableNativePush()}><Bell size={16} /> 앱 알림 켜기</button>
                  <button className="button button--ghost" type="button" disabled={busy} onClick={() => void disableNativePush()}><BellOff size={16} /> 앱 알림 끄기</button>
                </>
              ) : configuration?.webConfigured ? (
                permission === 'granted'
                  ? <button className="button button--secondary" type="button" disabled={busy} onClick={() => void disableWebPush()}><BellOff size={16} /> 이 기기 알림 끄기</button>
                  : <button className="button button--secondary" type="button" disabled={busy} onClick={() => void enableWebPush()}><Bell size={16} /> 이 기기 알림 켜기</button>
              ) : <span className="settings-hint">운영 푸시 자격 증명을 설정하면 백그라운드 알림을 켤 수 있습니다.</span>}
            </div>
          </div>
        ) : <p role="status">알림 설정을 불러오고 있습니다…</p>}
      </section>

      <section className="settings-card settings-card--privacy" aria-labelledby="privacy-title">
        <div className="settings-card__heading">
          <span className="settings-card__icon"><ShieldCheck size={22} aria-hidden="true" /></span>
          <div>
            <h2 id="privacy-title">내 데이터</h2>
            <p>계획과 이력을 JSON으로 내려받거나 계정 데이터를 영구 삭제할 수 있습니다.</p>
          </div>
        </div>
        <div className="settings-card__actions">
          <button className="button button--secondary" type="button" disabled={busy} onClick={() => void accountApi.downloadExport()}><Download size={16} /> 데이터 내보내기</button>
          <button className="button button--warning" type="button" disabled={busy} onClick={() => setDeleteOpen(true)}><Trash2 size={16} /> 계정 삭제</button>
        </div>
        <p className="settings-hint"><Link to="/privacy" target="_blank">개인정보 처리방침</Link> · <Link to="/terms" target="_blank">이용약관</Link></p>
      </section>

      {deleteOpen && (
        <Modal title="계정과 모든 데이터를 삭제할까요?" description="계획, 실행 기록, 변경 이력, 캘린더 토큰과 알림 기기가 영구 삭제됩니다. 먼저 데이터를 내보내는 것을 권장합니다." onClose={() => setDeleteOpen(false)}>
          <label className="field">확인을 위해 DELETE 입력<input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" /></label>
          <div className="modal__actions">
            <button className="button button--secondary" type="button" onClick={() => setDeleteOpen(false)}>취소</button>
            <button className="button button--warning" type="button" disabled={busy || deleteConfirmation !== 'DELETE'} onClick={() => void deleteAccount()}>영구 삭제</button>
          </div>
        </Modal>
      )}
    </>
  );
}
