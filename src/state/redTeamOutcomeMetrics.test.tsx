import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../data/demo';
import { createEmptySnapshot } from '../data/empty';
import type { Outcome, PlannerSnapshot, Task, TimeEntry } from '../domain/types';
import {
  applyOutcomeLifecycle,
  applyOnboardingPayload,
  appendOutcomeMetricHistory,
  deriveOutcomeActualHours,
  deriveOutcomeAttention,
  deriveLastUpdatedDays,
  getPlannerStorageKeys,
  getServerAcknowledgementKey,
  loadInitialPlannerState,
  normalizePlannerSnapshot,
  reconcileSnapshotReferences,
  incrementExplicitCarryCount
} from './PlannerProvider';

const outcome = (patch: Partial<Outcome> = {}): Outcome => ({
  id: 'outcome-a',
  title: '관리 결과',
  parentTitle: '분기 목표',
  current: 2,
  target: 10,
  unit: '건',
  confidence: 'medium',
  lastUpdatedDays: 90,
  metricUpdatedAt: '2026-09-01T03:00:00.000Z',
  nextCheckDate: '2026-09-09',
  metricHistory: [],
  actualHours: 99,
  neededHours: 10,
  availableHours: 12,
  evidenceLabel: '운영 대시보드 확인',
  changeLabel: '지난 갱신 대비 +2건',
  attention: 'stale',
  ...patch
});

