import { describe, expect, it } from 'vitest';
import {
  DAY_END_MINUTES,
  DAY_START_MINUTES,
  createDefaultRange,
  getBlockGeometry,
  getConflictDetail,
  getTimelineLanePlacements,
  getOverlapMinutes,
  isValidDayRange,
  moveRange,
  normalizeRange,
  parseClockInput,
  pointerYToDefaultRange,
  pointerYToMinutes,
  pointerYsToRange,
  rangeFromBlock,
  resizeRange,
  resizeRangeBottom,
  resizeRangeTop,
  snapMinutes,
  clampMinutes
} from './dayTimeline';

describe('day timeline minute boundaries', () => {
  it('clamps values to the inclusive 00:00-24:00 boundary', () => {
    expect(clampMinutes(-1)).toBe(DAY_START_MINUTES);
    expect(clampMinutes(735.5)).toBe(735.5);
    expect(clampMinutes(1_441)).toBe(DAY_END_MINUTES);
    expect(clampMinutes(Number.NEGATIVE_INFINITY)).toBe(DAY_START_MINUTES);
    expect(clampMinutes(Number.POSITIVE_INFINITY)).toBe(DAY_END_MINUTES);
    expect(clampMinutes(Number.NaN)).toBe(DAY_START_MINUTES);
  });

  it('snaps to 15-minute slots with explicit floor, nearest, and ceil modes', () => {
    expect(snapMinutes(607, 'floor')).toBe(600);
    expect(snapMinutes(607, 'nearest')).toBe(600);
    expect(snapMinutes(608, 'nearest')).toBe(615);
    expect(snapMinutes(607, 'ceil')).toBe(615);
    expect(snapMinutes(1_439, 'ceil')).toBe(1_440);
    expect(snapMinutes(-20)).toBe(0);
    expect(() => snapMinutes(60, 'nearest', 0)).toThrow(RangeError);
  });

  it('parses direct clock input while reserving 24:00 for end values', () => {
    expect(parseClockInput('0:00')).toBe(0);
    expect(parseClockInput('09:07')).toBe(547);
    expect(parseClockInput(' 23:59 ')).toBe(1_439);
    expect(parseClockInput('24:00')).toBeNull();
    expect(parseClockInput('24:00', true)).toBe(1_440);
    expect(parseClockInput('24:01', true)).toBeNull();
    expect(parseClockInput('23:60', true)).toBeNull();
    expect(parseClockInput('9:5')).toBeNull();
    expect(parseClockInput('09')).toBeNull();
    expect(parseClockInput('noon')).toBeNull();
  });

  it('recognizes only positive, in-day ranges as valid', () => {
    expect(isValidDayRange({ startMinutes: 0, endMinutes: 15 })).toBe(true);
    expect(isValidDayRange({ startMinutes: 1_425, endMinutes: 1_440 })).toBe(true);
    expect(isValidDayRange({ startMinutes: 60, endMinutes: 60 })).toBe(false);
    expect(isValidDayRange({ startMinutes: -1, endMinutes: 15 })).toBe(false);
    expect(isValidDayRange({ startMinutes: 1_425, endMinutes: 1_441 })).toBe(false);
  });
});

