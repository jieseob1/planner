import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import type { StateStore } from 'oidc-client-ts';

/**
 * Keeps authorization codes, refresh tokens and OIDC transaction state out of
 * WebView storage. Native implementations use Keychain/Keystore through the
 * Capacitor secure-storage plugin.
 */
export class SecureStateStore implements StateStore {
  private readonly ready: Promise<void>;

  constructor(prefix = 'nowline_oidc_') {
    this.ready = SecureStorage.setKeyPrefix(prefix);
  }

  async set(key: string, value: string): Promise<void> {
    await this.ready;
    await SecureStorage.setItem(key, value);
  }

  async get(key: string): Promise<string | null> {
    await this.ready;
    return SecureStorage.getItem(key);
  }

  async remove(key: string): Promise<string | null> {
    await this.ready;
    const previous = await SecureStorage.getItem(key);
    await SecureStorage.removeItem(key);
    return previous;
  }

  async getAllKeys(): Promise<string[]> {
    await this.ready;
    return SecureStorage.keys();
  }
}
