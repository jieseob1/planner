import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../data/demo';
import { goalProgress, periodRange, shiftPeriod, summarizePeriod, type PeriodGoal } from './periods';

const goal: PeriodGoal = { ...periodRange('week', '2026-09-07'), id: 'goal-a', title: '목표', parentId: null, measurement: 'number', baseline: 10, current: 7, target: 4, unit: '개', done: false, note: '', taskIds: [] };
describe('period goals and reviews', () => {
  it('uses Monday-based weeks across years', () => {
    expect(periodRange('week', '2027-01-01')).toEqual({ period: 'week', startDate: '2026-12-28', endDate: '2027-01-03' });
    expect(shiftPeriod(periodRange('week', '2027-01-01'), 1).startDate).toBe('2027-01-04');
  });
  it('calculates leap days and quarter boundaries without local DST arithmetic', () => {
    expect(periodRange('month', '2024-02-29').endDate).toBe('2024-02-29');
    expect(periodRange('quarter', '2026-10-01').startDate).toBe('2026-10-01');
    expect(shiftPeriod(periodRange('quarter', '2026-10-01'), 1).endDate).toBe('2027-03-31');
    expect(periodRange('year', '2024-02-29').endDate).toBe('2024-12-31');
    expect(() => periodRange('day', '2025-02-29')).toThrow();
  });
  it('supports increasing, decreasing and unmeasured goals independently of tasks or time', () => {
    expect(goalProgress(goal)).toBe(50);
    expect(goalProgress({ ...goal, current: null })).toBeNull();
    expect(goalProgress({ ...goal, baseline: 0, current: 1, target: 2 })).toBe(50);
    expect(goalProgress({ ...goal, current: 2 })).toBe(100);
    expect(goalProgress({ ...goal, measurement: 'completion', done: false })).toBe(0);
    expect(goalProgress({ ...goal, measurement: 'completion', done: true })).toBe(100);
  });
  it('counts checked tasks without a timer, excludes old undated completion and reopened tasks', () => {
    const snapshot = createDemoSnapshot();
    snapshot.timeEntries = [];
    snapshot.timeBlocks = [];
    snapshot.tasks = [
      { ...snapshot.tasks[0], id: 'checked', status: 'done', completedAt: '2026-09-06T15:05:00Z' },
      { ...snapshot.tasks[0], id: 'old', status: 'done' },
      { ...snapshot.tasks[0], id: 'reopened', status: 'todo', completedAt: undefined }
    ];
    expect(summarizePeriod(periodRange('day', '2026-09-07'), [snapshot, snapshot], 'Asia/Seoul')).toMatchObject({ completed: 1, recordedSeconds: 0, undatedCompleted: 1 });
    expect(summarizePeriod(periodRange('day', '2026-09-07'), [snapshot], 'America/Los_Angeles').completed).toBe(0);
  });
  it('deduplicates historical copies and overlapping owned slots, excludes external events', () => {
    const snapshot = createDemoSnapshot();
    const block = { ...snapshot.timeBlocks[0], date: '2026-09-07', external: false, startMinutes: 60, durationMinutes: 60 };
    snapshot.timeBlocks = [block, { ...block, id: 'overlap', startMinutes: 90 }, { ...block, id: 'external', external: true, startMinutes: 600 }];
    snapshot.timeEntries = [{ id: 'entry', taskId: snapshot.tasks[0].id, source: 'manual', observedAt: '2026-09-07T05:00:00Z', durationSeconds: 1200 }];
    expect(summarizePeriod(periodRange('day', '2026-09-07'), [snapshot, snapshot], 'Asia/Seoul')).toMatchObject({ plannedMinutes: 90, recordedSeconds: 1200 });
  });
});