describe('day timeline range creation and manipulation', () => {
  it('creates a 30-minute default range on the grid', () => {
    expect(createDefaultRange(607)).toEqual({ startMinutes: 600, endMinutes: 630 });
    expect(createDefaultRange(-10)).toEqual({ startMinutes: 0, endMinutes: 30 });
  });

  it('keeps explicit non-grid Todo estimates while snapping only the start', () => {
    expect(createDefaultRange(607, 25)).toEqual({ startMinutes: 600, endMinutes: 625 });
    expect(createDefaultRange(607, 40)).toEqual({ startMinutes: 600, endMinutes: 640 });
  });

  it('keeps the final 23:45-24:00 slot available instead of overflowing', () => {
    expect(createDefaultRange(1_425)).toEqual({ startMinutes: 1_425, endMinutes: 1_440 });
    expect(createDefaultRange(1_440)).toEqual({ startMinutes: 1_425, endMinutes: 1_440 });
    expect(createDefaultRange(1_430, 60)).toEqual({ startMinutes: 1_425, endMinutes: 1_440 });
  });

  it('normalizes reversed, zero-length, and off-grid ranges', () => {
    expect(normalizeRange({ startMinutes: 61, endMinutes: 61 })).toEqual({
      startMinutes: 60,
      endMinutes: 75
    });
    expect(normalizeRange({ startMinutes: 1_439, endMinutes: 1_400 })).toEqual({
      startMinutes: 1_425,
      endMinutes: 1_440
    });
    expect(normalizeRange({ startMinutes: -10, endMinutes: 1_500 })).toEqual({
      startMinutes: 0,
      endMinutes: 1_440
    });
  });

  it('moves a range on the grid without changing its duration', () => {
    expect(moveRange({ startMinutes: 600, endMinutes: 645 }, 692)).toEqual({
      startMinutes: 690,
      endMinutes: 735
    });
    expect(moveRange({ startMinutes: 600, endMinutes: 645 }, -50)).toEqual({
      startMinutes: 0,
      endMinutes: 45
    });
    expect(moveRange({ startMinutes: 600, endMinutes: 645 }, 1_439)).toEqual({
      startMinutes: 1_395,
      endMinutes: 1_440
    });
    expect(moveRange({ startMinutes: 0, endMinutes: 1_440 }, 600)).toEqual({
      startMinutes: 0,
      endMinutes: 1_440
    });
    expect(moveRange({ startMinutes: 600, endMinutes: 625 }, 692)).toEqual({
      startMinutes: 690,
      endMinutes: 715
    });
    expect(moveRange({ startMinutes: 600, endMinutes: 640 }, 1_439)).toEqual({
      startMinutes: 1_395,
      endMinutes: 1_435
    });
  });

  it('resizes the top edge without crossing the minimum duration', () => {
    expect(resizeRangeTop({ startMinutes: 60, endMinutes: 120 }, 88)).toEqual({
      startMinutes: 90,
      endMinutes: 120
    });
    expect(resizeRangeTop({ startMinutes: 60, endMinutes: 120 }, 119)).toEqual({
      startMinutes: 105,
      endMinutes: 120
    });
    expect(resizeRangeTop({ startMinutes: 60, endMinutes: 120 }, -100)).toEqual({
      startMinutes: 0,
      endMinutes: 120
    });
    expect(resizeRangeTop({ startMinutes: 600, endMinutes: 625 }, 612)).toEqual({
      startMinutes: 600,
      endMinutes: 625
    });
  });

  it('resizes the bottom edge without crossing the minimum duration or midnight', () => {
    expect(resizeRangeBottom({ startMinutes: 60, endMinutes: 120 }, 142)).toEqual({
      startMinutes: 60,
      endMinutes: 135
    });
    expect(resizeRangeBottom({ startMinutes: 60, endMinutes: 120 }, 50)).toEqual({
      startMinutes: 60,
      endMinutes: 75
    });
    expect(resizeRangeBottom({ startMinutes: 60, endMinutes: 120 }, 1_500)).toEqual({
      startMinutes: 60,
      endMinutes: 1_440
    });
    expect(resizeRangeBottom({ startMinutes: 607, endMinutes: 647 }, 702)).toEqual({
      startMinutes: 607,
      endMinutes: 705
    });
  });

  it('supports the shared edge-based resize entry point and larger minimums', () => {
    expect(resizeRange({ startMinutes: 300, endMinutes: 420 }, 'top', 400, 30)).toEqual({
      startMinutes: 390,
      endMinutes: 420
    });
    expect(resizeRange({ startMinutes: 300, endMinutes: 420 }, 'bottom', 310, 30)).toEqual({
      startMinutes: 300,
      endMinutes: 330
    });
    expect(() => resizeRangeBottom({ startMinutes: 0, endMinutes: 30 }, 45, 0)).toThrow(RangeError);
  });
});

