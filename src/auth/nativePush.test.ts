import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const bridge = vi.hoisted(() => ({ permission: vi.fn(), add: vi.fn(), register: vi.fn(), remove: vi.fn(), unregister: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: {
  requestPermissions: bridge.permission, addListener: bridge.add, register: bridge.register, unregister: bridge.unregister
} }));
import { registerNativePushToken } from './nativePush';
import { cleanupNotificationRegistration } from './notificationRegistration';
let listeners: Record<string, (value: { value: string }) => void>;
beforeEach(() => {
  vi.resetAllMocks();
  listeners = {};
  bridge.permission.mockResolvedValue({ receive: 'granted' });
  bridge.remove.mockResolvedValue(undefined);
  bridge.add.mockImplementation(async (name, listener) => { listeners[name] = listener; return { remove: bridge.remove }; });
  bridge.register.mockImplementation(async () => listeners.registration({ value: 'test-token' }));
  window.localStorage.clear();
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
it('does not initialize or unregister Firebase when native push is not configured', async () => {
  vi.stubEnv('VITE_NATIVE_PUSH_ENABLED', 'false');
  await expect(registerNativePushToken()).rejects.toThrow('설정되지');
  const result = await cleanupNotificationRegistration(null);
  expect(result.local).toBe('not-registered');
  expect(bridge.permission).not.toHaveBeenCalled();
  expect(bridge.unregister).not.toHaveBeenCalled();
});
it('registers after explicit opt-in and removes only its two listeners', async () => {
  vi.stubEnv('VITE_NATIVE_PUSH_ENABLED', 'true');
  await expect(registerNativePushToken()).resolves.toBe('test-token');
  expect(bridge.remove).toHaveBeenCalledTimes(2);
});
it('cleans listeners and timeout when register fails', async () => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_NATIVE_PUSH_ENABLED', 'true');
  bridge.register.mockRejectedValue(new Error('provider unavailable'));
  await expect(registerNativePushToken()).rejects.toThrow('provider unavailable');
  expect(bridge.remove).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});
