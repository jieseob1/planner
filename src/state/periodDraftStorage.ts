export const periodDraftStoragePrefix = (subject: string) =>
  `goalstotoday.period-draft.v1:${encodeURIComponent(subject)}:`;

/** Enumerate before deleting, so removing a key cannot shift the next storage index. */
export function getPeriodDraftStorageKeys(subject: string | null): string[] {
  if (!subject || typeof window === 'undefined') return [];
  const prefix = periodDraftStoragePrefix(subject);
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index++) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}
