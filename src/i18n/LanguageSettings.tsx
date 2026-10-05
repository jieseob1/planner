import { useState } from 'react';
import { accountApi } from '../api/accountApi';
import { FocusAlert } from '../components/FocusAlert';
import { LanguageSelector } from './LanguageSelector';
import { getIntlLocale, tr, useLocale } from './index';

export function LanguageSettings() {
  useLocale();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<'languageSaved' | 'languageSaveFailed' | null>(null);
  const save = async () => {
    if (busy) return;
    setBusy(true); setNotice(null);
    try { await accountApi.saveLanguage(getIntlLocale()); setNotice('languageSaved'); }
    catch { setNotice('languageSaveFailed'); }
    finally { setBusy(false); }
  };
  return <section className="settings-card language-settings" aria-labelledby="language-title">
    <h2 id="language-title">{tr('languageTitle')}</h2><p>{tr('languageHelp')}</p>
    <LanguageSelector /> <button className="button button--secondary" disabled={busy} onClick={() => void save()} type="button">{busy ? tr('저장 중…') : tr('saveAccountLanguage')}</button>
    {notice === 'languageSaveFailed' ? <FocusAlert message={tr(notice)} /> : notice && <p role="status">{tr(notice)}</p>}
  </section>;
}
