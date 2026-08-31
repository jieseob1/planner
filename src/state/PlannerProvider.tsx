import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { createDemoSnapshot } from '../data/demo';
import type {
  AddTaskInput,
  DayKey,
  OnboardingPayload,
  Outcome,
  PlanContext,
  PlannerSnapshot,
  SavePlanInput,
  Task,
  TimeBlock,
  TimeEntry,
  TimerSession
} from '../domain/types';
import { findTimeBlockConflict, isValidTimeBlockSlot, normalizeWeekOffset } from '../lib/timeBlocks';

const STORAGE_KEY = 'planner.mvp.snapshot.v1';

export type SaveStatus = 'saved' | 'saving' | 'offline' | 'retry';

export interface PlannerContextValue extends PlannerSnapshot {
  saveStatus: SaveStatus;
  isOnline: boolean;
  quickCapture: (title: string) => void;
  addTask: (input: AddTaskInput) => string;
  savePlan: (input: SavePlanInput) => void;
  setPlannerWeekOffset: (offset: number) => void;
  scheduleTask: (
    taskId: string,
    day: DayKey,
    startMinutes: number,
    durationMinutes: number,
    weekOffset?: number
  ) => boolean;
  startTimer: (taskId: string) => void;
  toggleTimer: () => void;
  stopTimer: (completion: 'done' | 'continue', evidence?: string) => void;
  addManualTime: (taskId: string, minutes: number) => string;
  removeTimeEntry: (entryId: string) => void;
  setOutcomeDecision: (outcomeId: string, decision: Outcome['decision']) => void;
  updateOutcomeMetric: (outcomeId: string, current: number) => void;
  updateReview: (patch: Partial<PlannerSnapshot['review']>) => void;
  completeReview: () => void;
  finishOnboarding: (payload: OnboardingPayload) => void;
  resetDemo: () => void;
}

const PlannerContext = createContext<PlannerContextValue | null>(null);

const safeId = (prefix: string) => {
  const token = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${token}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const normalizePlanContext = (value: unknown, fallback: PlanContext): PlanContext => {
  if (!isRecord(value)) return { ...fallback };
  const rawQuarter = value.quarter;
  const quarter = typeof rawQuarter === 'number' && [1, 2, 3, 4].includes(rawQuarter)
    ? rawQuarter as PlanContext['quarter']
    : fallback.quarter;

  return {
    year: typeof value.year === 'number' && Number.isFinite(value.year)
      ? Math.trunc(value.year)
      : fallback.year,
    annualDirection: typeof value.annualDirection === 'string'
      ? value.annualDirection
      : fallback.annualDirection,
    quarter,
    quarterFocus: typeof value.quarterFocus === 'string'
      ? value.quarterFocus
      : fallback.quarterFocus,
    quarterEndDate: typeof value.quarterEndDate === 'string'
      ? value.quarterEndDate
      : fallback.quarterEndDate
  };
};

const normalizeReview = (
  value: unknown,
  fallback: PlannerSnapshot['review']
): PlannerSnapshot['review'] => {
  if (!isRecord(value)) return { ...fallback, selectedTopTaskIds: [...fallback.selectedTopTaskIds] };
  return {
    blocker: typeof value.blocker === 'string' || value.blocker === null
      ? value.blocker
      : fallback.blocker,
    selectedTopTaskIds: Array.isArray(value.selectedTopTaskIds)
      ? value.selectedTopTaskIds.filter((id): id is string => typeof id === 'string')
      : [...fallback.selectedTopTaskIds],
    metricDraft: typeof value.metricDraft === 'string' ? value.metricDraft : fallback.metricDraft,
    completedAt: typeof value.completedAt === 'string' || value.completedAt === null
      ? value.completedAt
      : fallback.completedAt
  };
};

/** Merge missing v1 fields while preserving the user's existing local arrays. */
export const normalizePlannerSnapshot = (value: unknown): PlannerSnapshot => {
  const fallback = createDemoSnapshot();
  if (!isRecord(value) || value.version !== 1) return fallback;

  const timeBlocks = Array.isArray(value.timeBlocks)
    ? value.timeBlocks.filter(isRecord).map((block) => ({
      ...block,
      weekOffset: normalizeWeekOffset(typeof block.weekOffset === 'number' ? block.weekOffset : undefined)
    })) as unknown as TimeBlock[]
    : fallback.timeBlocks;

  return {
    version: 1,
    plan: normalizePlanContext(value.plan, fallback.plan),
    plannerWeekOffset: typeof value.plannerWeekOffset === 'number' && Number.isFinite(value.plannerWeekOffset)
      ? Math.trunc(value.plannerWeekOffset)
      : fallback.plannerWeekOffset,
    tasks: Array.isArray(value.tasks) ? value.tasks as Task[] : fallback.tasks,
    timeBlocks,
    timeEntries: Array.isArray(value.timeEntries) ? value.timeEntries as TimeEntry[] : fallback.timeEntries,
    outcomes: Array.isArray(value.outcomes) ? value.outcomes as Outcome[] : fallback.outcomes,
    timer: value.timer === null || isRecord(value.timer)
      ? value.timer as TimerSession | null
      : fallback.timer,
    review: normalizeReview(value.review, fallback.review)
  };
};

const loadSnapshot = (): PlannerSnapshot => {
  if (typeof window === 'undefined') return createDemoSnapshot();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizePlannerSnapshot(JSON.parse(raw) as unknown) : createDemoSnapshot();
  } catch {
    return createDemoSnapshot();
  }
};

