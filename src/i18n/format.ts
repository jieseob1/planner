import { getIntlLocale, getLanguage } from './index';

/** Format a civil calendar date without shifting it into a different time zone. */
export function formatDateOnly(date: string, options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const value = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(value.getTime()) ? new Intl.DateTimeFormat(getIntlLocale(), { ...options, timeZone: 'UTC' }).format(value) : date;
}
export const formatDateRange = (start: string, end: string) => {
  if (getLanguage() === 'ko') return `${formatDateOnly(start, { month: 'long', day: 'numeric' })} – ${formatDateOnly(end, { month: 'long', day: 'numeric' })}`;
  const formatter = new Intl.DateTimeFormat(getIntlLocale(), { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return formatter.formatRange(new Date(`${start}T12:00:00Z`), new Date(`${end}T12:00:00Z`));
};
