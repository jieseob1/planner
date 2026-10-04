import { describe, expect, it, vi } from 'vitest';
import type { User } from 'oidc-client-ts';
import { createOidcAccessTokenProvider } from './oidcAccessToken';

const user = (token: string, expires = 3600, subject = 'same-user') => ({ access_token: token, expires_in: expires, expired: expires <= 0, profile: { sub: subject } }) as User;

describe('request-time OIDC renewal', () => {
  it('reads the latest session rather than keeping a captured token', async () => {
    let current = user('first');
    const manager = { getUser: vi.fn(async () => current), signinSilent: vi.fn() };
    const token = createOidcAccessTokenProvider(manager);
    expect(await token()).toBe('first'); current = user('second');
    expect(await token()).toBe('second'); expect(manager.signinSilent).not.toHaveBeenCalled();
  });
  it('renews expired or nearly expired tokens once for concurrent device polls', async () => {
    let current = user('expired', -10);
    let finish!: (value: User) => void;
    const manager = { getUser: vi.fn(async () => current), signinSilent: vi.fn(() => new Promise<User>(resolve => { finish = resolve; })) };
    const token = createOidcAccessTokenProvider(manager);
    const calls = [token(), token(), token()];
    await vi.waitFor(() => expect(manager.signinSilent).toHaveBeenCalledOnce());
    current = user('fresh'); finish(current);
    expect(await Promise.all(calls)).toEqual(['fresh', 'fresh', 'fresh']);
  });
  it('can retry a failed renewal without losing the locally saved planner data', async () => {
    let current = user('old', 5);
    const manager = { getUser: vi.fn(async () => current), signinSilent: vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(async () => { current = user('fresh'); return current; }) };
    const token = createOidcAccessTokenProvider(manager);
    await expect(token()).rejects.toThrow('offline'); expect(await token()).toBe('fresh');
    expect(manager.signinSilent).toHaveBeenCalledTimes(2);
  });
  it('never sends a renewed token after logout or an account switch', async () => {
    let current: User | null = user('old', -1);
    const manager = { getUser: vi.fn(async () => current), signinSilent: vi.fn(async () => { current = user('other', 3600, 'another-user'); return current; }) };
    const token = createOidcAccessTokenProvider(manager);
    expect(await token()).toBeNull(); current = null;
    expect(await token()).toBeNull(); expect(manager.signinSilent).toHaveBeenCalledOnce();
  });
});