const elapsedSeconds = (timer: TimerSession | null) => {
  if (!timer) return 0;
  if (timer.startedAt === null || timer.paused) return timer.accumulatedSeconds;
  return timer.accumulatedSeconds + Math.max(0, Math.floor((Date.now() - timer.startedAt) / 1000));
};

const isValidPlanInput = ({ plan, outcomePatch }: SavePlanInput) => (
  Number.isFinite(plan.year)
  && [1, 2, 3, 4].includes(plan.quarter)
  && plan.annualDirection.trim().length > 0
  && plan.quarterFocus.trim().length > 0
  && plan.quarterEndDate.trim().length > 0
  && outcomePatch.title.trim().length > 0
  && Number.isFinite(outcomePatch.target)
  && outcomePatch.target > 0
  && Number.isFinite(outcomePatch.neededHours)
  && outcomePatch.neededHours >= 0
  && Number.isFinite(outcomePatch.availableHours)
  && outcomePatch.availableHours >= 0
);

const metricChangeLabel = (outcome: Outcome, current: number) => {
  if (outcome.current === null) return `현재 ${current}${outcome.unit} 확인`;
  const delta = current - outcome.current;
  if (delta === 0) return '지난 갱신 대비 변화 없음';
  return `지난 갱신 대비 ${delta > 0 ? '+' : ''}${delta}${outcome.unit}`;
};

