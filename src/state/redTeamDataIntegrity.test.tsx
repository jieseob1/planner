import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlannerApiClient } from '../api/plannerApi';
import { createDemoSnapshot } from '../data/demo';
import type { TimeBlock, TimeEntry } from '../domain/types';
import { getDateForDay, getWeekDays, toLocalDate } from '../lib/calendarDate';
import {
  getBlocksForDate,
  getLoggedSecondsForDate,
  getNextScheduledBlock
} from '../screens/TodayScreen';
import { isActualToday } from '../screens/PlannerScreen';
import {
  getPlannerStorageKeys,
  loadInitialPlannerState,
  normalizePlannerSnapshot
} from './PlannerProvider';

describe('red-team data integrity regressions', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('isolates snapshots, sync metadata, conflicts, and active-plan state by authenticated subject', () => {
    const first = getPlannerStorageKeys('oidc:https://id.example:user-a');
    const second = getPlannerStorageKeys('oidc:https://id.example:user-b');
    expect(Object.values(first).some((key) => Object.values(second).includes(key))).toBe(false);

    const firstSnapshot = createDemoSnapshot();
    firstSnapshot.plan.annualDirection = 'A 계정의 비공개 계획';
    window.localStorage.setItem(first.snapshot, JSON.stringify(firstSnapshot));
    window.localStorage.setItem(first.syncMetadata, JSON.stringify({
      revision: 7,
      etag: '"planner-user-a-7"',
      acknowledgedSnapshot: JSON.stringify(firstSnapshot)
    }));
    window.localStorage.setItem(first.conflictBackup, '{"account":"a"}');
    window.localStorage.setItem(first.activePlanAbsent, '1');

    const secondState = loadInitialPlannerState('oidc:https://id.example:user-b', false);
    expect(secondState.hasStoredSnapshot).toBe(false);
    expect(secondState.metadata).toBeNull();
    expect(secondState.activePlanAbsent).toBe(false);
    expect(secondState.snapshot.plan.annualDirection).not.toBe('A 계정의 비공개 계획');
  });

  it('adopts legacy browser data only for the explicit local/test migration scope', () => {
    const legacy = createDemoSnapshot();
    legacy.plan.annualDirection = '기존 로컬 계획';
    window.localStorage.setItem('planner.mvp.snapshot.v1', JSON.stringify(legacy));

    expect(loadInitialPlannerState('oidc:https://id.example:user-a').hasStoredSnapshot).toBe(false);
    expect(window.localStorage.getItem('planner.mvp.snapshot.v1')).not.toBeNull();

    const migrated = loadInitialPlannerState('local:development-user');
    const localKeys = getPlannerStorageKeys('local:development-user');
    expect(migrated.hasStoredSnapshot).toBe(true);
    expect(migrated.snapshot.plan.annualDirection).toBe('기존 로컬 계획');
    expect(window.localStorage.getItem(localKeys.snapshot)).not.toBeNull();
    expect(window.localStorage.getItem('planner.mvp.snapshot.v1')).toBeNull();
  });

  it('migrates relative legacy blocks once and preserves their absolute date across week boundaries', () => {
    const legacy = createDemoSnapshot() as unknown as {
      timeBlocks: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    legacy.timeBlocks = [{
      id: 'legacy-sunday',
      taskId: null,
      title: '다음 주 일요일 일정',
      day: 'sun',
      startMinutes: 600,
      durationMinutes: 60,
      external: false,
      weekOffset: 1
    }];

    const migrated = normalizePlannerSnapshot(legacy, new Date(2026, 8, 2, 12));
    expect(migrated.timeBlocks[0]).toMatchObject({
      date: '2026-09-13',
      day: 'sun',
      weekOffset: 1
    });

    const oneWeekLater = normalizePlannerSnapshot(migrated, new Date(2026, 8, 9, 12));
    expect(oneWeekLater.timeBlocks[0]).toMatchObject({
      date: '2026-09-13',
      day: 'sun',
      weekOffset: 0
    });
  });

  it('derives calendar dates from the selected week without UTC date drift', () => {
    const now = new Date(2026, 8, 2, 23, 50);
    expect(toLocalDate(now)).toBe('2026-09-02');
    expect(getDateForDay('mon', 0, now)).toBe('2026-08-31');
    expect(getDateForDay('sun', 1, now)).toBe('2026-09-13');
    expect(getWeekDays(0, now).find((day) => day.key === 'wed')?.isoDate).toBe('2026-09-02');
    expect(isActualToday('2026-09-02', '2026-09-02')).toBe(true);
    expect(isActualToday('2026-08-31', '2026-09-02')).toBe(false);
  });

  it('uses only the actual date for Today blocks and execution metrics', () => {
    const blocks: TimeBlock[] = [
      {
        id: 'today', taskId: null, title: '오늘', day: 'wed', date: '2026-09-02',
        startMinutes: 600, durationMinutes: 30, weekOffset: 0
      },
      {
        id: 'other-week', taskId: null, title: '다른 주', day: 'wed', date: '2026-09-09',
        startMinutes: 540, durationMinutes: 30, weekOffset: 0
      }
    ];
    const entries: TimeEntry[] = [
      {
        id: 'today-entry', taskId: 'task', durationSeconds: 600, source: 'manual',
        observedAt: new Date(2026, 8, 2, 10).toISOString()
      },
      {
        id: 'yesterday-entry', taskId: 'task', durationSeconds: 3_600, source: 'manual',
        observedAt: new Date(2026, 8, 1, 10).toISOString()
      }
    ];

    expect(getBlocksForDate(blocks, '2026-09-02').map((block) => block.id)).toEqual(['today']);
    expect(getLoggedSecondsForDate(entries, '2026-09-02')).toBe(600);
  });

  it('selects the currently active or nearest future schedule instead of a past or focus-biased block', () => {
    const blocks: TimeBlock[] = [
      {
        id: 'later-focus', taskId: 'focus', title: '나중 집중', day: 'wed', date: '2026-09-02',
        startMinutes: 900, durationMinutes: 60, weekOffset: 0
      },
      {
        id: 'past', taskId: 'focus', title: '지난 집중', day: 'wed', date: '2026-09-02',
        startMinutes: 480, durationMinutes: 30, weekOffset: 0
      },
      {
        id: 'current', taskId: null, title: '현재 일정', day: 'wed', date: '2026-09-02',
        startMinutes: 600, durationMinutes: 60, weekOffset: 0
      }
    ];

    expect(getNextScheduledBlock(blocks, 630)?.id).toBe('current');
    expect(getNextScheduledBlock(blocks, 660)?.id).toBe('later-focus');
    expect(getNextScheduledBlock(blocks, 1_000)).toBeUndefined();
  });

  it('sends the server-issued subject-aware ETag for update and delete preconditions', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ revision: 8, snapshot: createDemoSnapshot() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ETag: '"planner-subject-a-8"' }
      });
    });
    const client = createPlannerApiClient({ fetchImpl, accessTokenProvider: async () => 'token' });
    const etag = '"planner-subject-a-7"';

    await client.put(createDemoSnapshot(), 7, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', etag);
    await client.delete(8, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '"planner-subject-a-8"');

    expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get('If-Match')).toBe(etag);
    expect(new Headers(fetchImpl.mock.calls[1][1]?.headers).get('If-Match'))
      .toBe('"planner-subject-a-8"');
  });
});
