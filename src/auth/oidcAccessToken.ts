import type { User, UserManager } from 'oidc-client-ts';
import type { AccessTokenProvider } from './accessToken';

/** Read the current session on every request; a background tab may miss renewal timers. */
export function createOidcAccessTokenProvider(manager: Pick<UserManager, 'getUser' | 'signinSilent'>): AccessTokenProvider {
  let renewal: Promise<User | null> | null = null;
  return async () => {
    const user = await manager.getUser();
    if (!user) return null;
    if (!user.expired && (user.expires_in === undefined || user.expires_in > 30)) return user.access_token;
    if (!renewal) {
      renewal = manager.signinSilent().finally(() => { renewal = null; });
    }
    const refreshed = await renewal;
    const current = await manager.getUser();
    if (!refreshed || !current || current.expired || current.profile.sub !== user.profile.sub) return null;
    return current.access_token;
  };
}
