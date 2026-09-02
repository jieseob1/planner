import { describe, expect, it } from 'vitest';
import {
  addLocalDateDays,
  formatInstantInTimeZone,
  getDateForDay,
  getDayKeyForDate,
  getMinuteOfDay,
  getToday,
  getWeekDays,
  getWeekOffsetForDate,
  getWeekStartDate,
  isInstantOnLocalDate,
  isInstantWithinLocalDateRange,
  isLocalDate,
  toLocalDate
} from './calendarDate';

describe('account-timezone calendar dates', () => {
  it('uses the requested IANA timezone across a UTC date and week boundary', () => {
    const instant = new Date('2026-09-06T23:30:00.000Z');

    expect(toLocalDate(instant, 'Asia/Seoul')).toBe('2026-09-07');
    expect(toLocalDate(instant, 'America/Los_Angeles')).toBe('2026-09-06');
    expect(getToday(instant, 'Asia/Seoul')).toMatchObject({ key: 'mon', index: 0, isoDate: '2026-09-07' });
    expect(getToday(instant, 'America/Los_Angeles')).toMatchObject({ key: 'sun', index: 6, isoDate: '2026-09-06' });
    expect(getWeekDays(0, instant, 'Asia/Seoul').map((day) => day.isoDate)).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13'
    ]);
    expect(getWeekDays(0, instant, 'America/Los_Angeles')[0].isoDate).toBe('2026-08-31');
  });

  it('keeps plain-date arithmetic stable through spring-forward and fall-back DST', () => {
    expect(addLocalDateDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addLocalDateDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(getWeekStartDate('2026-03-08')).toBe('2026-03-02');
    expect(getDateForDay('mon', 1, new Date('2026-03-08T16:00:00.000Z'), 'America/New_York'))
      .toBe('2026-03-09');
    expect(getWeekOffsetForDate('2026-03-09', new Date('2026-03-08T16:00:00.000Z'), 'America/New_York'))
      .toBe(1);
  });

  it('reads skipped and repeated wall-clock hours without changing their local date', () => {
    const springBefore = new Date('2026-03-08T06:30:00.000Z');
    const springAfter = new Date('2026-03-08T07:30:00.000Z');
    const fallFirst = new Date('2026-11-01T05:30:00.000Z');
    const fallSecond = new Date('2026-11-01T06:30:00.000Z');

    expect(getMinuteOfDay(springBefore, 'America/New_York')).toBe(90);
    expect(getMinuteOfDay(springAfter, 'America/New_York')).toBe(210);
    expect(toLocalDate(springBefore, 'America/New_York')).toBe('2026-03-08');
    expect(toLocalDate(springAfter, 'America/New_York')).toBe('2026-03-08');
    expect(getMinuteOfDay(fallFirst, 'America/New_York')).toBe(90);
    expect(getMinuteOfDay(fallSecond, 'America/New_York')).toBe(90);
    expect(toLocalDate(fallFirst, 'America/New_York')).toBe('2026-11-01');
    expect(toLocalDate(fallSecond, 'America/New_York')).toBe('2026-11-01');
  });

  it('assigns execution instants to the account date and inclusive date range', () => {
    const instant = '2026-09-02T15:30:00.000Z';

    expect(isInstantOnLocalDate(instant, '2026-09-03', 'Asia/Seoul')).toBe(true);
    expect(isInstantOnLocalDate(instant, '2026-09-02', 'America/Los_Angeles')).toBe(true);
    expect(isInstantWithinLocalDateRange(instant, '2026-09-03', '2026-09-06', 'Asia/Seoul')).toBe(true);
    expect(isInstantWithinLocalDateRange(instant, '2026-08-24', '2026-09-02', 'Asia/Seoul')).toBe(false);
    const formatted = formatInstantInTimeZone(instant, 'Asia/Seoul', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }, 'en-CA');
    expect(formatted).toContain('2026');
    expect(formatted).toContain('00:30');
  });

  it('validates calendar dates and weekdays independently of the host timezone', () => {
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2026-02-29')).toBe(false);
    expect(getDayKeyForDate('2026-09-07')).toBe('mon');
  });
});
