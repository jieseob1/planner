import { timeRangesOverlap } from './timeBlocks';

export const DAY_START_MINUTES = 0;
export const DAY_END_MINUTES = 24 * 60;
export const TIMELINE_SNAP_MINUTES = 15;
export const MIN_BLOCK_DURATION_MINUTES = 15;
export const DEFAULT_BLOCK_DURATION_MINUTES = 30;

export type SnapMode = 'floor' | 'nearest' | 'ceil';
export type ResizeEdge = 'top' | 'bottom';

export interface DayMinuteRange {
  startMinutes: number;
  endMinutes: number;
}

export interface DayBlockInterval {
  startMinutes: number;
  durationMinutes: number;
}

export interface TimelineBounds {
  top: number;
  height: number;
}

export interface TimelineBlockGeometry {
  topPx: number;
  heightPx: number;
  topPercent: number;
  heightPercent: number;
}

export interface TimelineConflictDetail extends DayMinuteRange {
  overlapMinutes: number;
}

export interface TimelineLaneInput extends DayMinuteRange {
  id: string;
}

export interface TimelineLanePlacement {
  count: number;
  index: number;
}

type RangeLike = DayMinuteRange | DayBlockInterval;

const clamp = (value: number, minimum: number, maximum: number): number => {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) {
    throw new RangeError('Clamp bounds must be finite and ordered.');
  }
  if (Number.isNaN(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
};

const assertPositiveFinite = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number.`);
  }
};

const normalizeMinimumDuration = (value: number): number => {
  assertPositiveFinite(value, 'Minimum duration');
  return clamp(
    Math.ceil(value / TIMELINE_SNAP_MINUTES) * TIMELINE_SNAP_MINUTES,
    MIN_BLOCK_DURATION_MINUTES,
    DAY_END_MINUTES
  );
};

const toClampedRange = (value: RangeLike): DayMinuteRange => {
  const startMinutes = clampMinutes(value.startMinutes);
  const requestedEnd = 'endMinutes' in value
    ? value.endMinutes
    : value.startMinutes + value.durationMinutes;
  const endMinutes = clampMinutes(requestedEnd);
  return {
    startMinutes,
    endMinutes: Math.max(startMinutes, endMinutes)
  };
};

const pointerYToRawMinutes = (pointerY: number, bounds: TimelineBounds): number => {
  if (!Number.isFinite(bounds.top)) {
    throw new RangeError('Timeline top must be finite.');
  }
  assertPositiveFinite(bounds.height, 'Timeline height');

  const safePointerY = Number.isNaN(pointerY) ? bounds.top : pointerY;
  const ratio = clamp((safePointerY - bounds.top) / bounds.height, 0, 1);
  return ratio * DAY_END_MINUTES;
};

/** Clamps a minute value to the inclusive 00:00-24:00 timeline boundary. */
export const clampMinutes = (minutes: number): number => (
  clamp(minutes, DAY_START_MINUTES, DAY_END_MINUTES)
);

/**
 * Snaps a minute value to the timeline grid. Halfway values snap forward.
 * The returned value is always within the inclusive 00:00-24:00 boundary.
 */
export const snapMinutes = (
  minutes: number,
  mode: SnapMode = 'nearest',
  stepMinutes = TIMELINE_SNAP_MINUTES
): number => {
  assertPositiveFinite(stepMinutes, 'Snap step');
  const boundedMinutes = clampMinutes(minutes);
  const ratio = boundedMinutes / stepMinutes;
  const snappedRatio = mode === 'floor'
    ? Math.floor(ratio)
    : mode === 'ceil'
      ? Math.ceil(ratio)
      : Math.round(ratio);
  return clampMinutes(snappedRatio * stepMinutes);
};

/** Parses H:MM or HH:MM. 24:00 is valid only for an explicit end-of-day input. */
export const parseClockInput = (value: string, allowEndOfDay = false): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59) return null;
  if (hours === 24) return allowEndOfDay && minutes === 0 ? DAY_END_MINUTES : null;
  if (hours > 23) return null;
  return hours * 60 + minutes;
};

export const isValidDayRange = (range: DayMinuteRange): boolean => (
  Number.isFinite(range.startMinutes)
  && Number.isFinite(range.endMinutes)
  && range.startMinutes >= DAY_START_MINUTES
  && range.endMinutes <= DAY_END_MINUTES
  && range.endMinutes > range.startMinutes
);

/** Produces a grid-aligned, in-day range with at least the requested minimum duration. */
export const normalizeRange = (
  range: DayMinuteRange,
  minimumDurationMinutes = MIN_BLOCK_DURATION_MINUTES
): DayMinuteRange => {
  const minimumDuration = normalizeMinimumDuration(minimumDurationMinutes);
  let startMinutes = snapMinutes(range.startMinutes);
  let endMinutes = snapMinutes(range.endMinutes);

  if (endMinutes - startMinutes < minimumDuration) {
    if (startMinutes + minimumDuration <= DAY_END_MINUTES) {
      endMinutes = startMinutes + minimumDuration;
    } else {
      endMinutes = DAY_END_MINUTES;
      startMinutes = DAY_END_MINUTES - minimumDuration;
    }
  }

  return { startMinutes, endMinutes };
};

/**
 * Creates the default block at a snapped pointer/clock minute. An explicit
 * duration is preserved (including 25/40-minute Todo estimates). Near midnight
 * the range intentionally shortens, so 23:45 still creates the final slot.
 */
export const createDefaultRange = (
  anchorMinutes: number,
  durationMinutes = DEFAULT_BLOCK_DURATION_MINUTES
): DayMinuteRange => {
  const requestedDuration = Number.isFinite(durationMinutes) && durationMinutes > 0
    ? durationMinutes
    : DEFAULT_BLOCK_DURATION_MINUTES;
  const duration = clamp(requestedDuration, MIN_BLOCK_DURATION_MINUTES, DAY_END_MINUTES);
  const startMinutes = Math.min(
    snapMinutes(anchorMinutes),
    DAY_END_MINUTES - MIN_BLOCK_DURATION_MINUTES
  );
  const endMinutes = Math.min(DAY_END_MINUTES, startMinutes + duration);
  return { startMinutes, endMinutes };
};

/** Moves a block to a snapped start while preserving its exact valid duration. */
export const moveRange = (
  range: DayMinuteRange,
  nextStartMinutes: number
): DayMinuteRange => {
  const clampedRange = toClampedRange(range);
  const exactDuration = clampedRange.endMinutes - clampedRange.startMinutes;
  const durationMinutes = exactDuration >= MIN_BLOCK_DURATION_MINUTES
    ? exactDuration
    : MIN_BLOCK_DURATION_MINUTES;
  const latestSnappedStart = snapMinutes(DAY_END_MINUTES - durationMinutes, 'floor');
  const startMinutes = clamp(
    snapMinutes(nextStartMinutes),
    DAY_START_MINUTES,
    latestSnappedStart
  );
  return { startMinutes, endMinutes: startMinutes + durationMinutes };
};

/** Resizes the start edge while keeping the end fixed and enforcing a 15-minute minimum. */
export const resizeRangeTop = (
  range: DayMinuteRange,
  nextStartMinutes: number,
  minimumDurationMinutes = MIN_BLOCK_DURATION_MINUTES
): DayMinuteRange => {
  const minimumDuration = normalizeMinimumDuration(minimumDurationMinutes);
  const clampedRange = toClampedRange(range);
  const fixedRange = clampedRange.endMinutes - clampedRange.startMinutes >= minimumDuration
    ? clampedRange
    : normalizeRange(range, minimumDuration);
  const latestSnappedStart = snapMinutes(fixedRange.endMinutes - minimumDuration, 'floor');
  const startMinutes = clamp(
    snapMinutes(nextStartMinutes),
    DAY_START_MINUTES,
    latestSnappedStart
  );
  return { startMinutes, endMinutes: fixedRange.endMinutes };
};

/** Resizes the end edge while keeping the start fixed and enforcing a 15-minute minimum. */
export const resizeRangeBottom = (
  range: DayMinuteRange,
  nextEndMinutes: number,
  minimumDurationMinutes = MIN_BLOCK_DURATION_MINUTES
): DayMinuteRange => {
  const minimumDuration = normalizeMinimumDuration(minimumDurationMinutes);
  const clampedRange = toClampedRange(range);
  const fixedRange = clampedRange.endMinutes - clampedRange.startMinutes >= minimumDuration
    ? clampedRange
    : normalizeRange(range, minimumDuration);
  const earliestSnappedEnd = snapMinutes(fixedRange.startMinutes + minimumDuration, 'ceil');
  const endMinutes = clamp(
    snapMinutes(nextEndMinutes),
    earliestSnappedEnd,
    DAY_END_MINUTES
  );
  return { startMinutes: fixedRange.startMinutes, endMinutes };
};

export const resizeRange = (
  range: DayMinuteRange,
  edge: ResizeEdge,
  nextMinutes: number,
  minimumDurationMinutes = MIN_BLOCK_DURATION_MINUTES
): DayMinuteRange => edge === 'top'
  ? resizeRangeTop(range, nextMinutes, minimumDurationMinutes)
  : resizeRangeBottom(range, nextMinutes, minimumDurationMinutes);

/** Converts a client/pointer Y coordinate into a clamped and snapped day minute. */
export const pointerYToMinutes = (
  pointerY: number,
  bounds: TimelineBounds,
  mode: SnapMode = 'nearest'
): number => snapMinutes(pointerYToRawMinutes(pointerY, bounds), mode);

export const pointerYToDefaultRange = (
  pointerY: number,
  bounds: TimelineBounds,
  durationMinutes = DEFAULT_BLOCK_DURATION_MINUTES
): DayMinuteRange => createDefaultRange(
  pointerYToMinutes(pointerY, bounds),
  durationMinutes
);

/** Converts a drag's two Y positions into a sorted, grid-aligned selection. */
export const pointerYsToRange = (
  anchorY: number,
  pointerY: number,
  bounds: TimelineBounds,
  minimumDurationMinutes = MIN_BLOCK_DURATION_MINUTES
): DayMinuteRange => {
  const minimumDuration = normalizeMinimumDuration(minimumDurationMinutes);
  const anchorMinutes = pointerYToRawMinutes(anchorY, bounds);
  const pointerMinutes = pointerYToRawMinutes(pointerY, bounds);
  const startMinutes = snapMinutes(Math.min(anchorMinutes, pointerMinutes), 'floor');
  const endMinutes = snapMinutes(Math.max(anchorMinutes, pointerMinutes), 'ceil');
  return normalizeRange({ startMinutes, endMinutes }, minimumDuration);
};

export const rangeFromBlock = (block: DayBlockInterval): DayMinuteRange => (
  toClampedRange(block)
);

/** Returns both pixel and percentage geometry relative to the timeline's top. */
export const getBlockGeometry = (
  rangeOrBlock: RangeLike,
  timelineHeightPx: number
): TimelineBlockGeometry => {
  assertPositiveFinite(timelineHeightPx, 'Timeline height');
  const range = toClampedRange(rangeOrBlock);
  const durationMinutes = range.endMinutes - range.startMinutes;
  const topPercent = range.startMinutes / DAY_END_MINUTES * 100;
  const heightPercent = durationMinutes / DAY_END_MINUTES * 100;
  return {
    topPx: range.startMinutes / DAY_END_MINUTES * timelineHeightPx,
    heightPx: durationMinutes / DAY_END_MINUTES * timelineHeightPx,
    topPercent,
    heightPercent
  };
};

/** Exact overlap duration; touching edges are not a conflict. */
export const getOverlapMinutes = (first: RangeLike, second: RangeLike): number => {
  const firstRange = toClampedRange(first);
  const secondRange = toClampedRange(second);
  const firstDuration = firstRange.endMinutes - firstRange.startMinutes;
  const secondDuration = secondRange.endMinutes - secondRange.startMinutes;

  if (firstDuration <= 0 || secondDuration <= 0 || !timeRangesOverlap(
    firstRange.startMinutes,
    firstDuration,
    secondRange.startMinutes,
    secondDuration
  )) {
    return 0;
  }

  return Math.min(firstRange.endMinutes, secondRange.endMinutes)
    - Math.max(firstRange.startMinutes, secondRange.startMinutes);
};

export const getConflictDetail = (
  first: RangeLike,
  second: RangeLike
): TimelineConflictDetail | null => {
  const overlapMinutes = getOverlapMinutes(first, second);
  if (overlapMinutes === 0) return null;

  const firstRange = toClampedRange(first);
  const secondRange = toClampedRange(second);
  const startMinutes = Math.max(firstRange.startMinutes, secondRange.startMinutes);
  return {
    startMinutes,
    endMinutes: startMinutes + overlapMinutes,
    overlapMinutes
  };
};

/**
 * Places overlapping intervals into side-by-side lanes. Touching edges reuse a
 * lane, and every item in one connected overlap group receives the same count.
 */
export const getTimelineLanePlacements = (
  intervals: readonly TimelineLaneInput[]
): Map<string, TimelineLanePlacement> => {
  const placements = new Map<string, TimelineLanePlacement>();
  const ordered = intervals
    .map((interval) => ({ ...interval, ...toClampedRange(interval) }))
    .filter((interval) => interval.endMinutes > interval.startMinutes)
    .sort((left, right) => (
      left.startMinutes - right.startMinutes
      || left.endMinutes - right.endMinutes
      || left.id.localeCompare(right.id)
    ));
  let group: typeof ordered = [];
  let groupEnd = DAY_START_MINUTES;

  const placeGroup = () => {
    if (group.length === 0) return;
    const laneEnds: number[] = [];
    const drafts = group.map((interval) => {
      let index = laneEnds.findIndex((endMinutes) => endMinutes <= interval.startMinutes);
      if (index === -1) index = laneEnds.length;
      laneEnds[index] = interval.endMinutes;
      return { id: interval.id, index };
    });
    for (const draft of drafts) placements.set(draft.id, { index: draft.index, count: laneEnds.length });
    group = [];
  };

  for (const interval of ordered) {
    if (group.length > 0 && interval.startMinutes >= groupEnd) placeGroup();
    group.push(interval);
    groupEnd = group.length === 1 ? interval.endMinutes : Math.max(groupEnd, interval.endMinutes);
  }
  placeGroup();
  return placements;
};
