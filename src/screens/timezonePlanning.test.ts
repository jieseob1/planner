import { describe, expect, it } from 'vitest';
import { createEmptySnapshot } from '../data/empty';
import type { TimeEntry } from '../domain/types';
import { buildSlots, isSlotInPast } from './OnboardingScreen';
import { getReviewWeekPeriod } from './ReviewScreen';
import { getLoggedSecondsForDate } from './TodayScreen';

describe('timezone-aware planning screen logic', () => {
  it('starts an empty plan in the account-local year and quarter', () => {
    const boundary = new Date('2026-12-31T18:30:00.000Z');

    expect(createEmptySnapshot('Asia/Seoul', boundary).plan).toMatchObject({ year: 2027, quarter: 1 });
    expect(createEmptySnapshot('America/Los_Angeles', boundary).plan).toMatchObject({ year: 2026, quarter: 4 });
  });

  it('counts a UTC execution entry on the account-local Today date', () => {
    const entries: TimeEntry[] = [{
      id: 'entry-midnight-boundary',
      taskId: 'task-1',
      durationSeconds: 1800,
      source: 'manual',
      observedAt: '2026-09-02T15:30:00.000Z'
    }];

    expect(getLoggedSecondsForDate(entries, '2026-09-03', 'Asia/Seoul')).toBe(1800);
    expect(getLoggedSecondsForDate(entries, '2026-09-02', 'Asia/Seoul')).toBe(0);
    expect(getLoggedSecondsForDate(entries, '2026-09-02', 'America/Los_Angeles')).toBe(1800);
  });

  it('builds onboarding choices from the account date rather than the device date', () => {
    const boundary = new Date('2026-09-06T23:30:00.000Z');
    const seoulSlots = buildSlots(boundary, 'Asia/Seoul');
    const losAngelesSlots = buildSlots(boundary, 'America/Los_Angeles');

    expect(seoulSlots[0]).toMatchObject({ label: '오늘 저녁', day: 'mon', weekOffset: 0 });
    expect(losAngelesSlots[0]).toMatchObject({ label: '오늘 저녁', day: 'sun', weekOffset: 0 });
    expect(losAngelesSlots[1]).toMatchObject({ label: '내일 아침', day: 'mon', weekOffset: 1 });
    expect(isSlotInPast({ day: 'mon', weekOffset: 0, startMinutes: 8 * 60 }, boundary, 'Asia/Seoul'))
      .toBe(true);
    expect(isSlotInPast({ day: 'mon', weekOffset: 0, startMinutes: 9 * 60 }, boundary, 'Asia/Seoul'))
      .toBe(false);
  });

  it('opens the weekly review on the account-local Monday across a UTC week boundary', () => {
    const boundary = new Date('2026-09-06T23:30:00.000Z');

    expect(getReviewWeekPeriod(boundary, 'Asia/Seoul')).toMatchObject({
      startDate: '2026-09-07',
      endDate: '2026-09-14',
      label: '9월 7일—9월 13일'
    });
    expect(getReviewWeekPeriod(boundary, 'America/Los_Angeles')).toMatchObject({
      startDate: '2026-08-31',
      endDate: '2026-09-07',
      label: '8월 31일—9월 6일'
    });
  });
});
