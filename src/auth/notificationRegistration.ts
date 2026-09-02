import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { accountApi } from '../api/accountApi';

export const LEGACY_NOTIFICATION_DEVICE_KEY = 'nowline.notification-device-id.v1';
const SUBJECT_DEVICE_KEY_PREFIX = `${LEGACY_NOTIFICATION_DEVICE_KEY}:subject:`;

const canAdoptLegacyDevice = (subject: string) => (
  subject.startsWith('local:') || subject.startsWith('test:')
);

export const notificationDeviceStorageKey = (subject: string) => (
  `${SUBJECT_DEVICE_KEY_PREFIX}${encodeURIComponent(subject)}`
);

export const storedNotificationDeviceId = (subject: string | null): string | null => {
  if (!subject) return null;
  const scopedKey = notificationDeviceStorageKey(subject);
  const scoped = window.localStorage.getItem(scopedKey);
  if (scoped) return scoped;

  // A global legacy key cannot prove which OIDC account owns it. Only the
  // single-user local/test runtimes may adopt it during migration.
  if (!canAdoptLegacyDevice(subject)) return null;
  const legacy = window.localStorage.getItem(LEGACY_NOTIFICATION_DEVICE_KEY);
  if (!legacy) return null;
  window.localStorage.setItem(scopedKey, legacy);
  window.localStorage.removeItem(LEGACY_NOTIFICATION_DEVICE_KEY);
  return legacy;
};

export const getOrCreateNotificationDeviceId = (subject: string | null): string => {
  if (!subject) throw new Error('알림 기기를 등록하려면 로그인 정보가 필요합니다.');
  const existing = storedNotificationDeviceId(subject);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(notificationDeviceStorageKey(subject), created);
  return created;
};

export const clearNotificationDeviceId = (subject: string | null) => {
  if (!subject) return;
  window.localStorage.removeItem(notificationDeviceStorageKey(subject));
};

export interface NotificationCleanupResult {
  remote: 'disabled' | 'not-registered' | 'failed';
  local: 'revoked' | 'not-registered' | 'failed';
  errors: string[];
}

const reasonMessage = (reason: unknown) => (
  reason instanceof Error ? reason.message : String(reason)
);

const settleWithin = async <T,>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timeout = 0;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => reject(new Error(`${label} 시간 초과`)), timeoutMs);
      })
    ]);
  } finally {
    window.clearTimeout(timeout);
  }
};

const revokeLocalSubscription = async (): Promise<'revoked' | 'not-registered'> => {
  if (Capacitor.isNativePlatform()) {
    await PushNotifications.unregister();
    return 'revoked';
  }
  if (!('serviceWorker' in navigator)) return 'not-registered';
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return 'not-registered';
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return 'not-registered';
  await subscription.unsubscribe();
  return 'revoked';
};

/**
 * Revokes the authenticated subject's backend device before invalidating the
 * browser/native endpoint. Every step is best effort so a network outage can
 * never trap a user in a logged-in session.
 */
export const cleanupNotificationRegistration = async (
  subject: string | null,
  { timeoutMs = 2_500 }: { timeoutMs?: number } = {}
): Promise<NotificationCleanupResult> => {
  const id = storedNotificationDeviceId(subject);
  const result: NotificationCleanupResult = {
    remote: id ? 'failed' : 'not-registered',
    local: 'failed',
    errors: []
  };

  if (id) {
    try {
      await settleWithin(accountApi.disableDevice(id), timeoutMs, '서버 알림 기기 해지');
      result.remote = 'disabled';
    } catch (reason) {
      result.errors.push(`서버 알림 기기 해지 실패: ${reasonMessage(reason)}`);
    }
  }

  try {
    result.local = await settleWithin(revokeLocalSubscription(), timeoutMs, '이 기기의 푸시 구독 해지');
  } catch (reason) {
    result.errors.push(`이 기기의 푸시 구독 해지 실패: ${reasonMessage(reason)}`);
  } finally {
    // Never let another account reuse an identifier whose ownership is stale
    // or unknown. A later opt-in creates a new subject-scoped identifier.
    clearNotificationDeviceId(subject);
  }

  return result;
};
