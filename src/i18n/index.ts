import i18next from 'i18next';
import { useSyncExternalStore } from 'react';
import source from './source.json';
import english from './en.json';
import spanish from './es.json';
import { common } from './common';
import { validationCatalog } from './validation';
import { headingCatalog } from './headings';

export const languages = ['ko', 'en', 'es'] as const;
export type Language = typeof languages[number];
export const LANGUAGE_STORAGE_KEY = 'gtt.language.v1';
export const languageNames: Record<Language, string> = { ko: '한국어', en: 'English', es: 'Español' };
export const intlLocales: Record<Language, string> = { ko: 'ko-KR', en: 'en-US', es: 'es-ES' };

export function supportedLanguage(value: unknown): Language | null {
  if (typeof value !== 'string') return null;
  const primary = value.toLowerCase().split(/[-_]/)[0];
  return languages.includes(primary as Language) ? primary as Language : null;
}

export function detectLanguage(storage?: Pick<Storage, 'getItem'>, preferred: readonly string[] = []): Language {
  try { const stored = supportedLanguage(storage?.getItem(LANGUAGE_STORAGE_KEY)); if (stored) return stored; } catch { /* Storage can be disabled. */ }
  for (const preference of preferred) { const language = supportedLanguage(preference); if (language) return language; }
  return 'en';
}

function browserStorage(): Storage | undefined { try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return undefined; } }
const initialLanguage = import.meta.env.MODE === 'test' ? 'ko' : detectLanguage(browserStorage(), typeof navigator === 'undefined' ? [] : navigator.languages);
const resources = {
  ko: { translation: { ...Object.fromEntries(source.map(key => [key, key])), ...validationCatalog('ko'), ...headingCatalog('ko'), ...common.ko } },
  en: { translation: { ...Object.fromEntries(source.map((key, index) => [key, english[index]])), ...validationCatalog('en'), ...headingCatalog('en'), ...common.en } },
  es: { translation: { ...Object.fromEntries(source.map((key, index) => [key, spanish[index]])), ...validationCatalog('es'), ...headingCatalog('es'), ...common.es } }
};
export const i18n = i18next.createInstance();
void i18n.init({ resources, lng: initialLanguage, fallbackLng: 'en', supportedLngs: [...languages],
  initAsync: false, keySeparator: false, nsSeparator: false,
  interpolation: { escapeValue: false, skipOnVariables: true }, returnEmptyString: true
});
export const getLanguage = (): Language => supportedLanguage(i18n.language) ?? 'en';
export const getIntlLocale = () => intlLocales[getLanguage()];
export const tr = (key: string, values?: Record<string, unknown>) => String(i18n.t(key, { ...values, defaultValue: key }));
export const formatNumber = (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(getIntlLocale(), options).format(value);
/** Only server-owned diagnostics pass through here; never apply to user content. */
export function localizeApiDetail(detail: string, fallback: string) {
  if (i18n.exists(detail)) return tr(detail);
  return getLanguage() !== 'ko' && /[가-힣]/.test(detail) ? fallback : detail;
}

function updateDocument() {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = getLanguage();
    document.title = tr('documentTitle');
    const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (manifest) manifest.href = getLanguage() === 'ko' ? '/manifest.webmanifest' : `/manifest-${getLanguage()}.webmanifest`;
  }
}
i18n.on('languageChanged', updateDocument);
updateDocument();
const subscribe = (listener: () => void) => { i18n.on('languageChanged', listener); return () => { i18n.off('languageChanged', listener); }; };
/** Subscribe without remounting forms, restarting auth or reloading planner data. */
export const useLocale = () => useSyncExternalStore(subscribe, getLanguage, getLanguage);

export function setLanguage(language: Language, persist = true) {
  if (!languages.includes(language)) return;
  if (persist) { try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language); } catch { /* The current session still changes. */ } }
  void i18n.changeLanguage(language);
}

export function applyAccountLanguage(locale: string) {
  // Explicit device choices take precedence; a different account cannot reset open drafts.
  try { if (browserStorage()?.getItem(LANGUAGE_STORAGE_KEY)) return; } catch { return; }
  const language = supportedLanguage(locale);
  if (language) setLanguage(language, false);
}

// Another tab's language choice is a presentation change, never a planner mutation.
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key !== LANGUAGE_STORAGE_KEY) return;
  const language = supportedLanguage(event.newValue);
  if (language) setLanguage(language, false);
});
