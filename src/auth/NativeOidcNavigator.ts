import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import type { INavigator, IWindow, NavigateParams, NavigateResponse } from 'oidc-client-ts';

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1_000;

/**
 * Runs OIDC in the OS browser and accepts only the app's registered callback
 * URLs. oidc-client-ts still performs state, nonce and PKCE verification.
 */
export class NativeOidcNavigator implements INavigator {
  private callbackUrl: string | null = null;

  constructor(private readonly allowedCallbacks: string[]) {}

  async prepare(): Promise<IWindow> {
    this.callbackUrl = null;
    return {
      navigate: (params) => this.navigate(params),
      close: () => { void Browser.close(); }
    };
  }

  async callback(): Promise<void> {
    // The native app receives callbacks through App.appUrlOpen.
  }

  consumeCallbackUrl(): string {
    const value = this.callbackUrl;
    this.callbackUrl = null;
    if (!value) throw new Error('인증 콜백을 받지 못했습니다. 다시 로그인해 주세요.');
    return value;
  }

  private async navigate(params: NavigateParams): Promise<NavigateResponse> {
    const callback = new Promise<string>(async (resolve, reject) => {
      let settled = false;
      const finish = (url: string) => {
        if (settled || !this.isAllowed(url)) return;
        settled = true;
        clearTimeout(timeout);
        void listener.then((handle) => handle.remove());
        resolve(url);
      };
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        void listener.then((handle) => handle.remove());
        reject(new Error('로그인 시간이 초과되었습니다. 다시 시도해 주세요.'));
      }, CALLBACK_TIMEOUT_MS);
      const listener = App.addListener('appUrlOpen', ({ url }) => finish(url));
      try {
        const launch = await App.getLaunchUrl();
        if (launch?.url) finish(launch.url);
      } catch {
        // A warm app normally receives appUrlOpen; launch URL is best effort.
      }
    });

    await Browser.open({ url: params.url, presentationStyle: 'popover' });
    const url = await callback;
    this.callbackUrl = url;
    await Browser.close();
    return { url };
  }

  private isAllowed(url: string): boolean {
    return this.allowedCallbacks.some((allowed) => url.startsWith(allowed));
  }
}
