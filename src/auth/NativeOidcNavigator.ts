import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import type { PluginListenerHandle } from '@capacitor/core';
import type { INavigator, IWindow, NavigateParams, NavigateResponse, User, UserManager } from 'oidc-client-ts';

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1_000;

/** Compare the entire route, never a prefix. OIDC still verifies state, nonce and PKCE. */
export function matchesNativeCallback(candidate: string, allowed: string): boolean {
  try {
    const url = new URL(candidate);
    const target = new URL(allowed);
    return !url.username && !url.password && !url.hash
      && url.protocol === target.protocol && url.host === target.host && url.pathname === target.pathname;
  } catch { return false; }
}

export class NativeOidcNavigator implements INavigator {
  private callbackUrl: string | null = null;
  private launchResult?: Promise<User | null | undefined>;
  private cancel?: () => void;

  constructor(private readonly allowedCallbacks: string[]) {}

  async prepare(): Promise<IWindow> {
    this.cancel?.();
    this.callbackUrl = null;
    return {
      navigate: (params) => this.navigate(params),
      close: () => { this.cancel?.(); void Browser.close().catch(() => undefined); }
    };
  }

  async callback(): Promise<void> {
    // The native app receives callbacks through App.appUrlOpen.
  }

  /** Complete persisted PKCE state when the OS cold-started the app with a callback. */
  completeLaunch(manager: Pick<UserManager, 'signinRedirectCallback' | 'signoutRedirectCallback'>): Promise<User | null | undefined> {
    this.launchResult ??= (async () => {
      const launch = await App.getLaunchUrl();
      if (!launch?.url) return undefined;
      if (matchesNativeCallback(launch.url, this.allowedCallbacks[0])) {
        const user = await manager.signinRedirectCallback(launch.url);
        await Browser.close().catch(() => undefined);
        return user;
      }
      if (this.allowedCallbacks[1] && matchesNativeCallback(launch.url, this.allowedCallbacks[1])) {
        await manager.signoutRedirectCallback(launch.url);
        await Browser.close().catch(() => undefined);
        return null;
      }
      return undefined;
    })();
    return this.launchResult;
  }

  consumeCallbackUrl(): string {
    const value = this.callbackUrl;
    this.callbackUrl = null;
    if (!value) throw new Error('인증 콜백을 받지 못했습니다. 다시 로그인해 주세요.');
    return value;
  }

  private async navigate(params: NavigateParams): Promise<NavigateResponse> {
    let listener: PluginListenerHandle | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let resolveCallback!: (url: string) => void;
    let rejectCallback!: (reason: Error) => void;
    const callback = new Promise<string>((resolve, reject) => { resolveCallback = resolve; rejectCallback = reject; });
    void callback.catch(() => undefined);
    this.cancel = () => rejectCallback(new Error('로그인을 취소했습니다. 다시 시도해 주세요.'));
    try {
      listener = await App.addListener('appUrlOpen', ({ url }) => {
        if (this.allowedCallbacks.some((allowed) => matchesNativeCallback(url, allowed))) resolveCallback(url);
      });
      timeout = setTimeout(() => rejectCallback(new Error('로그인 시간이 초과되었습니다. 다시 시도해 주세요.')), CALLBACK_TIMEOUT_MS);
      await Browser.open({ url: params.url, presentationStyle: 'popover' });
      const url = await callback;
      this.callbackUrl = url;
      return { url };
    } finally {
      clearTimeout(timeout);
      this.cancel = undefined;
      await listener?.remove().catch(() => undefined);
      await Browser.close().catch(() => undefined);
    }
  }
}