describe('pointer conversion and block geometry', () => {
  const bounds = { top: 100, height: 720 };

  it('maps pointer positions to snapped minutes and clamps outside the timeline', () => {
    expect(pointerYToMinutes(100, bounds)).toBe(0);
    expect(pointerYToMinutes(460, bounds)).toBe(720);
    expect(pointerYToMinutes(820, bounds)).toBe(1_440);
    expect(pointerYToMinutes(92, bounds)).toBe(0);
    expect(pointerYToMinutes(900, bounds)).toBe(1_440);
    expect(pointerYToMinutes(407.5, bounds)).toBe(615);
    expect(pointerYToMinutes(407.5, bounds, 'floor')).toBe(615);
  });

  it('creates the default range directly from a pointer position', () => {
    expect(pointerYToDefaultRange(400, bounds)).toEqual({
      startMinutes: 600,
      endMinutes: 630
    });
    expect(pointerYToDefaultRange(820, bounds)).toEqual({
      startMinutes: 1_425,
      endMinutes: 1_440
    });
  });

  it('turns downward and upward drags into the same sorted range', () => {
    expect(pointerYsToRange(400, 445, bounds)).toEqual({
      startMinutes: 600,
      endMinutes: 690
    });
    expect(pointerYsToRange(445, 400, bounds)).toEqual({
      startMinutes: 600,
      endMinutes: 690
    });
  });

  it('gives zero-distance drags a final 15-minute slot at both boundaries', () => {
    expect(pointerYsToRange(100, 100, bounds)).toEqual({ startMinutes: 0, endMinutes: 15 });
    expect(pointerYsToRange(820, 820, bounds)).toEqual({
      startMinutes: 1_425,
      endMinutes: 1_440
    });
  });

  it('rejects unusable timeline measurements', () => {
    expect(() => pointerYToMinutes(100, { top: 0, height: 0 })).toThrow(RangeError);
    expect(() => pointerYToMinutes(100, { top: Number.NaN, height: 100 })).toThrow(RangeError);
    expect(() => getBlockGeometry({ startMinutes: 0, endMinutes: 15 }, -1)).toThrow(RangeError);
  });

  it('calculates exact pixel and percentage geometry for ranges and blocks', () => {
    const hourGeometry = getBlockGeometry({ startMinutes: 360, endMinutes: 420 }, 1_440);
    expect(hourGeometry.topPx).toBe(360);
    expect(hourGeometry.heightPx).toBe(60);
    expect(hourGeometry.topPercent).toBe(25);
    expect(hourGeometry.heightPercent).toBeCloseTo(100 / 24);

    const midnightGeometry = getBlockGeometry({ startMinutes: 1_425, durationMinutes: 30 }, 720);
    expect(midnightGeometry.topPx).toBe(712.5);
    expect(midnightGeometry.heightPx).toBe(7.5);
    expect(midnightGeometry.topPercent).toBeCloseTo(98.95833333333334);
    expect(midnightGeometry.heightPercent).toBeCloseTo(1.0416666666666665);
    expect(rangeFromBlock({ startMinutes: 1_425, durationMinutes: 30 })).toEqual({
      startMinutes: 1_425,
      endMinutes: 1_440
    });
  });
});

describe('timeline overlap details', () => {
  it('does not treat touching edges as a conflict', () => {
    const first = { startMinutes: 60, endMinutes: 120 };
    const second = { startMinutes: 120, durationMinutes: 60 };

    expect(getOverlapMinutes(first, second)).toBe(0);
    expect(getConflictDetail(first, second)).toBeNull();
  });

  it('places overlapping external/local intervals in accessible side-by-side lanes', () => {
    const placements = getTimelineLanePlacements([
      { id: 'local-a', startMinutes: 600, endMinutes: 660 },
      { id: 'google', startMinutes: 630, endMinutes: 690 },
      { id: 'local-b', startMinutes: 660, endMinutes: 720 },
      { id: 'separate', startMinutes: 780, endMinutes: 840 }
    ]);

    expect(placements.get('local-a')).toEqual({ index: 0, count: 2 });
    expect(placements.get('google')).toEqual({ index: 1, count: 2 });
    expect(placements.get('local-b')).toEqual({ index: 0, count: 2 });
    expect(placements.get('separate')).toEqual({ index: 0, count: 1 });
  });

  it('returns the exact intersecting range and duration', () => {
    const first = { startMinutes: 60, endMinutes: 120 };
    const second = { startMinutes: 90, durationMinutes: 60 };

    expect(getOverlapMinutes(first, second)).toBe(30);
    expect(getConflictDetail(first, second)).toEqual({
      startMinutes: 90,
      endMinutes: 120,
      overlapMinutes: 30
    });
  });

  it('handles containment, midnight clipping, and zero-length ranges', () => {
    expect(getOverlapMinutes(
      { startMinutes: 0, endMinutes: 1_440 },
      { startMinutes: 300, durationMinutes: 45 }
    )).toBe(45);
    expect(getConflictDetail(
      { startMinutes: 1_425, endMinutes: 1_440 },
      { startMinutes: 1_430, durationMinutes: 30 }
    )).toEqual({ startMinutes: 1_430, endMinutes: 1_440, overlapMinutes: 10 });
    expect(getOverlapMinutes(
      { startMinutes: 60, endMinutes: 60 },
      { startMinutes: 30, durationMinutes: 60 }
    )).toBe(0);
  });
});
