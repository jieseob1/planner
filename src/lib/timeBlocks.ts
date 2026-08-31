import type { DayKey, TimeBlock } from '../domain/types';

export interface TimeBlockSlot {
  day: DayKey;
  startMinutes: number;
  durationMinutes: number;
  weekOffset?: number;
}

export interface ConflictOptions {
  ignoreBlockId?: string;
  ignoreTaskId?: string;
}

export const normalizeWeekOffset = (value: number | undefined): number => (
  typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0
);

export const isValidTimeBlockSlot = (slot: TimeBlockSlot): boolean => (
  Number.isFinite(slot.startMinutes)
  && Number.isFinite(slot.durationMinutes)
  && slot.startMinutes >= 0
  && slot.durationMinutes > 0
  && slot.startMinutes + slot.durationMinutes <= 24 * 60
);

export const timeRangesOverlap = (
  firstStartMinutes: number,
  firstDurationMinutes: number,
  secondStartMinutes: number,
  secondDurationMinutes: number
): boolean => {
  const firstEnd = firstStartMinutes + firstDurationMinutes;
  const secondEnd = secondStartMinutes + secondDurationMinutes;
  return firstStartMinutes < secondEnd && secondStartMinutes < firstEnd;
};

/**
 * Finds the first block occupying the same week, day, and minute range.
 * Old blocks without weekOffset are intentionally treated as week zero.
 */
export const findTimeBlockConflict = (
  blocks: readonly TimeBlock[],
  candidate: TimeBlockSlot,
  options: ConflictOptions = {}
): TimeBlock | null => {
  if (!isValidTimeBlockSlot(candidate)) return null;
  const candidateWeek = normalizeWeekOffset(candidate.weekOffset);

  return blocks.find((block) => {
    if (options.ignoreBlockId && block.id === options.ignoreBlockId) return false;
    if (options.ignoreTaskId && block.taskId === options.ignoreTaskId) return false;
    if (normalizeWeekOffset(block.weekOffset) !== candidateWeek || block.day !== candidate.day) return false;
    return timeRangesOverlap(
      block.startMinutes,
      block.durationMinutes,
      candidate.startMinutes,
      candidate.durationMinutes
    );
  }) ?? null;
};

export const hasTimeBlockConflict = (
  blocks: readonly TimeBlock[],
  candidate: TimeBlockSlot,
  options: ConflictOptions = {}
): boolean => findTimeBlockConflict(blocks, candidate, options) !== null;