export function PlannerProvider({ children }: PropsWithChildren) {
  const [snapshot, setSnapshot] = useState<PlannerSnapshot>(loadSnapshot);
  const snapshotRef = useRef(snapshot);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');

  const updateSnapshot = useCallback((updater: (current: PlannerSnapshot) => PlannerSnapshot) => {
    const current = snapshotRef.current;
    const next = updater(current);
    if (next !== current) {
      snapshotRef.current = next;
      setSnapshot(next);
    }
    return next;
  }, []);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    setSaveStatus(isOnline ? 'saving' : 'offline');
    const handle = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        setSaveStatus(isOnline ? 'saved' : 'offline');
      } catch {
        setSaveStatus('retry');
      }
    }, 180);
    return () => window.clearTimeout(handle);
  }, [snapshot, isOnline]);

  const addTask = useCallback((input: AddTaskInput): string => {
    const title = input.title.trim();
    const estimateMinutes = Math.round(input.estimateMinutes);
    if (!title || !Number.isFinite(estimateMinutes) || estimateMinutes <= 0) return '';

    const taskId = safeId('task');
    let added = false;
    updateSnapshot((current) => {
      if (input.outcomeId !== null && !current.outcomes.some((outcome) => outcome.id === input.outcomeId)) {
        return current;
      }
      const task: Task = {
        id: taskId,
        title,
        outcomeId: input.outcomeId,
        estimateMinutes,
        status: 'todo',
        pinned: false,
        carryCount: 0
      };
      added = true;
      return { ...current, tasks: [task, ...current.tasks] };
    });
    return added ? taskId : '';
  }, [updateSnapshot]);

  const quickCapture = useCallback((title: string) => {
    addTask({ title, outcomeId: null, estimateMinutes: 25 });
  }, [addTask]);

  const savePlan = useCallback((input: SavePlanInput) => {
    if (!isValidPlanInput(input)) return;
    updateSnapshot((current) => {
      if (!current.outcomes.some((outcome) => outcome.id === input.outcomeId)) return current;
      const plan: PlanContext = {
        ...input.plan,
        year: Math.trunc(input.plan.year),
        annualDirection: input.plan.annualDirection.trim(),
        quarterFocus: input.plan.quarterFocus.trim(),
        quarterEndDate: input.plan.quarterEndDate.trim()
      };
      return {
        ...current,
        plan,
        outcomes: current.outcomes.map((outcome) => outcome.id === input.outcomeId
          ? { ...outcome, ...input.outcomePatch, title: input.outcomePatch.title.trim() }
          : outcome)
      };
    });
  }, [updateSnapshot]);

  const setPlannerWeekOffset = useCallback((offset: number) => {
    if (!Number.isFinite(offset)) return;
    const normalized = Math.trunc(offset);
    updateSnapshot((current) => current.plannerWeekOffset === normalized
      ? current
      : { ...current, plannerWeekOffset: normalized });
  }, [updateSnapshot]);

  const scheduleTask = useCallback((
    taskId: string,
    day: DayKey,
    startMinutes: number,
    durationMinutes: number,
    weekOffset?: number
  ): boolean => {
    let scheduled = false;
    updateSnapshot((current) => {
      const task = current.tasks.find((item) => item.id === taskId);
      if (!task) return current;
      const targetWeek = weekOffset === undefined
        ? current.plannerWeekOffset
        : normalizeWeekOffset(weekOffset);
      const slot = {
        day,
        startMinutes: Math.trunc(startMinutes),
        durationMinutes: Math.round(durationMinutes),
        weekOffset: targetWeek
      };
      if (!isValidTimeBlockSlot(slot)) return current;
      if (findTimeBlockConflict(current.timeBlocks, slot, { ignoreTaskId: taskId })) return current;

      const block: TimeBlock = {
        id: safeId('block'),
        taskId,
        title: task.title,
        ...slot
      };
      scheduled = true;
      return {
        ...current,
        timeBlocks: [
          ...current.timeBlocks.filter((existing) => !(
            existing.taskId === taskId
            && normalizeWeekOffset(existing.weekOffset) === targetWeek
          )),
          block
        ]
      };
    });
    return scheduled;
  }, [updateSnapshot]);

  const startTimer = useCallback((taskId: string) => {
    updateSnapshot((current) => {
      if (!current.tasks.some((task) => task.id === taskId)) return current;
      return {
        ...current,
        timer: { taskId, startedAt: Date.now(), accumulatedSeconds: 0, paused: false },
        tasks: current.tasks.map((task) => task.id === taskId ? { ...task, status: 'in-progress' } : task)
      };
    });
  }, [updateSnapshot]);

  const toggleTimer = useCallback(() => {
    updateSnapshot((current) => {
      if (!current.timer) return current;
      const seconds = elapsedSeconds(current.timer);
      return {
        ...current,
        timer: current.timer.paused
          ? { ...current.timer, startedAt: Date.now(), paused: false }
          : { ...current.timer, startedAt: null, accumulatedSeconds: seconds, paused: true }
      };
    });
  }, [updateSnapshot]);

  const stopTimer = useCallback((completion: 'done' | 'continue', evidence?: string) => {
    updateSnapshot((current) => {
      if (!current.timer) return current;
      const seconds = Math.max(1, elapsedSeconds(current.timer));
      const entry: TimeEntry = {
        id: safeId('entry'),
        taskId: current.timer.taskId,
        durationSeconds: seconds,
        source: 'timer',
        observedAt: new Date().toISOString(),
        evidence: evidence?.trim() || undefined
      };
      return {
        ...current,
        timer: null,
        timeEntries: [entry, ...current.timeEntries],
        tasks: current.tasks.map((task) => task.id === entry.taskId
          ? { ...task, status: completion === 'done' ? 'done' : 'in-progress' }
          : task)
      };
    });
  }, [updateSnapshot]);

  const addManualTime = useCallback((taskId: string, minutes: number): string => {
    if (!Number.isFinite(minutes) || minutes <= 0) return '';
    const entryId = safeId('entry');
    let added = false;
    updateSnapshot((current) => {
      if (!current.tasks.some((task) => task.id === taskId)) return current;
      const entry: TimeEntry = {
        id: entryId,
        taskId,
        durationSeconds: Math.round(minutes * 60),
        source: 'manual',
        observedAt: new Date().toISOString()
      };
      added = true;
      return { ...current, timeEntries: [entry, ...current.timeEntries] };
    });
    return added ? entryId : '';
  }, [updateSnapshot]);

  const removeTimeEntry = useCallback((entryId: string) => {
    updateSnapshot((current) => {
      const timeEntries = current.timeEntries.filter((entry) => entry.id !== entryId);
      return timeEntries.length === current.timeEntries.length ? current : { ...current, timeEntries };
    });
  }, [updateSnapshot]);

  const setOutcomeDecision = useCallback((outcomeId: string, decision: Outcome['decision']) => {
    updateSnapshot((current) => ({
      ...current,
      outcomes: current.outcomes.map((outcome) => outcome.id === outcomeId ? { ...outcome, decision } : outcome)
    }));
  }, [updateSnapshot]);

  const updateOutcomeMetric = useCallback((outcomeId: string, currentValue: number) => {
    if (!Number.isFinite(currentValue) || currentValue < 0) return;
    updateSnapshot((current) => {
      const target = current.outcomes.find((outcome) => outcome.id === outcomeId);
      if (!target) return current;
      return {
        ...current,
        outcomes: current.outcomes.map((outcome) => outcome.id === outcomeId
          ? {
            ...outcome,
            current: currentValue,
            lastUpdatedDays: 0,
            evidenceLabel: '방금 갱신',
            changeLabel: metricChangeLabel(outcome, currentValue),
            attention: outcome.neededHours > outcome.availableHours ? 'time-shortage' : 'none'
          }
          : outcome),
        review: { ...current.review, metricDraft: String(currentValue) }
      };
    });
  }, [updateSnapshot]);

  const updateReview = useCallback((patch: Partial<PlannerSnapshot['review']>) => {
    updateSnapshot((current) => ({ ...current, review: { ...current.review, ...patch } }));
  }, [updateSnapshot]);

  const completeReview = useCallback(() => {
    updateSnapshot((current) => ({
      ...current,
      plannerWeekOffset: 1,
      review: { ...current.review, completedAt: new Date().toISOString() }
    }));
  }, [updateSnapshot]);

  const finishOnboarding = useCallback((payload: OnboardingPayload) => {
    updateSnapshot((current) => {
      const outcomeId = safeId('outcome');
      const taskId = safeId('task');
      const slotMap: Record<OnboardingPayload['slot'], { day: DayKey; startMinutes: number }> = {
        'today-evening': { day: 'mon', startMinutes: 1170 },
        'tomorrow-morning': { day: 'tue', startMinutes: 420 },
        'saturday-morning': { day: 'sat', startMinutes: 600 }
      };
      const slot = slotMap[payload.slot];
      const candidate = {
        ...slot,
        durationMinutes: Math.round(payload.estimateMinutes),
        weekOffset: 0
      };
      const conflict = !isValidTimeBlockSlot(candidate)
        || Boolean(findTimeBlockConflict(current.timeBlocks, candidate));
      const outcome: Outcome = {
        id: outcomeId,
        title: payload.outcomeTitle,
        parentTitle: '새 연간 목표',
        current: null,
        target: 1,
        unit: '결과',
        confidence: 'unknown',
        lastUpdatedDays: null,
        actualHours: 0,
        neededHours: payload.estimateMinutes / 60,
        availableHours: 4,
        evidenceLabel: '첫 점검에서 측정 방식 설정',
        changeLabel: '첫 실행 전',
        attention: 'none'
      };
      const task: Task = {
        id: taskId,
        title: payload.taskTitle,
        outcomeId,
        estimateMinutes: payload.estimateMinutes,
        status: 'todo',
        pinned: true,
        carryCount: 0,
        note: conflict ? '선택한 시간에 기존 일정이 있어 아직 배치되지 않았습니다.' : undefined
      };
      const block: TimeBlock = {
        id: safeId('block'),
        taskId,
        title: payload.taskTitle,
        ...candidate
      };
      return {
        ...current,
        outcomes: [outcome, ...current.outcomes],
        tasks: [task, ...current.tasks],
        timeBlocks: conflict ? current.timeBlocks : [block, ...current.timeBlocks]
      };
    });
  }, [updateSnapshot]);

  const resetDemo = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    updateSnapshot(() => createDemoSnapshot());
  }, [updateSnapshot]);

  const value = useMemo<PlannerContextValue>(() => ({
    ...snapshot,
    saveStatus,
    isOnline,
    quickCapture,
    addTask,
    savePlan,
    setPlannerWeekOffset,
    scheduleTask,
    startTimer,
    toggleTimer,
    stopTimer,
    addManualTime,
    removeTimeEntry,
    setOutcomeDecision,
    updateOutcomeMetric,
    updateReview,
    completeReview,
    finishOnboarding,
    resetDemo
  }), [
    snapshot,
    saveStatus,
    isOnline,
    quickCapture,
    addTask,
    savePlan,
    setPlannerWeekOffset,
    scheduleTask,
    startTimer,
    toggleTimer,
    stopTimer,
    addManualTime,
    removeTimeEntry,
    setOutcomeDecision,
    updateOutcomeMetric,
    updateReview,
    completeReview,
    finishOnboarding,
    resetDemo
  ]);

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export const usePlanner = () => {
  const context = useContext(PlannerContext);
  if (!context) throw new Error('usePlanner must be used inside PlannerProvider');
  return context;
};