describe('red-team outcome metric remediation', () => {
  beforeEach(() => window.localStorage.clear());

  it('derives actual hours only from entries of tasks linked to each outcome', () => {
    const tasks: Task[] = [
      { id: 'task-a', title: 'A', outcomeId: 'outcome-a', estimateMinutes: 30, status: 'todo', pinned: false, carryCount: 0 },
      { id: 'task-b', title: 'B', outcomeId: 'outcome-a', estimateMinutes: 30, status: 'done', pinned: false, carryCount: 0 },
      { id: 'task-free', title: '독립', outcomeId: null, estimateMinutes: 30, status: 'todo', pinned: false, carryCount: 0 }
    ];
    const entries: TimeEntry[] = [
      { id: 'one', taskId: 'task-a', durationSeconds: 3600, source: 'manual', observedAt: '2026-09-01T00:00:00.000Z' },
      { id: 'two', taskId: 'task-b', durationSeconds: 1800, source: 'timer', observedAt: '2026-09-02T00:00:00.000Z' },
      { id: 'free', taskId: 'task-free', durationSeconds: 7200, source: 'manual', observedAt: '2026-09-02T00:00:00.000Z' },
      { id: 'invalid', taskId: 'task-a', durationSeconds: -30, source: 'manual', observedAt: '2026-09-02T00:00:00.000Z' }
    ];

    expect(deriveOutcomeActualHours([outcome()], tasks, entries)[0].actualHours).toBe(1.5);
  });

  it('derives freshness and attention only from real timestamps and next check dates', () => {
    const now = new Date(2026, 8, 2, 12);
    expect(deriveLastUpdatedDays('2026-09-01T03:00:00.000Z', now)).toBe(1);
    expect(deriveLastUpdatedDays(null, now)).toBeNull();
    expect(deriveOutcomeAttention(outcome(), now)).toBe('none');
    expect(deriveOutcomeAttention(outcome({ metricUpdatedAt: null }), now)).toBe('stale');
    expect(deriveOutcomeAttention(outcome({ nextCheckDate: '2026-09-01' }), now)).toBe('stale');
    expect(deriveOutcomeAttention(outcome({ neededHours: 20, availableHours: 5 }), now)).toBe('time-shortage');
    expect(deriveOutcomeAttention(outcome({ evidenceLabel: '근거 없음' }), now)).toBe('no-evidence');
    expect(deriveOutcomeAttention(outcome({ current: null }), now)).toBe('no-evidence');
    expect(deriveOutcomeAttention(outcome({ current: 0, actualHours: 2 }), now)).toBe('stalled');

    const snapshot = createDemoSnapshot();
    snapshot.outcomes = [outcome({ attention: 'stale', metricUpdatedAt: null, lastUpdatedDays: 90 })];
    snapshot.tasks = [];
    snapshot.timeEntries = [];
    const normalized = normalizePlannerSnapshot(snapshot, now).outcomes[0];
    expect(normalized.attention).toBe('stale');
    expect(normalized.lastUpdatedDays).toBeNull();
    expect(normalized.metricHistory).toEqual([]);
  });

  it('derives freshness, overdue checks, and legacy week dates in the account timezone', () => {
    const freshnessBoundary = new Date('2026-09-02T15:30:00.000Z');
    const recentlyUpdated = outcome({
      metricUpdatedAt: '2026-09-02T14:30:00.000Z',
      nextCheckDate: '2026-09-02'
    });

    expect(deriveLastUpdatedDays(recentlyUpdated.metricUpdatedAt, freshnessBoundary, 'Asia/Seoul')).toBe(1);
    expect(deriveLastUpdatedDays(recentlyUpdated.metricUpdatedAt, freshnessBoundary, 'America/Los_Angeles')).toBe(0);
    expect(deriveOutcomeAttention(recentlyUpdated, freshnessBoundary, 'Asia/Seoul')).toBe('stale');
    expect(deriveOutcomeAttention(recentlyUpdated, freshnessBoundary, 'America/Los_Angeles')).toBe('none');

    const raw = {
      ...createEmptySnapshot(),
      timeBlocks: [{
        id: 'legacy', taskId: null, title: '레거시 일정', day: 'mon', startMinutes: 600,
        durationMinutes: 30, weekOffset: 0
      }]
    };
    const weekBoundary = new Date('2026-09-06T23:30:00.000Z');
    expect(normalizePlannerSnapshot(raw, weekBoundary, 'Asia/Seoul').timeBlocks[0].date).toBe('2026-09-07');
    expect(normalizePlannerSnapshot(raw, weekBoundary, 'America/Los_Angeles').timeBlocks[0].date).toBe('2026-08-31');
  });

  it('keeps or cancels a same-instant block according to the account wall clock', () => {
    const boundary = new Date('2026-09-02T15:30:00.000Z');
    const base = createEmptySnapshot();
    const linkedOutcome = outcome();
    const linkedTask: Task = {
      id: 'linked', title: '연결 작업', outcomeId: linkedOutcome.id,
      estimateMinutes: 60, status: 'todo', pinned: false, carryCount: 0
    };
    const snapshot: PlannerSnapshot = {
      ...base,
      outcomes: [linkedOutcome],
      tasks: [linkedTask],
      timeBlocks: [{
        id: 'morning', taskId: linkedTask.id, title: linkedTask.title, day: 'wed',
        date: '2026-09-02', startMinutes: 480, durationMinutes: 60, weekOffset: 0
      }]
    };

    expect(applyOutcomeLifecycle(snapshot, linkedOutcome.id, 'stop', 'cancel', boundary, 'Asia/Seoul').timeBlocks)
      .toHaveLength(1);
    expect(applyOutcomeLifecycle(snapshot, linkedOutcome.id, 'stop', 'cancel', boundary, 'America/Los_Angeles').timeBlocks)
      .toHaveLength(0);
  });

  it('appends immutable metric observations with their real time and evidence', () => {
    const first = appendOutcomeMetricHistory(
      outcome({ current: null, metricUpdatedAt: null, metricHistory: [] }),
      3,
      '결제 대시보드 확인',
      new Date('2026-09-02T03:00:00.000Z')
    );
    const second = appendOutcomeMetricHistory(
      first,
      4,
      '결제 완료 내역 4건',
      new Date('2026-09-03T03:00:00.000Z')
    );

    expect(second.metricUpdatedAt).toBe('2026-09-03T03:00:00.000Z');
    expect(second.metricHistory).toHaveLength(2);
    expect(second.metricHistory.map((entry) => ({ value: entry.value, evidence: entry.evidence }))).toEqual([
      { value: 3, evidence: '결제 대시보드 확인' },
      { value: 4, evidence: '결제 완료 내역 4건' }
    ]);
    expect(first.metricHistory).toHaveLength(1);
  });

  it('keeps rapid metric observations strictly monotonic', () => {
    const observedAt = new Date('2026-09-02T03:00:00.000Z');
    const first = appendOutcomeMetricHistory(
      outcome({ metricHistory: [] }),
      3,
      '첫 확인',
      observedAt
    );
    const second = appendOutcomeMetricHistory(first, 4, '연속 확인', observedAt);

    expect(second.metricHistory.map((entry) => entry.observedAt)).toEqual([
      '2026-09-02T03:00:00.000Z',
      '2026-09-02T03:00:00.001Z'
    ]);
  });

  it('increments carry count only for the explicit successful carryover flag', () => {
    const tasks: Task[] = [
      { id: 'carry', title: '이월', outcomeId: null, estimateMinutes: 30, status: 'todo', pinned: false, carryCount: 2 }
    ];
    expect(incrementExplicitCarryCount(tasks, 'carry', false)[0].carryCount).toBe(2);
    expect(incrementExplicitCarryCount(tasks, 'carry', true)[0].carryCount).toBe(3);
    expect(tasks[0].carryCount).toBe(2);
  });

  it('keeps a legacy server normalization pending across a browser restart', () => {
    const raw = structuredClone(createDemoSnapshot()) as unknown as {
      timeBlocks: Array<Record<string, unknown>>;
    };
    raw.timeBlocks = raw.timeBlocks.map(({ date: _date, ...block }) => block);
    const rawSnapshot = raw as unknown as PlannerSnapshot;
    const normalized = normalizePlannerSnapshot(rawSnapshot, new Date(2026, 8, 2, 12));
    const rawAcknowledgement = getServerAcknowledgementKey(rawSnapshot);
    expect(rawAcknowledgement).not.toBe(JSON.stringify(normalized));

    const subject = 'oidc:https://id.example:user-a';
    const keys = getPlannerStorageKeys(subject);
    window.localStorage.setItem(keys.snapshot, JSON.stringify(normalized));
    window.localStorage.setItem(keys.syncMetadata, JSON.stringify({
      revision: 3,
      etag: '"planner-subject-3"',
      acknowledgedSnapshot: rawAcknowledgement
    }));

    const restarted = loadInitialPlannerState(subject, false);
    expect(JSON.stringify(restarted.snapshot)).not.toBe(restarted.metadata?.acknowledgedSnapshot);
  });

  it('repairs mixed conflict sections without discarding either side referenced data', () => {
    const base = createEmptySnapshot();
    const localOutcome = outcome({ id: 'local-outcome' });
    const localTask: Task = { id: 'local-task', title: '로컬 작업', outcomeId: localOutcome.id, estimateMinutes: 30, status: 'todo', pinned: false, carryCount: 0 };
    const serverOutcome = outcome({ id: 'server-outcome', title: '서버 결과' });
    const serverTask: Task = { id: 'server-task', title: '서버 작업', outcomeId: serverOutcome.id, estimateMinutes: 40, status: 'todo', pinned: false, carryCount: 0 };
    const local: PlannerSnapshot = {
      ...base,
      outcomes: [localOutcome],
      tasks: [localTask],
      timeEntries: [{ id: 'local-entry', taskId: localTask.id, durationSeconds: 600, source: 'manual', observedAt: '2026-09-02T00:00:00.000Z' }]
    };
    const server: PlannerSnapshot = {
      ...base,
      outcomes: [serverOutcome],
      tasks: [serverTask],
      timeBlocks: [{ id: 'server-block', taskId: serverTask.id, title: serverTask.title, day: 'wed', date: '2026-09-02', startMinutes: 600, durationMinutes: 40 }]
    };
    const mixed: PlannerSnapshot = {
      ...base,
      outcomes: local.outcomes,
      tasks: local.tasks,
      timeBlocks: server.timeBlocks,
      timeEntries: local.timeEntries
    };

    const repaired = reconcileSnapshotReferences(mixed, local, server);
    expect(repaired.tasks.map((task) => task.id)).toEqual(['local-task', 'server-task']);
    expect(repaired.outcomes.map((item) => item.id)).toEqual(['local-outcome', 'server-outcome']);
    expect(repaired.timeBlocks.map((block) => block.id)).toEqual(['server-block']);
    expect(repaired.timeEntries.map((entry) => entry.id)).toEqual(['local-entry']);
    expect(repaired.tasks.every((task) => (
      task.outcomeId === null || repaired.outcomes.some((item) => item.id === task.outcomeId)
    ))).toBe(true);
  });

  it('starts with no managed outcome and optionally only an independent Todo', () => {
    const payload = {
      outcomeTitle: '',
      taskTitle: '',
      slot: 'today-evening' as const,
      estimateMinutes: 30,
      day: 'wed' as const,
      startMinutes: null,
      weekOffset: 0
    };
    const empty = applyOnboardingPayload(createEmptySnapshot(), payload);
    expect(empty.outcomes).toEqual([]);
    expect(empty.tasks).toEqual([]);
    expect(empty.timeBlocks).toEqual([]);

    const todoOnly = applyOnboardingPayload(createEmptySnapshot(), { ...payload, taskTitle: '자유 할 일' });
    expect(todoOnly.outcomes).toEqual([]);
    expect(todoOnly.tasks).toHaveLength(1);
    expect(todoOnly.tasks[0]).toMatchObject({ title: '자유 할 일', outcomeId: null });
    expect(todoOnly.timeBlocks).toEqual([]);
  });
});
