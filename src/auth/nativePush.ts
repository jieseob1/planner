import { PushNotifications } from '@capacitor/push-notifications';
import type { PluginListenerHandle } from '@capacitor/core';

/** Push credentials and entitlements are optional; never initialize a missing native provider. */
export const nativePushEnabled = () => import.meta.env.VITE_NATIVE_PUSH_ENABLED === 'true';

export async function registerNativePushToken(): Promise<string> {
  if (!nativePushEnabled()) throw new Error('이 앱 빌드에는 푸시 알림이 설정되지 않았습니다.');
  const handles: PluginListenerHandle[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveToken!: (token: string) => void;
  let rejectToken!: (error: Error) => void;
  const token = new Promise<string>((resolve, reject) => { resolveToken = resolve; rejectToken = reject; });
  void token.catch(() => undefined);
  try {
    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') throw new Error('앱 알림 권한이 허용되지 않았습니다.');
    handles.push(await PushNotifications.addListener('registration', registration => resolveToken(registration.value)));
    handles.push(await PushNotifications.addListener('registrationError', () => rejectToken(new Error('앱 알림 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.'))));
    timer = setTimeout(() => rejectToken(new Error('푸시 토큰 등록 시간이 초과되었습니다.')), 15000);
    await PushNotifications.register();
    return await token;
  } finally {
    clearTimeout(timer);
    // Preserve AppShell's notification-click listener and unrelated subscribers.
    await Promise.all(handles.map(handle => handle.remove().catch(() => undefined)));
  }
}
