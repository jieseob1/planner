import type { DayKey } from '../domain/types';

export const weekDayMeta: Array<{ key: DayKey; short: string; long: string }> = [
  { key: 'mon', short: '월', long: '월요일' },
  { key: 'tue', short: '화', long: '화요일' },
  { key: 'wed', short: '수', long: '수요일' },
  { key: 'thu', short: '목', long: '목요일' },
  { key: 'fri', short: '금', long: '금요일' },
  { key: 'sat', short: '토', long: '토요일' },
  { key: 'sun', short: '일', long: '일요일' }
];

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;
const ISO_LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (value: number) => String(value).padStart(2, '0');

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

export interface ZonedDateTimeParts extends LocalDateParts {
  date: string;
  hours: number;
  minutes: number;
  seconds: number;
  dayKey: DayKey;
  dayIndex: number;
}

const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

export const isValidTimeZone = (timeZone: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
};

export const getDeviceTimeZone = () => {
  const candidate = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return candidate && isValidTimeZone(candidate) ? candidate : 'UTC';
};

const resolveTimeZone = (timeZone?: string) => (
  timeZone && isValidTimeZone(timeZone) ? timeZone : getDeviceTimeZone()
);

const formatterFor = (timeZone?: string) => {
  const resolved = resolveTimeZone(timeZone);
  const cached = dateFormatterCache.get(resolved);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: resolved,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  dateFormatterCache.set(resolved, formatter);
  return formatter;
};

const parseParts = (value: string): LocalDateParts | null => {
  const match = ISO_LOCAL_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const verified = new Date(Date.UTC(year, month - 1, day));
  if (
    verified.getUTCFullYear() !== year
    || verified.getUTCMonth() !== month - 1
    || verified.getUTCDate() !== day
  ) return null;
  return { year, month, day };
};

const dayNumber = (date: string) => {
  const parts = parseParts(date);
  if (!parts) throw new Error(`Invalid local date: ${date}`);
  return Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MILLISECONDS;
};

const dateFromDayNumber = (value: number) => {
  const date = new Date(value * DAY_MILLISECONDS);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

export const getZonedDateTimeParts = (value = new Date(), timeZone?: string): ZonedDateTimeParts => {
  const values = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const date = `${year}-${pad(month)}-${pad(day)}`;
  const dayIndex = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  return {
    year,
    month,
    day,
    date,
    hours: Number(values.hour),
    minutes: Number(values.minute),
    seconds: Number(values.second),
    dayKey: weekDayMeta[dayIndex].key,
    dayIndex
  };
};

export const toLocalDate = (value = new Date(), timeZone?: string) => (
  getZonedDateTimeParts(value, timeZone).date
);

/**
 * Parses a calendar-only value without attaching it to an account timezone.
 * Noon avoids host DST gaps while callers that compare dates use the pure UTC
 * day-number helpers below.
 */
export const parseLocalDate = (value: string): Date | null => {
  const parts = parseParts(value);
  return parts ? new Date(parts.year, parts.month - 1, parts.day, 12) : null;
};

export const isLocalDate = (value: unknown): value is string => (
  typeof value === 'string' && parseParts(value) !== null
);

export const addLocalDateDays = (date: string, days: number) => (
  dateFromDayNumber(dayNumber(date) + Math.trunc(days))
);

export const getDayKeyForDate = (date: string): DayKey => {
  const index = (new Date(dayNumber(date) * DAY_MILLISECONDS).getUTCDay() + 6) % 7;
  return weekDayMeta[index].key;
};

export const getWeekStartDate = (date: string) => {
  const index = weekDayMeta.findIndex((item) => item.key === getDayKeyForDate(date));
  return addLocalDateDays(date, -index);
};

export const getDateForDay = (
  day: DayKey,
  weekOffset: number,
  now = new Date(),
  timeZone?: string
) => {
  const monday = getWeekStartDate(toLocalDate(now, timeZone));
  const dayIndex = weekDayMeta.findIndex((item) => item.key === day);
  return addLocalDateDays(monday, (Math.trunc(weekOffset) * 7) + Math.max(0, dayIndex));
};

export const getWeekOffsetForDate = (date: string, now = new Date(), timeZone?: string) => {
  if (!isLocalDate(date)) return 0;
  const currentMonday = getWeekStartDate(toLocalDate(now, timeZone));
  const targetMonday = getWeekStartDate(date);
  return Math.trunc((dayNumber(targetMonday) - dayNumber(currentMonday)) / 7);
};

export const isInstantOnLocalDate = (instant: string, date: string, timeZone?: string) => {
  const parsed = new Date(instant);
  return !Number.isNaN(parsed.getTime()) && toLocalDate(parsed, timeZone) === date;
};

export const isInstantWithinLocalDateRange = (
  instant: string,
  startDate: string,
  endDate: string,
  timeZone?: string
) => {
  if (!isLocalDate(startDate) || !isLocalDate(endDate)) return false;
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return false;
  const localDate = toLocalDate(parsed, timeZone);
  return localDate >= startDate && localDate <= endDate;
};

export const getMinuteOfDay = (now = new Date(), timeZone?: string) => {
  const parts = getZonedDateTimeParts(now, timeZone);
  return (parts.hours * 60) + parts.minutes;
};

export const formatInstantInTimeZone = (
  value: string | Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  },
  locale = 'ko-KR'
) => {
  const instant = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(instant.getTime())) return typeof value === 'string' ? value : '';
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: resolveTimeZone(timeZone) }).format(instant);
};

export const getWeekDays = (weekOffset: number, now = new Date(), timeZone?: string) => {
  const monday = addLocalDateDays(
    getWeekStartDate(toLocalDate(now, timeZone)),
    Math.trunc(weekOffset) * 7
  );
  return weekDayMeta.map((item, index) => {
    const isoDate = addLocalDateDays(monday, index);
    const parts = parseParts(isoDate) as LocalDateParts;
    return {
      ...item,
      date: String(parts.day),
      month: parts.month,
      isoDate,
      dateValue: parseLocalDate(isoDate) as Date
    };
  });
};

export const getToday = (now = new Date(), timeZone?: string) => {
  const parts = getZonedDateTimeParts(now, timeZone);
  return {
    ...weekDayMeta[parts.dayIndex],
    index: parts.dayIndex,
    month: parts.month,
    date: parts.day,
    isoDate: parts.date
  };
};
