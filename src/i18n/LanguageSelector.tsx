import { Globe2 } from 'lucide-react';
import { languageNames, languages, setLanguage, tr, useLocale, type Language } from './index';
import './language.css';

export function LanguageSelector() {
  const language = useLocale();
  return <label className="language-selector"><Globe2 size={16} aria-hidden="true" />
    <span className="sr-only">{tr('language')}</span>
    <select aria-label={tr('language')} value={language} onChange={event => setLanguage(event.target.value as Language)}>
      {languages.map(value => <option key={value} value={value} lang={value}>{languageNames[value]}</option>)}
    </select>
  </label>;
}
