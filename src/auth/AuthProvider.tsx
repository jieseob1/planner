import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';
import { LogIn, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import { Capacitor } from '@capacitor/core';
import { setAccessTokenProvider } from './accessToken';
import { NativeOidcNavigator } from './NativeOidcNavigator';
import { SecureStateStore } from './SecureStateStore';

type AuthStatus = 'loading' | 'consent' | 'authenticated' | 'anonymous' | 'error';

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

interface DevTokenResponse {
  accessToken: string;
  expiresIn: number;
}

const LOCAL_TOKEN_KEY = 'nowline.local-access-token';
const LOCAL_TOKEN_EXPIRY_KEY = 'nowline.local-access-token-expiry';
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
const AuthContext = createContext<AuthContextValue | null>(null);

const isTest = import.meta.env.MODE === 'test';
const isLocalRuntime = () => (
  window.location.hostname === 'localhost'
  || window.location.hostname === '127.0.0.1'
);

const configuredMode = import.meta.env.VITE_AUTH_MODE?.trim();
const authMode = () => configuredMode || (
  !Capacitor.isNativePlatform() && isLocalRuntime() ? 'local' : 'oidc'
);

interface OidcRuntime {
  manager: UserManager;
  nativeNavigator: NativeOidcNavigator | null;
}

const createOidcManager = () => {
  const authority = import.meta.env.VITE_OIDC_AUTHORITY?.trim();
  const clientId = import.meta.env.VITE_OIDC_CLIENT_ID?.trim();
  if (!authority || !clientId) return null;
  const native = Capacitor.isNativePlatform();
  const origin = window.location.origin;
  const redirectUri = (native
    ? import.meta.env.VITE_OIDC_NATIVE_REDIRECT_URI
    : import.meta.env.VITE_OIDC_WEB_REDIRECT_URI)?.trim()
    || import.meta.env.VITE_OIDC_REDIRECT_URI?.trim()
    || (native ? '' : `${origin}/auth/callback`);
  const postLogoutRedirectUri = (native
    ? import.meta.env.VITE_OIDC_NATIVE_POST_LOGOUT_REDIRECT_URI
    : import.meta.env.VITE_OIDC_WEB_POST_LOGOUT_REDIRECT_URI)?.trim()
    || import.meta.env.VITE_OIDC_POST_LOGOUT_REDIRECT_URI?.trim()
    || (native ? '' : origin);
  if (native && (!redirectUri || !postLogoutRedirectUri)) {
    return null;
  }
  const secureStore = native ? new SecureStateStore() : null;
  const nativeNavigator = native
    ? new NativeOidcNavigator([redirectUri, postLogoutRedirectUri])
    : null;
  const manager = new UserManager({
    authority,
    client_id: clientId,
    redirect_uri: redirectUri,
    post_logout_redirect_uri: postLogoutRedirectUri,
    silent_redirect_uri: import.meta.env.VITE_OIDC_SILENT_REDIRECT_URI || `${origin}/auth/silent-callback`,
    response_type: 'code',
    scope: import.meta.env.VITE_OIDC_SCOPE || 'openid profile email offline_access',
    automaticSilentRenew: true,
    monitorSession: !native,
    revokeTokensOnSignout: true,
    userStore: secureStore ?? new WebStorageStateStore({ store: window.sessionStorage }),
    stateStore: secureStore ?? new WebStorageStateStore({ store: window.sessionStorage })
  }, nativeNavigator ?? undefined);
  return { manager, nativeNavigator } satisfies OidcRuntime;
};

const localToken = async (): Promise<string> => {
  const cached = window.sessionStorage.getItem(LOCAL_TOKEN_KEY);
  const expiry = Number(window.sessionStorage.getItem(LOCAL_TOKEN_EXPIRY_KEY) ?? 0);
  if (cached && Number.isFinite(expiry) && expiry > Date.now() + 30_000) return cached;

  const response = await fetch(`${API_BASE_URL}/api/v1/auth/dev-token`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`Local authentication failed (${response.status})`);
  const body = await response.json() as DevTokenResponse;
  if (!body.accessToken || !Number.isFinite(body.expiresIn)) {
    throw new Error('Local authentication returned an invalid token');
  }
  window.sessionStorage.setItem(LOCAL_TOKEN_KEY, body.accessToken);
  window.sessionStorage.setItem(LOCAL_TOKEN_EXPIRY_KEY, String(Date.now() + body.expiresIn * 1_000));
  return body.accessToken;
};

const consentStatus = async (token: string): Promise<boolean> => {
  const response = await fetch(`${API_BASE_URL}/api/v1/account/consent`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`정책 동의 상태를 확인하지 못했습니다. (${response.status})`);
  const body = await response.json() as { accepted?: boolean };
  return body.accepted === true;
};

export function AuthProvider({ children }: PropsWithChildren) {
  const oidc = useMemo(createOidcManager, []);
  const manager = oidc?.manager ?? null;
  const [status, setStatus] = useState<AuthStatus>(isTest ? 'authenticated' : 'loading');
  const [user, setUser] = useState<User | null>(null);
  const [message, setMessage] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);

  useEffect(() => {
    if (isTest) {
      setAccessTokenProvider(async () => null);
      return;
    }

    let active = true;
    const initialize = async () => {
      try {
        if (authMode() === 'local') {
          const token = await localToken();
          if (!active) return;
          setAccessTokenProvider(async () => localToken());
          setStatus(await consentStatus(token) ? 'authenticated' : 'consent');
          return;
        }
        if (!manager) {
          throw new Error('운영 OIDC 설정(VITE_OIDC_AUTHORITY, VITE_OIDC_CLIENT_ID)이 필요합니다.');
        }
        let authenticatedUser: User | null;
        if (window.location.pathname === '/auth/callback') {
          authenticatedUser = await manager.signinRedirectCallback(window.location.href);
          window.history.replaceState({}, '', '/today');
        } else if (window.location.pathname === '/auth/silent-callback') {
          await manager.signinSilentCallback(window.location.href);
          return;
        } else {
          authenticatedUser = await manager.getUser();
        }
        if (!active) return;
        if (authenticatedUser && !authenticatedUser.expired) {
          setUser(authenticatedUser);
          setAccessTokenProvider(async () => {
            const current = await manager.getUser();
            return current && !current.expired ? current.access_token : null;
          });
          setStatus(await consentStatus(authenticatedUser.access_token) ? 'authenticated' : 'consent');
        } else {
          setAccessTokenProvider(async () => null);
          setStatus('anonymous');
        }
      } catch (error) {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : '로그인 초기화에 실패했습니다.');
        setStatus('error');
      }
    };
    void initialize();

    if (manager) {
      const onLoaded = (nextUser: User) => {
        setUser(nextUser);
        setAccessTokenProvider(async () => nextUser.access_token);
        void consentStatus(nextUser.access_token)
          .then((accepted) => setStatus(accepted ? 'authenticated' : 'consent'))
          .catch((error: unknown) => {
            setMessage(error instanceof Error ? error.message : '정책 동의 상태를 확인하지 못했습니다.');
            setStatus('error');
          });
      };
      const onUnloaded = () => {
        setUser(null);
        setAccessTokenProvider(async () => null);
        setStatus('anonymous');
      };
      manager.events.addUserLoaded(onLoaded);
      manager.events.addUserUnloaded(onUnloaded);
      return () => {
        active = false;
        manager.events.removeUserLoaded(onLoaded);
        manager.events.removeUserUnloaded(onUnloaded);
      };
    }
    return () => { active = false; };
  }, [manager]);

  const login = useCallback(async () => {
    if (authMode() === 'local') {
      const token = await localToken();
      setAccessTokenProvider(async () => localToken());
      setStatus(await consentStatus(token) ? 'authenticated' : 'consent');
      return;
    }
    if (!manager) return;
    await manager.signinRedirect({ state: { returnTo: window.location.pathname }, max_age: 900 });
    if (oidc?.nativeNavigator) {
      const authenticatedUser = await manager.signinRedirectCallback(oidc.nativeNavigator.consumeCallbackUrl());
      setUser(authenticatedUser);
      setAccessTokenProvider(async () => authenticatedUser.access_token);
      setStatus(await consentStatus(authenticatedUser.access_token) ? 'authenticated' : 'consent');
    }
  }, [manager, oidc]);

  const logout = useCallback(async () => {
    if (authMode() === 'local') {
      window.sessionStorage.removeItem(LOCAL_TOKEN_KEY);
      window.sessionStorage.removeItem(LOCAL_TOKEN_EXPIRY_KEY);
      setAccessTokenProvider(async () => null);
      setStatus('anonymous');
      return;
    }
    if (manager) {
      await manager.signoutRedirect();
      if (oidc?.nativeNavigator) {
        await manager.signoutRedirectCallback(oidc.nativeNavigator.consumeCallbackUrl());
        setUser(null);
        setAccessTokenProvider(async () => null);
        setStatus('anonymous');
      }
    }
  }, [manager, oidc]);

  const value = useMemo<AuthContextValue>(() => ({ status, user, login, logout }), [login, logout, status, user]);

  const acceptPolicies = async () => {
    if (!termsAccepted || !privacyAccepted) return;
    setConsentBusy(true);
    setMessage('');
    try {
      const token = await (authMode() === 'local' ? localToken() : manager?.getUser().then((current) => current?.access_token));
      if (!token) throw new Error('로그인 정보가 만료되었습니다. 다시 로그인해 주세요.');
      const response = await fetch(`${API_BASE_URL}/api/v1/account/consent`, {
        method: 'PUT',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ termsAccepted: true, privacyAccepted: true })
      });
      if (!response.ok) throw new Error('정책 동의를 저장하지 못했습니다.');
      setStatus('authenticated');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '정책 동의를 저장하지 못했습니다.');
    } finally {
      setConsentBusy(false);
    }
  };

  if (status === 'loading') {
    return <main className="auth-page"><div className="auth-card" role="status">로그인 상태를 확인하고 있습니다…</div></main>;
  }
  if (status === 'consent') {
    return (
      <main className="auth-page">
        <section className="auth-card auth-card--consent" aria-labelledby="consent-title">
          <div className="auth-mark"><ShieldCheck size={22} aria-hidden="true" /></div>
          <p className="eyebrow">NOWLINE · 처음 한 번만 확인</p>
          <h1 id="consent-title">내 계획을 안전하게 관리하기 위한 동의</h1>
          <p>계획·실행 기록의 저장과 Google 캘린더·알림 연동에 필요한 범위만 처리합니다.</p>
          <label className="consent-check"><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} /> <span><Link to="/terms" target="_blank">이용약관</Link>에 동의합니다. (필수)</span></label>
          <label className="consent-check"><input type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} /> <span><Link to="/privacy" target="_blank">개인정보 처리방침</Link>에 동의합니다. (필수)</span></label>
          {message && <p className="auth-error" role="alert">{message}</p>}
          <button className="primary-button auth-button" type="button" disabled={consentBusy || !termsAccepted || !privacyAccepted} onClick={() => void acceptPolicies()}>
            동의하고 시작하기
          </button>
          <button className="button button--ghost" type="button" disabled={consentBusy} onClick={() => void logout()}>동의하지 않고 로그아웃</button>
        </section>
      </main>
    );
  }
  if (status === 'anonymous' || status === 'error') {
    return (
      <main className="auth-page">
        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-mark"><ShieldCheck size={22} aria-hidden="true" /></div>
          <p className="eyebrow">NOWLINE</p>
          <h1 id="auth-title">계획을 실행으로 연결하세요</h1>
          <p>로그인하면 웹과 앱에서 같은 목표, 일정, 실행 기록을 안전하게 이어갈 수 있습니다.</p>
          {message && <p className="auth-error" role="alert">{message}</p>}
          <button className="primary-button auth-button" type="button" onClick={() => void login()} disabled={authMode() !== 'local' && !manager}>
            <LogIn size={18} aria-hidden="true" /> 로그인
          </button>
          <p className="auth-legal"><Link to="/privacy">개인정보 처리방침</Link><span aria-hidden="true"> · </span><Link to="/terms">이용약관</Link></p>
        </section>
      </main>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
