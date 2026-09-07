import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'oidc-client-ts';
const bridge = vi.hoisted(() => ({ add: vi.fn(), launch: vi.fn(), open: vi.fn(), close: vi.fn(), remove: vi.fn() }));
vi.mock('@capacitor/app', () => ({ App: { addListener: bridge.add, getLaunchUrl: bridge.launch } }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: bridge.open, close: bridge.close } }));
import { matchesNativeCallback, NativeOidcNavigator } from './NativeOidcNavigator';
const callback = 'com.jieseob.planner://auth/callback';
const logout = 'com.jieseob.planner://auth/logout';
let receive: (event: { url: string }) => void;
beforeEach(() => {
  vi.resetAllMocks();
  bridge.add.mockImplementation(async (_name, listener) => { receive = listener; return { remove: bridge.remove }; });
  bridge.remove.mockResolvedValue(undefined);
  bridge.open.mockResolvedValue(undefined);
  bridge.close.mockResolvedValue(undefined);
  bridge.launch.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());
describe('native OIDC callback boundary', () => {
  it.each([`${callback}.evil?code=x`, `${callback}/extra`, 'https://auth/callback', 'com.jieseob.planner://evil/callback', 'com.jieseob.planner://user@auth/callback', `${callback}#code=x`, 'invalid'])('rejects route spoofing: %s', (url) => {
    expect(matchesNativeCallback(url, callback)).toBe(false);
  });
  it('accepts only the exact route with OAuth query parameters', () => {
    expect(matchesNativeCallback(`${callback}?code=abc&state=123`, callback)).toBe(true);
  });
  it('ignores unrelated links and returns an allowed callback once, cleaning its listener', async () => {
    const navigator = new NativeOidcNavigator([callback, logout]);
    const window = await navigator.prepare();
    const pending = window.navigate({ url: 'https://issuer.example/authorize' });
    await Promise.resolve();
    receive({ url: `${callback}.evil?code=bad` });
    receive({ url: `${callback}?code=good&state=s` });
    await expect(pending).resolves.toEqual({ url: `${callback}?code=good&state=s` });
    expect(navigator.consumeCallbackUrl()).toContain('code=good');
    expect(() => navigator.consumeCallbackUrl()).toThrow();
    expect(bridge.remove).toHaveBeenCalledOnce();
  });
  it('cleans listeners and timers when the OS browser cannot open', async () => {
    vi.useFakeTimers();
    bridge.open.mockRejectedValue(new Error('bridge unavailable'));
    const window = await new NativeOidcNavigator([callback, logout]).prepare();
    await expect(window.navigate({ url: 'https://issuer.example/authorize' })).rejects.toThrow('bridge unavailable');
    expect(bridge.remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('times out with a retryable failure and removes only its own listener', async () => {
    vi.useFakeTimers();
    const window = await new NativeOidcNavigator([callback, logout]).prepare();
    const result = expect(window.navigate({ url: 'https://issuer.example/authorize' })).rejects.toThrow('초과');
    await vi.advanceTimersByTimeAsync(300_001);
    await result;
    expect(bridge.remove).toHaveBeenCalledOnce();
  });
  it('finishes cold-start login once through the PKCE verifier, not a stored access token', async () => {
    const value = { profile: { sub: 'user' } } as User;
    const manager = { signinRedirectCallback: vi.fn(async () => value), signoutRedirectCallback: vi.fn() };
    bridge.launch.mockResolvedValue({ url: `${callback}?code=abc&state=persisted` });
    const navigator = new NativeOidcNavigator([callback, logout]);
    expect(await navigator.completeLaunch(manager)).toBe(value);
    expect(await navigator.completeLaunch(manager)).toBe(value);
    expect(manager.signinRedirectCallback).toHaveBeenCalledExactlyOnceWith(`${callback}?code=abc&state=persisted`);
  });
  it('rejects invalid persisted OIDC state and does not authenticate', async () => {
    bridge.launch.mockResolvedValue({ url: `${callback}?code=abc&state=invalid` });
    const manager = { signinRedirectCallback: vi.fn().mockRejectedValue(new Error('invalid state')), signoutRedirectCallback: vi.fn() };
    await expect(new NativeOidcNavigator([callback, logout]).completeLaunch(manager)).rejects.toThrow('invalid state');
  });
  it('completes cold-start logout and ignores unrelated launch URLs', async () => {
    const manager = { signinRedirectCallback: vi.fn(), signoutRedirectCallback: vi.fn().mockResolvedValue(undefined) };
    bridge.launch.mockResolvedValue({ url: `${logout}?state=valid` });
    expect(await new NativeOidcNavigator([callback, logout]).completeLaunch(manager)).toBeNull();
    expect(manager.signoutRedirectCallback).toHaveBeenCalledOnce();
    bridge.launch.mockResolvedValue({ url: 'https://example.com' });
    expect(await new NativeOidcNavigator([callback, logout]).completeLaunch(manager)).toBeUndefined();
    expect(manager.signinRedirectCallback).not.toHaveBeenCalled();
  });
});
