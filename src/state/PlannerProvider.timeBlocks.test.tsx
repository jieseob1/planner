import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { plannerApi } from '../api/plannerApi';
import { createEmptySnapshot } from '../data/empty';
import type { PlannerSnapshot, Task, TimeBlock } from '../domain/types';
import {
  getPlannerStorageKeys,
  PlannerProvider,
  usePlanner
} from './PlannerProvider';

const SUBJECT = 'test:time-block-provider';
const DATE = '2026-08-31';
const TASK: Task = {
  id: 'task-one',
  title: '집중 작업',
  outcomeId: null,
  estimateMinutes: 30,
  status: 'todo',
  pinned: false,
  carryCount: 0
};

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ subject: SUBJECT })
}));

vi.mock('../timezone/TimeZoneProvider', () => ({
  useTimeZone: () => ({ timeZone: 'UTC' })
}));

const timeBlock = (id: string, startMinutes: number, patch: Partial<TimeBlock> = {}): TimeBlock => ({
  id,
  taskId: TASK.id,
  title: TASK.title,
  day: 'mon',
  date: DATE,
  startMinutes,
  durationMinutes: 30,
  weekOffset: 0,
  ...patch
});

const snapshotWith = (timeBlocks: TimeBlock[], tasks: Task[] = [TASK]): PlannerSnapshot => ({
  ...createEmptySnapshot('UTC'),
  tasks,
  timeBlocks
});

const foundSnapshot = (snapshot: PlannerSnapshot, revision = 1) => ({
  kind: 'found' as const,
  aggregate: { revision, snapshot },
  etag: `"${revision}"`
});

const mountProvider = (snapshot: PlannerSnapshot) => {
  window.localStorage.setItem(
    getPlannerStorageKeys(SUBJECT).snapshot,
    JSON.stringify(snapshot)
  );
  return renderHook(() => usePlanner(), {
    wrapper: ({ children }: PropsWithChildren) => (
      <PlannerProvider>{children}</PlannerProvider>
    )
  });
};

