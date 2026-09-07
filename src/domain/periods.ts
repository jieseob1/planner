import { addLocalDateDays, isLocalDate, toLocalDate } from '../lib/calendarDate';
import type { PlannerSnapshot } from './types';

export const periods = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type Period = typeof periods[number];
export const periodLabels: Record<Period, string> = { day: '일', week: '주', month: '월', quarter: '분기', year: '연간' };
export interface PeriodRange { period: Period; startDate: string; endDate: string }
export interface PeriodGoal extends PeriodRange {
  id: string; title: string; parentId: string | null; measurement: 'completion' | 'number';
  baseline: number; current: number | null; target: number; unit: string; done: boolean; note: string; taskIds: string[];
}
export interface PeriodReview extends PeriodRange {
  id: string; well: string; blocked: string; change: string; note: string; completed: boolean;
}
export interface PeriodDocument {
  revision: number; goal: PeriodGoal | null; review: PeriodReview | null; deleted: boolean; updatedAt: string;
  goalCheckpoints?: PeriodGoal[];
}
export interface PeriodWrite {
  expectedRevision: number; mutationId: string; goal: PeriodGoal | null; review: PeriodReview | null; deleted: boolean;
}

const iso = (year: number, month: number, day = 1) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
export function periodRange(period: Period, anchor: string): PeriodRange {
  if (!isLocalDate(anchor)) throw new Error('올바른 날짜를 선택해 주세요.');
  const [year, month] = anchor.split('-').map(Number);
  let startDate = anchor;
  if (period === 'week') startDate = addLocalDateDays(anchor, -((new Date(`${anchor}T12:00:00Z`).getUTCDay() + 6) % 7));
  if (period === 'month') startDate = iso(year, month);
  if (period === 'quarter') startDate = iso(year, Math.floor((month - 1) / 3) * 3 + 1);
  if (period === 'year') startDate = iso(year, 1);
  const endDate = period === 'day' ? startDate : period === 'week' ? addLocalDateDays(startDate, 6)
    : addLocalDateDays(shiftMonthStart(startDate, period === 'month' ? 1 : period === 'quarter' ? 3 : 12), -1);
  return { period, startDate, endDate };
}
function shiftMonthStart(date: string, months: number) {
  const [y, m] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1 + months, 1));
  return iso(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1);
}
export function shiftPeriod(range: PeriodRange, direction: number) {
  return periodRange(range.period, range.period === 'day' || range.period === 'week'
    ? addLocalDateDays(range.startDate, direction * (range.period === 'day' ? 1 : 7))
    : shiftMonthStart(range.startDate, direction * (range.period === 'month' ? 1 : range.period === 'quarter' ? 3 : 12)));
}
export const rangeLabel = (range: PeriodRange) => range.startDate === range.endDate ? range.startDate : `${range.startDate} — ${range.endDate}`;
export const reviewId = (range: PeriodRange) => `review-${range.period}-${range.startDate}`;
export const emptyReview = (range: PeriodRange): PeriodReview => ({ ...range, id: reviewId(range), well: '', blocked: '', change: '', note: '', completed: false });
export function goalProgress(goal: PeriodGoal): number | null {
  if (goal.measurement === 'completion') return goal.done ? 100 : 0;
  if (goal.current === null || goal.target === goal.baseline) return null;
  return Math.min(100, Math.max(0, Math.round((goal.current - goal.baseline) / (goal.target - goal.baseline) * 100)));
}
export const documentId = (document: Pick<PeriodDocument, 'goal' | 'review'>) => document.goal?.id ?? document.review!.id;

/** Historical snapshot copies are deduplicated by stable item IDs; active state wins.
 * Planned time is the union of owned blocks per local date, excluding external events.
 * Legacy entries only carry observedAt, so recorded time is attributed to its recorded date.
 */
export function summarizePeriod(range: PeriodRange, snapshots: readonly Pick<PlannerSnapshot, 'tasks' | 'timeBlocks' | 'timeEntries'>[], timeZone: string) {
  const tasks = new Map(snapshots.flatMap(s => s.tasks).map(t => [t.id, t]));
  const blocks = new Map(snapshots.flatMap(s => s.timeBlocks).map(b => [b.id, b]));
  const entries = new Map(snapshots.flatMap(s => s.timeEntries).map(e => [e.id, e]));
  const within = (date: string) => date >= range.startDate && date <= range.endDate;
  const dates = new Map<string, { plannedMinutes: number; recordedSeconds: number; completed: number }>();
  const at = (date: string) => {
    if (!dates.has(date)) dates.set(date, { plannedMinutes: 0, recordedSeconds: 0, completed: 0 });
    return dates.get(date)!;
  };
  let undatedCompleted = 0;
  for (const task of tasks.values()) {
    if (task.status !== 'done') continue;
    if (!task.completedAt || !Number.isFinite(Date.parse(task.completedAt))) { undatedCompleted++; continue; }
    const date = toLocalDate(new Date(task.completedAt), timeZone);
    if (within(date)) at(date).completed++;
  }
  const intervals = new Map<string, [number, number][]>();
  for (const block of blocks.values()) {
    if (block.external || !isLocalDate(block.date) || !within(block.date)) continue;
    const values = intervals.get(block.date) ?? [];
    values.push([Math.max(0, block.startMinutes), Math.min(1440, block.startMinutes + block.durationMinutes)]);
    intervals.set(block.date, values);
  }
  for (const [date, values] of intervals) {
    let end = 0;
    for (const [start, nextEnd] of values.sort((a, b) => a[0] - b[0])) {
      at(date).plannedMinutes += Math.max(0, nextEnd - Math.max(start, end));
      end = Math.max(end, nextEnd);
    }
  }
  for (const entry of entries.values()) {
    if (!Number.isFinite(Date.parse(entry.observedAt))) continue;
    const date = toLocalDate(new Date(entry.observedAt), timeZone);
    if (within(date)) at(date).recordedSeconds += entry.durationSeconds;
  }
  const total = [...dates.values()].reduce((sum, d) => ({ plannedMinutes: sum.plannedMinutes + d.plannedMinutes, recordedSeconds: sum.recordedSeconds + d.recordedSeconds, completed: sum.completed + d.completed }), { plannedMinutes: 0, recordedSeconds: 0, completed: 0 });
  return { ...total, undatedCompleted, dates: [...dates].sort(([a], [b]) => a.localeCompare(b)) };
}
