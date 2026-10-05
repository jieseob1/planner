# Internationalization

The application supports Korean (`ko`), English (`en`) and Spanish (`es`). The language menu is available before login and in the app header and Settings. Browser language is used initially, with English as the fallback. An explicit device choice takes priority over account defaults and persists across reloads; another tab’s choice updates open screens without remounting forms. The account language can be saved separately in Settings. Its endpoint updates only locale, preserving time-zone and reminder preferences.

Dates and numbers use `Intl`; civil calendar dates are formatted in UTC to avoid shifting the selected day. Timeline clock inputs remain unambiguous 24-hour `HH:mm`, including `24:00` at midnight. Locale does not change IDs, enum values, civil dates, time zones, revisions, synchronization or any user-authored content. Existing saved AI reports and reflections are never rewritten. New AI evidence snapshots capture the account language; the output-language instruction uses an allowlist. Reminder copy uses the current account language when dispatched.

Keycloak supports all three languages and receives `ui_locales` from the client. Localized install manifests share the same app identity and start URL. Existing screenshot assets and user-provided content retain their original language.

## Maintaining copy

- Application copy uses `tr()` and render-time `useLocale()` subscriptions. Do not translate task titles, goal names, notes or evidence supplied by users. Do not calculate translated labels at module initialization; use a factory or render-time expression.
- `src/i18n/source.json` is an append-only list of source messages. Keep its existing order stable. `translations.tsv` stores each index, English and Spanish separated by tabs; use `\\n` for line breaks. Preserve every `{{variable}}` in all languages.
- Run `node scripts/build-i18n-catalog.mjs` after changing the TSV. `npm run verify:i18n` checks compiled catalogs, interpolation parity and unlocalized application copy and runs as part of release CI.
- `common.ts` contains semantic keys and plural forms; `validation.ts` contains trusted diagnostic translations. Raw validation allowlists in `state/saveProblem.ts` deliberately remain unchanged so rejected values and arbitrary server text are not exposed.
- Regression coverage includes all three languages, draft retention, civil dates, exact existing block durations, real backend task/time-block writes, language-only preference updates, reloads, 320px Spanish layouts and localized login/registration.

Verification commands: `npm run verify:release`, `npm run verify:backend`, `npm run verify:production:e2e`, and `node scripts/verify-login-theme.mjs` (Docker required for server/login checks).