describe('PlannerProvider time-block identity semantics', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-02T12:00:00.000Z'));
    window.localStorage.clear();
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('retains multiple blocks for the same Todo on the same date with fresh IDs', () => {
    const { result } = mountProvider(snapshotWith([]));

    act(() => {
      expect(result.current.scheduleTask(TASK.id, 'mon', 540, 30, 0)).toBe(true);
      expect(result.current.scheduleTask(TASK.id, 'mon', 600, 30, 0)).toBe(true);
      expect(result.current.saveTimeBlock({
        taskId: TASK.id,
        title: TASK.title,
        day: 'mon',
        date: DATE,
        startMinutes: 660,
        durationMinutes: 30,
        weekOffset: 0
      })).toBe(true);
    });

    expect(result.current.timeBlocks).toHaveLength(3);
    expect(new Set(result.current.timeBlocks.map((block) => block.id)).size).toBe(3);
    expect(result.current.timeBlocks.every((block) => block.taskId === TASK.id)).toBe(true);
    expect(result.current.timeBlocks.map((block) => block.startMinutes)).toEqual([540, 600, 660]);
  });

  it('edits exactly the TimeBlock selected by ID', () => {
    const first = timeBlock('block-first', 540);
    const second = timeBlock('block-second', 660);
    const { result } = mountProvider(snapshotWith([first, second]));

    act(() => {
      expect(result.current.saveTimeBlock({
        id: first.id,
        taskId: TASK.id,
        title: TASK.title,
        day: 'mon',
        date: DATE,
        startMinutes: 570,
        durationMinutes: 45,
        weekOffset: 0
      })).toBe(true);
    });

    expect(result.current.timeBlocks).toHaveLength(2);
    expect(result.current.timeBlocks.find((block) => block.id === first.id)).toMatchObject({
      startMinutes: 570,
      durationMinutes: 45
    });
    expect(result.current.timeBlocks.find((block) => block.id === second.id)).toEqual(second);
  });

  it('deletes by TimeBlock ID without deleting its Todo or sibling blocks', () => {
    const first = timeBlock('block-first', 540);
    const second = timeBlock('block-second', 660);
    const { result } = mountProvider(snapshotWith([first, second]));

    act(() => {
      expect(result.current.removeTimeBlock(first.id)).toBe(true);
    });

    expect(result.current.tasks).toEqual([TASK]);
    expect(result.current.timeBlocks).toEqual([second]);
  });

  it('restores a just-removed TimeBlock with the same ID and times', () => {
    const removed = timeBlock('block-undo', 540, { durationMinutes: 45 });
    const { result } = mountProvider(snapshotWith([removed]));

    act(() => {
      expect(result.current.removeTimeBlock(removed.id)).toBe(true);
      expect(result.current.restoreTimeBlock(removed)).toBe(true);
    });

    expect(result.current.timeBlocks).toHaveLength(1);
    expect(result.current.timeBlocks[0]).toMatchObject({
      id: removed.id,
      startMinutes: removed.startMinutes,
      durationMinutes: removed.durationMinutes
    });
  });

  it('restores the exact local block when an unchanged Google block already overlapped it', () => {
    const removed = timeBlock('block-undo-overlap', 540, { durationMinutes: 60 });
    const google = timeBlock('block-google', 570, {
      taskId: null,
      title: 'Google 회의',
      durationMinutes: 60,
      external: true
    });
    const { result } = mountProvider(snapshotWith([removed, google]));

    act(() => {
      expect(result.current.removeTimeBlock(removed.id)).toBe(true);
      expect(result.current.restoreTimeBlock(removed)).toBe(true);
    });

    expect(result.current.timeBlocks).toHaveLength(2);
    expect(result.current.timeBlocks.find((block) => block.id === removed.id)).toEqual(removed);
    expect(result.current.timeBlocks.find((block) => block.id === google.id)).toEqual(google);
  });

  it('allows a title-only edit when the local event already overlaps a Google block', () => {
    const localEvent = timeBlock('block-local-event', 540, {
      taskId: null,
      title: '기존 일정',
      durationMinutes: 60
    });
    const google = timeBlock('block-google', 570, {
      taskId: null,
      title: 'Google 회의',
      durationMinutes: 60,
      external: true
    });
    const { result } = mountProvider(snapshotWith([localEvent, google]));

    act(() => {
      expect(result.current.saveTimeBlock({
        id: localEvent.id,
        taskId: null,
        title: '제목을 바꾼 일정',
        day: localEvent.day,
        date: localEvent.date,
        startMinutes: localEvent.startMinutes,
        durationMinutes: localEvent.durationMinutes,
        weekOffset: localEvent.weekOffset
      })).toBe(true);
    });

    expect(result.current.timeBlocks.find((block) => block.id === localEvent.id)).toEqual({
      ...localEvent,
      title: '제목을 바꾼 일정'
    });
    expect(result.current.timeBlocks.find((block) => block.id === google.id)).toEqual(google);
  });

  it('still rejects moving an overlapped local event into a new conflict', () => {
    const localEvent = timeBlock('block-local-event', 540, {
      taskId: null,
      title: '기존 일정',
      durationMinutes: 60
    });
    const google = timeBlock('block-google', 570, {
      taskId: null,
      title: 'Google 회의',
      durationMinutes: 60,
      external: true
    });
    const newConflict = timeBlock('block-new-conflict', 720, {
      taskId: null,
      title: '다른 일정',
      durationMinutes: 60
    });
    const { result } = mountProvider(snapshotWith([localEvent, google, newConflict]));

    act(() => {
      expect(result.current.saveTimeBlock({
        id: localEvent.id,
        taskId: null,
        title: localEvent.title,
        day: localEvent.day,
        date: localEvent.date,
        startMinutes: newConflict.startMinutes,
        durationMinutes: localEvent.durationMinutes,
        weekOffset: localEvent.weekOffset
      })).toBe(false);
    });

    expect(result.current.timeBlocks.find((block) => block.id === localEvent.id)).toEqual(localEvent);
  });

  it('rejects duplicate IDs and expired undo attempts', () => {
    const removed = timeBlock('block-undo', 540);
    const { result } = mountProvider(snapshotWith([removed]));

    act(() => {
      expect(result.current.restoreTimeBlock(removed)).toBe(false);
      expect(result.current.removeTimeBlock(removed.id)).toBe(true);
      vi.advanceTimersByTime(10_001);
      expect(result.current.restoreTimeBlock(removed)).toBe(false);
    });

    expect(result.current.timeBlocks).toHaveLength(0);
  });

  it('rejects undo when the referenced Todo no longer exists', () => {
    const removed = timeBlock('block-undo', 540);
    const { result } = mountProvider(snapshotWith([removed]));

    act(() => {
      expect(result.current.removeTimeBlock(removed.id)).toBe(true);
      expect(result.current.removeTask(TASK.id)).toBe(true);
      expect(result.current.restoreTimeBlock(removed)).toBe(false);
    });

    expect(result.current.timeBlocks).toHaveLength(0);
  });

  it('rejects invalid or external blocks', () => {
    const invalid = timeBlock('block-invalid', 1_430, { durationMinutes: 30 });
    const external = timeBlock('block-external', 540, { external: true });
    const invalidProvider = mountProvider(snapshotWith([invalid]));

    act(() => {
      expect(invalidProvider.result.current.removeTimeBlock(invalid.id)).toBe(true);
      expect(invalidProvider.result.current.restoreTimeBlock(invalid)).toBe(false);
    });
    invalidProvider.unmount();
    window.localStorage.clear();

    const externalProvider = mountProvider(snapshotWith([external]));
    act(() => {
      expect(externalProvider.result.current.removeTimeBlock(external.id)).toBe(false);
      expect(externalProvider.result.current.restoreTimeBlock(external)).toBe(false);
    });
    expect(externalProvider.result.current.timeBlocks).toEqual([external]);
  });

  it('rejects undo when another block now overlaps the removed slot', () => {
    const removed = timeBlock('block-undo', 540);
    const { result } = mountProvider(snapshotWith([removed]));

    act(() => {
      expect(result.current.removeTimeBlock(removed.id)).toBe(true);
      expect(result.current.saveTimeBlock({
        taskId: null,
        title: '새 일정',
        day: 'mon',
        date: DATE,
        startMinutes: 540,
        durationMinutes: 30,
        weekOffset: 0
      })).toBe(true);
      expect(result.current.restoreTimeBlock(removed)).toBe(false);
    });

    expect(result.current.timeBlocks).toHaveLength(1);
    expect(result.current.timeBlocks[0]).toMatchObject({ title: '새 일정' });
  });

  it('keeps an Undo token after a normal server sync acknowledgement', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    const removed = timeBlock('block-sync-undo', 540, {
      taskId: null,
      title: '동기화할 독립 일정'
    });
    const initial = snapshotWith([removed]);
    vi.spyOn(plannerApi, 'get').mockResolvedValue(foundSnapshot(initial));
    const put = vi.spyOn(plannerApi, 'put').mockImplementation(async (nextSnapshot) => ({
      aggregate: { revision: 2, snapshot: nextSnapshot },
      etag: '"2"'
    }));
    const { result } = mountProvider(initial);

    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    act(() => {
      expect(result.current.removeTimeBlock(removed.id)).toBe(true);
      result.current.retrySync();
    });
    await waitFor(() => {
      expect(put).toHaveBeenCalledOnce();
      expect(result.current.saveStatus).toBe('saved');
    });

    act(() => {
      expect(result.current.restoreTimeBlock(removed)).toBe(true);
    });
    expect(result.current.timeBlocks.find((block) => block.id === removed.id)).toEqual(removed);
  });

  it.each(['server', 'merge'] as const)(
    'invalidates an Undo token after explicit %s conflict resolution',
    async (strategy) => {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
      const removed = timeBlock(`block-${strategy}-undo`, 540, {
        taskId: null,
        title: '충돌 전 독립 일정'
      });
      const local = snapshotWith([removed]);
      const server = snapshotWith([]);
      vi.spyOn(plannerApi, 'get').mockResolvedValue(foundSnapshot(server, 7));
      const { result } = mountProvider(local);

      await waitFor(() => expect(result.current.syncConflict).not.toBeNull());
      act(() => {
        expect(result.current.removeTimeBlock(removed.id)).toBe(true);
      });
      act(() => {
        result.current.resolveConflict(strategy);
      });

      expect(result.current.syncConflict).toBeNull();
      act(() => {
        expect(result.current.restoreTimeBlock(removed)).toBe(false);
      });
      expect(result.current.timeBlocks).toHaveLength(0);
    }
  );

  it('keeps an Undo token when explicitly retaining the local conflict version', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    const removed = timeBlock('block-local-undo', 540, {
      taskId: null,
      title: '로컬에 남길 독립 일정'
    });
    const local = snapshotWith([removed]);
    const server = snapshotWith([]);
    vi.spyOn(plannerApi, 'get').mockResolvedValue(foundSnapshot(server, 7));
    const { result } = mountProvider(local);

    await waitFor(() => expect(result.current.syncConflict).not.toBeNull());
    act(() => {
      expect(result.current.removeTimeBlock(removed.id)).toBe(true);
    });
    act(() => {
      result.current.resolveConflict('local');
    });

    act(() => {
      expect(result.current.restoreTimeBlock(removed)).toBe(true);
    });
    expect(result.current.timeBlocks.find((block) => block.id === removed.id)).toEqual(removed);
  });

  it('invalidates an Undo token when the active plan is closed', () => {
    const removed = timeBlock('block-closed-plan-undo', 540, {
      taskId: null,
      title: '종료 전 독립 일정'
    });
    const { result } = mountProvider(snapshotWith([removed]));

    act(() => {
      expect(result.current.removeTimeBlock(removed.id)).toBe(true);
      result.current.markActivePlanClosed();
      expect(result.current.restoreTimeBlock(removed)).toBe(false);
    });

    expect(result.current.timeBlocks).toHaveLength(0);
  });

  it('invalidates an Undo token after a successful planner reset', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    const removed = timeBlock('block-reset-undo', 540, {
      taskId: null,
      title: '초기화 전 독립 일정'
    });
    const initial = snapshotWith([removed]);
    vi.spyOn(plannerApi, 'get').mockResolvedValue(foundSnapshot(initial, 3));
    vi.spyOn(plannerApi, 'delete').mockResolvedValue();
    const { result } = mountProvider(initial);

    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    act(() => {
      expect(result.current.removeTimeBlock(removed.id)).toBe(true);
    });
    let reset = false;
    await act(async () => {
      reset = await result.current.resetPlanner();
    });

    expect(reset).toBe(true);
    act(() => {
      expect(result.current.restoreTimeBlock(removed)).toBe(false);
    });
    expect(result.current.timeBlocks).toHaveLength(0);
  });
});
