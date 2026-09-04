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
import {
  createIdempotencyKey,
  plannerApi,
  PlannerConflictError,
  type PlannerReadResult
} from '../api/plannerApi';
import { createEmptySnapshot } from '../data/empty';
import type {
  AddTaskInput,
  DayKey,
  OnboardingPayload,
  Outcome,
  OutcomeInput,
  OutcomeMetricHistoryEntry,
  LinkedTaskDisposition,
  PlanContext,
  PlannerSnapshot,
  SaveTimeBlockInput,
  SavePlanInput,
  Task,
  TimeBlock,
  TimeEntry,
  TimerSession,
  UpdateTaskInput
} from '../domain/types';
import { useAuth } from '../auth/AuthProvider';
import {
  getDateForDay,
  getDayKeyForDate,
  getMinuteOfDay,
  getWeekOffsetForDate,
  isLocalDate,
  toLocalDate
} from '../lib/calendarDate';
import {
  findTimeBlockConflict,
  isValidTimeBlockSlot,
  normalizeWeekOffset,
  timeRangesOverlap
} from '../lib/timeBlocks';
import { useTimeZone } from '../timezone/TimeZoneProvider';

const LEGACY_STORAGE_KEY = 'planner.mvp.snapshot.v1';
const LEGACY_SYNC_METADATA_KEY = 'planner.mvp.sync.v1';
const LEGACY_CONFLICT_BACKUP_KEY = 'planner.mvp.last-conflict.v1';
const LEGACY_ACTIVE_PLAN_ABSENT_KEY = 'nowline.active-plan.absent.v1';
const SERVER_SYNC_DELAY_MS = 350;
const TIME_BLOCK_UNDO_WINDOW_MS = 10_000;
const toApiDecimal = (value: number) => Number(value.toFixed(6));

export type SaveStatus =
  | 'checking'
  | 'saved'
  | 'saving'
  | 'offline'
  | 'retry'
  | 'conflict'
  | 'storage-error';

export type SnapshotSection = keyof PlannerSnapshot;

export interface SyncConflict {
  base: PlannerSnapshot | null;
  local: PlannerSnapshot;
  server: PlannerSnapshot;
  serverRevision: number;
  serverEtag: string;
  detectedAt: string;
}

export interface PlannerContextValue extends PlannerSnapshot {
  saveStatus: SaveStatus;
  isOnline: boolean;
  plannerReady: boolean;
  hasActivePlan: boolean;
  retrySync: () => void;
  reloadFromServer: () => Promise<boolean>;
  markActivePlanClosed: () => void;
  syncConflict: SyncConflict | null;
  resolveConflict: (
    strategy: 'local' | 'server' | 'merge',
    choices?: Partial<Record<SnapshotSection, 'local' | 'server'>>
  ) => void;
  quickCapture: (title: string) => void;
  addTask: (input: AddTaskInput) => string;
  updateTask: (taskId: string, input: UpdateTaskInput) => boolean;
  removeTask: (taskId: string) => boolean;
  savePlan: (input: SavePlanInput) => void;
  updatePlan: (plan: PlanContext) => boolean;
  addOutcome: (input: OutcomeInput) => string;
  updateOutcome: (outcomeId: string, input: OutcomeInput) => boolean;
  stopOutcome: (outcomeId: string, disposition: LinkedTaskDisposition) => boolean;
  removeOutcome: (outcomeId: string, disposition: LinkedTaskDisposition) => boolean;
  setPlannerWeekOffset: (offset: number) => void;
  scheduleTask: (
    taskId: string,
    day: DayKey,
    startMinutes: number,
    durationMinutes: number,
    weekOffset?: number
  ) => boolean;
  saveTimeBlock: (input: SaveTimeBlockInput) => boolean;
  removeTimeBlock: (blockId: string) => boolean;
  restoreTimeBlock: (block: TimeBlock) => boolean;
  startTimer: (taskId: string) => void;
  toggleTimer: () => void;
  stopTimer: (completion: 'done' | 'continue', evidence?: string) => void;
  addManualTime: (taskId: string, minutes: number) => string;
  removeTimeEntry: (entryId: string) => void;
  setOutcomeDecision: (outcomeId: string, decision: Outcome['decision']) => void;
  updateOutcomeMetric: (outcomeId: string, current: number, evidence: string) => boolean;
  updateReview: (patch: Partial<PlannerSnapshot['review']>) => void;
  completeReview: () => void;
  finishOnboarding: (payload: OnboardingPayload) => void;
  resetPlanner: () => Promise<boolean>;
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

export interface SyncMetadata {
  revision: number;
  etag: string;
  acknowledgedSnapshot: string;
}

export interface PlannerStorageKeys {
  snapshot: string;
  syncMetadata: string;
  conflictBackup: string;
  activePlanAbsent: string;
}

export interface InitialPlannerState {
  snapshot: PlannerSnapshot;
  hasStoredSnapshot: boolean;
  metadata: SyncMetadata | null;
  activePlanAbsent: boolean;
}

interface PendingWrite {
  snapshotKey: string;
  revision: number | null;
  idempotencyKey: string;
}

interface RemovedTimeBlock {
  block: TimeBlock;
  expiresAt: number;
  preExistingOverlaps: Array<Pick<TimeBlock, 'id' | 'date' | 'startMinutes' | 'durationMinutes'>>;
}

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

const isDayKey = (value: unknown): value is DayKey => (
  typeof value === 'string' && ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].includes(value)
);

export const deriveOutcomeActualHours = (
  outcomes: Outcome[],
  tasks: Task[],
  timeEntries: TimeEntry[]
): Outcome[] => {
  const outcomeByTask = new Map(tasks.map((task) => [task.id, task.outcomeId]));
  const secondsByOutcome = new Map<string, number>();
  for (const entry of timeEntries) {
    const outcomeId = outcomeByTask.get(entry.taskId);
    if (!outcomeId || !Number.isFinite(entry.durationSeconds) || entry.durationSeconds <= 0) continue;
    secondsByOutcome.set(outcomeId, (secondsByOutcome.get(outcomeId) ?? 0) + entry.durationSeconds);
  }
  return outcomes.map((outcome) => ({
    ...outcome,
    actualHours: toApiDecimal((secondsByOutcome.get(outcome.id) ?? 0) / 3600)
  }));
};

const localDayNumber = (value: Date, timeZone?: string) => (
  Date.parse(`${toLocalDate(value, timeZone)}T00:00:00.000Z`) / (24 * 60 * 60 * 1_000)
);

export const deriveLastUpdatedDays = (
  metricUpdatedAt: string | null,
  now = new Date(),
  timeZone?: string
): number | null => {
  if (!metricUpdatedAt) return null;
  const updatedAt = new Date(metricUpdatedAt);
  if (!Number.isFinite(updatedAt.getTime())) return null;
  return Math.max(0, Math.trunc(
    localDayNumber(now, timeZone) - localDayNumber(updatedAt, timeZone)
  ));
};

export const deriveOutcomeAttention = (
  outcome: Outcome,
  now = new Date(),
  timeZone?: string
): Outcome['attention'] => {
  if (
    !outcome.evidenceLabel.trim()
    || outcome.evidenceLabel === '근거 입력 전'
    || outcome.evidenceLabel === '근거 없음'
  ) return 'no-evidence';
  if (outcome.current === null) return 'no-evidence';
  const lastUpdatedDays = deriveLastUpdatedDays(outcome.metricUpdatedAt, now, timeZone);
  const nextCheckOverdue = Boolean(
    outcome.nextCheckDate
    && isLocalDate(outcome.nextCheckDate)
    && outcome.nextCheckDate < toLocalDate(now, timeZone)
  );
  if (lastUpdatedDays === null || lastUpdatedDays >= 7 || nextCheckOverdue) return 'stale';
  if (outcome.neededHours > outcome.availableHours) return 'time-shortage';
  if (outcome.actualHours > 0 && outcome.current === 0) return 'stalled';
  return 'none';
};

const withDerivedOutcomeMetrics = (
  snapshot: PlannerSnapshot,
  now = new Date(),
  timeZone?: string
): PlannerSnapshot => {
  const outcomesWithHours = deriveOutcomeActualHours(snapshot.outcomes, snapshot.tasks, snapshot.timeEntries);
  return {
    ...snapshot,
    outcomes: outcomesWithHours.map((outcome) => ({
      ...outcome,
      lastUpdatedDays: deriveLastUpdatedDays(outcome.metricUpdatedAt, now, timeZone),
      attention: deriveOutcomeAttention(outcome, now, timeZone)
    }))
  };
};

const isInstant = (value: unknown): value is string => (
  typeof value === 'string' && Number.isFinite(new Date(value).getTime())
);

const normalizeMetricHistory = (value: unknown): OutcomeMetricHistoryEntry[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((entry) => {
    const metricValue = entry.value;
    if (
      typeof entry.id !== 'string'
      || !entry.id.trim()
      || (metricValue !== null && (typeof metricValue !== 'number' || !Number.isFinite(metricValue) || metricValue < 0))
      || !isInstant(entry.observedAt)
      || typeof entry.evidence !== 'string'
      || !entry.evidence.trim()
    ) return [];
    return [{
      id: entry.id,
      value: metricValue === null ? null : toApiDecimal(metricValue),
      observedAt: entry.observedAt,
      evidence: entry.evidence.trim()
    }];
  });
};

const normalizeOutcome = (value: unknown): Outcome | null => {
  if (!isRecord(value)) return null;
  const metricHistory = normalizeMetricHistory(value.metricHistory);
  return {
    ...(value as unknown as Outcome),
    metricUpdatedAt: isInstant(value.metricUpdatedAt) ? value.metricUpdatedAt : null,
    nextCheckDate: isLocalDate(value.nextCheckDate) ? value.nextCheckDate : null,
    metricHistory
  };
};

/** Merge missing v1 fields while preserving the user's existing local arrays. */
export const normalizePlannerSnapshot = (
  value: unknown,
  now = new Date(),
  timeZone?: string
): PlannerSnapshot => {
  const fallback = createEmptySnapshot(timeZone);
  if (!isRecord(value) || value.version !== 1) return fallback;

  const timeBlocks = Array.isArray(value.timeBlocks)
    ? value.timeBlocks.filter(isRecord).map((block) => {
      const legacyDay = isDayKey(block.day) ? block.day : 'mon';
      const legacyWeekOffset = normalizeWeekOffset(
        typeof block.weekOffset === 'number' ? block.weekOffset : undefined
      );
      const date = isLocalDate(block.date)
        ? block.date
        : getDateForDay(legacyDay, legacyWeekOffset, now, timeZone);
      return {
        ...block,
        date,
        day: getDayKeyForDate(date),
        weekOffset: getWeekOffsetForDate(date, now, timeZone)
      };
    }) as unknown as TimeBlock[]
    : fallback.timeBlocks;

  return withDerivedOutcomeMetrics({
    version: 1,
    plan: normalizePlanContext(value.plan, fallback.plan),
    plannerWeekOffset: typeof value.plannerWeekOffset === 'number' && Number.isFinite(value.plannerWeekOffset)
      ? Math.trunc(value.plannerWeekOffset)
      : fallback.plannerWeekOffset,
    tasks: Array.isArray(value.tasks) ? value.tasks as Task[] : fallback.tasks,
    timeBlocks,
    timeEntries: Array.isArray(value.timeEntries) ? value.timeEntries as TimeEntry[] : fallback.timeEntries,
    outcomes: Array.isArray(value.outcomes)
      ? value.outcomes.map(normalizeOutcome).filter((outcome): outcome is Outcome => outcome !== null)
      : fallback.outcomes,
    timer: value.timer === null || isRecord(value.timer)
      ? value.timer as TimerSession | null
      : fallback.timer,
    review: normalizeReview(value.review, fallback.review)
  }, now, timeZone);
};

const serializeSnapshot = (snapshot: PlannerSnapshot) => JSON.stringify(snapshot);

export const getServerAcknowledgementKey = (snapshot: PlannerSnapshot) => serializeSnapshot(snapshot);

export const needsTimeBlockDateMigration = (snapshot: PlannerSnapshot) => (
  snapshot.timeBlocks.some((block) => !isLocalDate(block.date))
);

const parseSnapshot = (value: string | null, now = new Date(), timeZone?: string): PlannerSnapshot | null => {
  if (!value) return null;
  try {
    return normalizePlannerSnapshot(JSON.parse(value) as unknown, now, timeZone);
  } catch {
    return null;
  }
};

export const getPlannerStorageKeys = (subject: string): PlannerStorageKeys => {
  const suffix = encodeURIComponent(subject);
  return {
    snapshot: `${LEGACY_STORAGE_KEY}:${suffix}`,
    syncMetadata: `${LEGACY_SYNC_METADATA_KEY}:${suffix}`,
    conflictBackup: `${LEGACY_CONFLICT_BACKUP_KEY}:${suffix}`,
    activePlanAbsent: `${LEGACY_ACTIVE_PLAN_ABSENT_KEY}:${suffix}`
  };
};

const canAdoptLegacyStorage = (subject: string) => (
  subject.startsWith('local:') || subject.startsWith('test:')
);

const migrateLegacyStorage = (keys: PlannerStorageKeys) => {
  const pairs: Array<[string, string]> = [
    [LEGACY_STORAGE_KEY, keys.snapshot],
    [LEGACY_SYNC_METADATA_KEY, keys.syncMetadata],
    [LEGACY_CONFLICT_BACKUP_KEY, keys.conflictBackup],
    [LEGACY_ACTIVE_PLAN_ABSENT_KEY, keys.activePlanAbsent]
  ];
  for (const [legacyKey, scopedKey] of pairs) {
    const legacyValue = window.localStorage.getItem(legacyKey);
    if (legacyValue === null) continue;
    if (window.localStorage.getItem(scopedKey) === null) {
      window.localStorage.setItem(scopedKey, legacyValue);
    }
    window.localStorage.removeItem(legacyKey);
  }
};

const readSyncMetadata = (keys: PlannerStorageKeys): SyncMetadata | null => {
  try {
    const value = JSON.parse(window.localStorage.getItem(keys.syncMetadata) ?? 'null') as unknown;
    if (
      !isRecord(value)
      || typeof value.revision !== 'number'
      || !Number.isSafeInteger(value.revision)
      || value.revision < 0
      || typeof value.etag !== 'string'
      || typeof value.acknowledgedSnapshot !== 'string'
    ) return null;
    return {
      revision: value.revision,
      etag: value.etag,
      acknowledgedSnapshot: value.acknowledgedSnapshot
    };
  } catch {
    return null;
  }
};

export const loadInitialPlannerState = (
  subject: string,
  allowLegacyMigration = canAdoptLegacyStorage(subject),
  now = new Date(),
  timeZone?: string
): InitialPlannerState => {
  if (typeof window === 'undefined') {
    return {
      snapshot: createEmptySnapshot(timeZone),
      hasStoredSnapshot: false,
      metadata: null,
      activePlanAbsent: false
    };
  }
  const keys = getPlannerStorageKeys(subject);
  try {
    if (allowLegacyMigration) migrateLegacyStorage(keys);
    const raw = window.localStorage.getItem(keys.snapshot);
    return {
      snapshot: raw
        ? normalizePlannerSnapshot(JSON.parse(raw) as unknown, now, timeZone)
        : createEmptySnapshot(timeZone),
      hasStoredSnapshot: raw !== null,
      metadata: readSyncMetadata(keys),
      activePlanAbsent: window.localStorage.getItem(keys.activePlanAbsent) === '1'
    };
  } catch {
    return {
      snapshot: createEmptySnapshot(timeZone),
      hasStoredSnapshot: false,
      metadata: null,
      activePlanAbsent: false
    };
  }
};

const writeLocalSnapshot = (keys: PlannerStorageKeys, snapshot: PlannerSnapshot): boolean => {
  try {
    window.localStorage.setItem(keys.snapshot, serializeSnapshot(snapshot));
    return true;
  } catch {
    return false;
  }
};

const writeSyncMetadata = (keys: PlannerStorageKeys, metadata: SyncMetadata): boolean => {
  try {
    window.localStorage.setItem(keys.syncMetadata, JSON.stringify(metadata));
    return true;
  } catch {
    return false;
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

const isValidPlanContext = (plan: PlanContext) => (
  Number.isFinite(plan.year)
  && [1, 2, 3, 4].includes(plan.quarter)
  && plan.annualDirection.trim().length > 0
  && plan.quarterFocus.trim().length > 0
  && plan.quarterEndDate.trim().length > 0
);

const normalizeOutcomeInput = (input: OutcomeInput): OutcomeInput | null => {
  const title = input.title.trim();
  const unit = input.unit.trim();
  const evidenceLabel = input.evidenceLabel.trim();
  if (
    !title
    || !unit
    || !evidenceLabel
    || (input.current !== null && (!Number.isFinite(input.current) || input.current < 0))
    || !Number.isFinite(input.target)
    || input.target <= 0
    || !Number.isFinite(input.neededHours)
    || input.neededHours < 0
    || !Number.isFinite(input.availableHours)
    || input.availableHours < 0
    || (input.nextCheckDate !== null && !isLocalDate(input.nextCheckDate))
  ) return null;

  return {
    ...input,
    title,
    unit,
    evidenceLabel,
    current: input.current === null ? null : toApiDecimal(input.current),
    target: toApiDecimal(input.target),
    neededHours: toApiDecimal(input.neededHours),
    availableHours: toApiDecimal(input.availableHours),
    nextCheckDate: input.nextCheckDate
  };
};

const metricHistoryEntry = (
  value: number | null,
  evidence: string,
  observedAt = new Date()
): OutcomeMetricHistoryEntry => ({
  id: safeId('metric'),
  value,
  observedAt: observedAt.toISOString(),
  evidence: evidence.trim()
});

export const appendOutcomeMetricHistory = (
  outcome: Outcome,
  value: number | null,
  evidence: string,
  observedAt = new Date(),
  timeZone?: string
): Outcome => {
  const previousObservedAt = outcome.metricHistory.at(-1)?.observedAt;
  const previousObservedAtMillis = previousObservedAt ? Date.parse(previousObservedAt) : Number.NaN;
  const observedAtMillis = observedAt.getTime();
  const monotonicObservedAt = Number.isFinite(previousObservedAtMillis)
    && observedAtMillis <= previousObservedAtMillis
    ? new Date(previousObservedAtMillis + 1)
    : observedAt;
  const entry = metricHistoryEntry(value, evidence, monotonicObservedAt);
  const next = {
    ...outcome,
    current: value,
    metricUpdatedAt: entry.observedAt,
    metricHistory: [...outcome.metricHistory, entry],
    evidenceLabel: entry.evidence,
    changeLabel: value === null ? '현재 미확인' : metricChangeLabel(outcome, value)
  };
  return {
    ...next,
    lastUpdatedDays: 0,
    attention: deriveOutcomeAttention(next, monotonicObservedAt, timeZone)
  };
};

export const incrementExplicitCarryCount = (
  tasks: Task[],
  taskId: string | null,
  shouldIncrement: boolean
): Task[] => {
  if (!shouldIncrement || !taskId) return tasks;
  return tasks.map((task) => task.id === taskId
    ? { ...task, carryCount: task.carryCount + 1 }
    : task);
};

export const applyOutcomeLifecycle = (
  snapshot: PlannerSnapshot,
  outcomeId: string,
  action: 'stop' | 'remove',
  disposition: LinkedTaskDisposition,
  now = new Date(),
  timeZone?: string
): PlannerSnapshot => {
  if (!snapshot.outcomes.some((outcome) => outcome.id === outcomeId)) return snapshot;
  const cancellableTaskIds = new Set(
    snapshot.tasks
      .filter((task) => task.outcomeId === outcomeId && task.status !== 'done')
      .map((task) => task.id)
  );
  const cancelTasks = disposition === 'cancel';
  const today = toLocalDate(now, timeZone);
  const currentMinutes = getMinuteOfDay(now, timeZone);
  const isPastBlock = (block: TimeBlock) => (
    block.date < today
    || (block.date === today && block.startMinutes + block.durationMinutes <= currentMinutes)
  );

  return withDerivedOutcomeMetrics({
    ...snapshot,
    outcomes: action === 'remove'
      ? snapshot.outcomes.filter((outcome) => outcome.id !== outcomeId)
      : snapshot.outcomes.map((outcome) => outcome.id === outcomeId
        ? { ...outcome, decision: 'stop' }
        : outcome),
    tasks: snapshot.tasks.map((task) => task.outcomeId === outcomeId
      ? {
        ...task,
        outcomeId: action === 'remove' || disposition === 'detach' ? null : task.outcomeId,
        status: cancelTasks && task.status !== 'done' ? 'cancelled' : task.status
      }
      : task),
    timeBlocks: cancelTasks
      ? snapshot.timeBlocks.filter((block) => (
        block.taskId === null
        || !cancellableTaskIds.has(block.taskId)
        || isPastBlock(block)
      ))
      : snapshot.timeBlocks,
    timer: cancelTasks && snapshot.timer && cancellableTaskIds.has(snapshot.timer.taskId)
      ? null
      : snapshot.timer,
    review: cancelTasks
      ? {
        ...snapshot.review,
        selectedTopTaskIds: snapshot.review.selectedTopTaskIds.filter((id) => !cancellableTaskIds.has(id))
      }
      : snapshot.review
  }, now, timeZone);
};

/** Preserve selected conflict data while restoring the cross-section references the API validates. */
export const reconcileSnapshotReferences = (
  snapshot: PlannerSnapshot,
  ...sources: PlannerSnapshot[]
): PlannerSnapshot => {
  const candidates = [snapshot, ...sources];
  const taskCandidates = new Map<string, Task>();
  const outcomeCandidates = new Map<string, Outcome>();
  for (const candidate of candidates) {
    for (const task of candidate.tasks) if (!taskCandidates.has(task.id)) taskCandidates.set(task.id, task);
    for (const outcome of candidate.outcomes) {
      if (!outcomeCandidates.has(outcome.id)) outcomeCandidates.set(outcome.id, outcome);
    }
  }

  const requiredTaskIds = new Set<string>();
  for (const block of snapshot.timeBlocks) if (block.taskId) requiredTaskIds.add(block.taskId);
  for (const entry of snapshot.timeEntries) requiredTaskIds.add(entry.taskId);
  if (snapshot.timer) requiredTaskIds.add(snapshot.timer.taskId);
  for (const taskId of snapshot.review.selectedTopTaskIds) requiredTaskIds.add(taskId);

  const tasks = [...snapshot.tasks];
  const knownTaskIds = new Set(tasks.map((task) => task.id));
  for (const taskId of requiredTaskIds) {
    if (knownTaskIds.has(taskId)) continue;
    const recovered = taskCandidates.get(taskId);
    const blockTitle = snapshot.timeBlocks.find((block) => block.taskId === taskId)?.title;
    const recoveredSeconds = snapshot.timeEntries
      .filter((entry) => entry.taskId === taskId)
      .reduce((sum, entry) => sum + Math.max(0, entry.durationSeconds), 0);
    tasks.push(recovered ?? {
      id: taskId,
      title: blockTitle?.trim() || '복구된 작업',
      outcomeId: null,
      estimateMinutes: Math.max(5, Math.round(recoveredSeconds / 60) || 25),
      status: recoveredSeconds > 0 ? 'in-progress' : 'todo',
      pinned: false,
      carryCount: 0,
      note: '동기화 충돌에서 참조 데이터를 보존하기 위해 복구했습니다.'
    });
    knownTaskIds.add(taskId);
  }

  const outcomes = [...snapshot.outcomes];
  const knownOutcomeIds = new Set(outcomes.map((outcome) => outcome.id));
  const repairedTasks = tasks.map((task) => {
    if (!task.outcomeId || knownOutcomeIds.has(task.outcomeId)) return task;
    const recovered = outcomeCandidates.get(task.outcomeId);
    if (!recovered) return { ...task, outcomeId: null };
    outcomes.push(recovered);
    knownOutcomeIds.add(recovered.id);
    return task;
  });

  return withDerivedOutcomeMetrics({ ...snapshot, tasks: repairedTasks, outcomes });
};

export const applyOnboardingPayload = (
  base: PlannerSnapshot,
  payload: OnboardingPayload,
  now = new Date(),
  timeZone?: string
): PlannerSnapshot => {
  const outcomeTitle = payload.outcomeTitle.trim();
  const taskTitle = payload.taskTitle.trim();
  const hasOutcome = outcomeTitle.length > 0;
  const hasTask = taskTitle.length > 0
    && Number.isFinite(payload.estimateMinutes)
    && payload.estimateMinutes > 0;
  const outcomeId = safeId('outcome');
  const taskId = safeId('task');
  const candidateDate = !hasTask || payload.startMinutes === null
    ? null
    : getDateForDay(payload.day, payload.weekOffset, now, timeZone);
  const candidate = !hasTask || payload.startMinutes === null || candidateDate === null ? null : {
    day: payload.day,
    startMinutes: payload.startMinutes,
    durationMinutes: Math.round(payload.estimateMinutes),
    weekOffset: payload.weekOffset
  };
  const candidateBlocks = candidateDate === null
    ? []
    : base.timeBlocks
      .filter((block) => block.date === candidateDate)
      .map((block) => ({ ...block, weekOffset: payload.weekOffset }));
  const conflict = candidate !== null && (
    !isValidTimeBlockSlot(candidate)
    || Boolean(findTimeBlockConflict(candidateBlocks, candidate))
  );
  const outcome: Outcome = {
    id: outcomeId,
    title: outcomeTitle,
    parentTitle: outcomeTitle,
    current: null,
    target: 1,
    unit: '결과',
    confidence: 'unknown',
    lastUpdatedDays: null,
    metricUpdatedAt: null,
    nextCheckDate: null,
    metricHistory: [],
    actualHours: 0,
    neededHours: toApiDecimal(payload.estimateMinutes / 60),
    availableHours: 4,
    evidenceLabel: '첫 점검에서 측정 방식 설정',
    changeLabel: '첫 실행 전',
    attention: 'no-evidence'
  };
  const task: Task = {
    id: taskId,
    title: taskTitle,
    outcomeId: hasOutcome ? outcomeId : null,
    estimateMinutes: payload.estimateMinutes,
    status: 'todo',
    pinned: true,
    carryCount: 0,
    note: conflict ? '선택한 시간에 기존 일정이 있어 아직 배치되지 않았습니다.' : undefined
  };
  const block: TimeBlock | null = candidate && candidateDate ? {
    id: safeId('block'),
    taskId,
    title: taskTitle,
    ...candidate,
    date: candidateDate
  } : null;

  return withDerivedOutcomeMetrics({
    ...base,
    plan: {
      ...base.plan,
      annualDirection: hasOutcome ? outcomeTitle : base.plan.annualDirection,
      quarterFocus: hasOutcome ? outcomeTitle : base.plan.quarterFocus
    },
    outcomes: hasOutcome ? [outcome, ...base.outcomes] : base.outcomes,
    tasks: hasTask ? [task, ...base.tasks] : base.tasks,
    timeBlocks: conflict || block === null ? base.timeBlocks : [block, ...base.timeBlocks]
  }, now, timeZone);
};

interface ScopedPlannerProviderProps extends PropsWithChildren {
  subject: string;
}

function ScopedPlannerProvider({ children, subject }: ScopedPlannerProviderProps) {
  const { timeZone } = useTimeZone();
  const timeZoneRef = useRef(timeZone);
  timeZoneRef.current = timeZone;
  const previousTimeZoneRef = useRef(timeZone);
  const storageKeys = useMemo(() => getPlannerStorageKeys(subject), [subject]);
  const initialStateRef = useRef<InitialPlannerState | null>(null);
  if (initialStateRef.current === null) {
    initialStateRef.current = loadInitialPlannerState(subject, canAdoptLegacyStorage(subject), new Date(), timeZone);
  }
  const initialState = initialStateRef.current;
  const initialSnapshotKey = serializeSnapshot(initialState.snapshot);

  const [snapshot, setSnapshot] = useState<PlannerSnapshot>(initialState.snapshot);
  const snapshotRef = useRef(snapshot);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const onlineRef = useRef(isOnline);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(isOnline ? 'checking' : 'offline');
  const [syncConflict, setSyncConflict] = useState<SyncConflict | null>(null);
  const [serverReady, setServerReady] = useState(false);
  const serverReadyRef = useRef(false);
  const [plannerReady, setPlannerReady] = useState(initialState.hasStoredSnapshot || !isOnline);
  const [hasActivePlan, setHasActivePlan] = useState(() => (
    initialState.hasStoredSnapshot
    && !initialState.activePlanAbsent
  ));
  const hasActivePlanRef = useRef(hasActivePlan);
  const [syncPulse, setSyncPulse] = useState(0);
  const revisionRef = useRef<number | null>(initialState.metadata?.revision ?? null);
  const etagRef = useRef<string | null>(initialState.metadata?.etag ?? null);
  const acknowledgedSnapshotRef = useRef<string | null>(
    initialState.metadata?.acknowledgedSnapshot ?? null
  );
  const hasStoredSnapshotRef = useRef(initialState.hasStoredSnapshot);
  const dirtyRef = useRef(
    initialState.metadata?.acknowledgedSnapshot !== initialSnapshotKey
  );
  const localChangeCountRef = useRef(0);
  const requestInFlightRef = useRef(false);
  const resettingRef = useRef(false);
  const conflictRef = useRef(false);
  const pendingWriteRef = useRef<PendingWrite | null>(null);
  const removedTimeBlocksRef = useRef(new Map<string, RemovedTimeBlock>());
  const resetEpochRef = useRef(0);

  const markServerReady = useCallback(() => {
    serverReadyRef.current = true;
    setServerReady(true);
  }, []);

  const markConflict = useCallback((
    serverSnapshot?: PlannerSnapshot,
    serverRevision?: number,
    serverEtag?: string
  ) => {
    conflictRef.current = true;
    dirtyRef.current = true;
    if (serverSnapshot && serverRevision !== undefined && serverEtag) {
      const conflict: SyncConflict = {
        base: parseSnapshot(acknowledgedSnapshotRef.current, new Date(), timeZoneRef.current),
        local: structuredClone(snapshotRef.current),
        server: structuredClone(serverSnapshot),
        serverRevision,
        serverEtag,
        detectedAt: new Date().toISOString()
      };
      setSyncConflict(conflict);
      try {
        window.localStorage.setItem(storageKeys.conflictBackup, JSON.stringify(conflict));
      } catch {
        // The active local and server snapshots remain in React state even if backup storage is full.
      }
    }
    setSaveStatus('conflict');
  }, [storageKeys.conflictBackup]);

  const acknowledgeSnapshot = useCallback((
    revision: number,
    etag: string,
    acknowledgedSnapshot: string
  ) => {
    revisionRef.current = revision;
    etagRef.current = etag;
    acknowledgedSnapshotRef.current = acknowledgedSnapshot;
    return writeSyncMetadata(storageKeys, { revision, etag, acknowledgedSnapshot });
  }, [storageKeys]);

  const replaceWithServerSnapshot = useCallback((
    serverSnapshot: PlannerSnapshot,
    revision: number,
    etag: string,
    acknowledgedSnapshotKey = serializeSnapshot(serverSnapshot)
  ) => {
    snapshotRef.current = serverSnapshot;
    setSnapshot(serverSnapshot);
    hasActivePlanRef.current = true;
    setHasActivePlan(true);
    setPlannerReady(true);
    window.localStorage.removeItem(storageKeys.activePlanAbsent);
    hasStoredSnapshotRef.current = true;
    dirtyRef.current = false;
    conflictRef.current = false;
    setSyncConflict(null);
    pendingWriteRef.current = null;
    removedTimeBlocksRef.current.clear();
    const localStored = writeLocalSnapshot(storageKeys, serverSnapshot);
    const metadataStored = acknowledgeSnapshot(revision, etag, acknowledgedSnapshotKey);
    setSaveStatus(localStored && metadataStored ? 'saved' : 'storage-error');
  }, [acknowledgeSnapshot, storageKeys]);

  const updateSnapshot = useCallback((updater: (current: PlannerSnapshot) => PlannerSnapshot) => {
    const current = snapshotRef.current;
    const updated = updater(current);
    const next = updated === current ? current : withDerivedOutcomeMetrics(updated, new Date(), timeZone);
    if (next !== current) {
      snapshotRef.current = next;
      setSnapshot(next);
      hasStoredSnapshotRef.current = true;
      dirtyRef.current = true;
      localChangeCountRef.current += 1;
      const stored = writeLocalSnapshot(storageKeys, next);
      if (!stored) {
        setSaveStatus('storage-error');
      } else if (conflictRef.current) {
        setSyncConflict((currentConflict) => {
          if (!currentConflict) return currentConflict;
          const nextConflict: SyncConflict = {
            ...currentConflict,
            local: structuredClone(next)
          };
          try {
            window.localStorage.setItem(storageKeys.conflictBackup, JSON.stringify(nextConflict));
          } catch {
            // The latest local snapshot is still preserved by the account-scoped snapshot key.
          }
          return nextConflict;
        });
        setSaveStatus('conflict');
      } else {
        setSaveStatus(onlineRef.current ? 'saving' : 'offline');
      }
    }
    return next;
  }, [storageKeys, timeZone]);

  const syncNow = useCallback(async () => {
    if (
      !onlineRef.current
      || !serverReadyRef.current
      || !dirtyRef.current
      || conflictRef.current
      || requestInFlightRef.current
      || resettingRef.current
      || !hasActivePlanRef.current
    ) return;

    requestInFlightRef.current = true;
    const requestEpoch = resetEpochRef.current;
    const submittedSnapshot = snapshotRef.current;
    const submittedSnapshotKey = serializeSnapshot(submittedSnapshot);
    const localStored = writeLocalSnapshot(storageKeys, submittedSnapshot);
    hasStoredSnapshotRef.current = localStored || hasStoredSnapshotRef.current;
    const submittedRevision = revisionRef.current;
    const matchingPendingWrite = pendingWriteRef.current?.snapshotKey === submittedSnapshotKey
      && pendingWriteRef.current.revision === submittedRevision;
    const pendingWrite: PendingWrite = matchingPendingWrite
      ? pendingWriteRef.current as PendingWrite
      : {
        snapshotKey: submittedSnapshotKey,
        revision: submittedRevision,
        idempotencyKey: createIdempotencyKey()
      };
    pendingWriteRef.current = pendingWrite;
    setSaveStatus('saving');
    let scheduleFollowUp = false;

    try {
      const result = await plannerApi.put(
        submittedSnapshot,
        submittedRevision,
        pendingWrite.idempotencyKey,
        etagRef.current
      );
      if (requestEpoch !== resetEpochRef.current) return;
      pendingWriteRef.current = null;
      conflictRef.current = false;
      const metadataStored = acknowledgeSnapshot(
        result.aggregate.revision,
        result.etag,
        submittedSnapshotKey
      );
      const hasNewerLocalChanges = serializeSnapshot(snapshotRef.current) !== submittedSnapshotKey;
      dirtyRef.current = hasNewerLocalChanges;
      if (!localStored || !metadataStored) {
        setSaveStatus('storage-error');
      } else if (hasNewerLocalChanges) {
        setSaveStatus(onlineRef.current ? 'saving' : 'offline');
        scheduleFollowUp = onlineRef.current;
      } else {
        setSaveStatus(onlineRef.current ? 'saved' : 'offline');
      }
    } catch (error) {
      if (requestEpoch !== resetEpochRef.current) return;
      if (error instanceof PlannerConflictError) {
        pendingWriteRef.current = null;
        try {
          const latest = await plannerApi.get(null);
          if (latest.kind === 'found') {
            markConflict(
              normalizePlannerSnapshot(latest.aggregate.snapshot, new Date(), timeZoneRef.current),
              latest.aggregate.revision,
              latest.etag
            );
          } else {
            markConflict();
          }
        } catch {
          markConflict();
        }
      } else {
        setSaveStatus(onlineRef.current ? 'retry' : 'offline');
      }
    } finally {
      requestInFlightRef.current = false;
      if (scheduleFollowUp) setSyncPulse((value) => value + 1);
    }
  }, [acknowledgeSnapshot, markConflict, storageKeys]);

  const initializeFromServer = useCallback(async () => {
    if (!onlineRef.current || requestInFlightRef.current || conflictRef.current) return;
    requestInFlightRef.current = true;
    const requestEpoch = resetEpochRef.current;
    setSaveStatus('checking');
    const startedAtLocalChange = localChangeCountRef.current;
    const localSnapshotKeyAtStart = serializeSnapshot(snapshotRef.current);
    const canUseCachedEtag = acknowledgedSnapshotRef.current === localSnapshotKeyAtStart
      && revisionRef.current !== null;
    let shouldSyncAfterHandshake = false;
    let handshakeComplete = false;

    try {
      const result = await plannerApi.get(canUseCachedEtag ? etagRef.current : null);
      if (requestEpoch !== resetEpochRef.current) return;
      handshakeComplete = true;
      const changedWhileLoading = localChangeCountRef.current !== startedAtLocalChange;
      if (result.kind === 'not-modified') {
        if (!canUseCachedEtag || revisionRef.current === null) {
          setSaveStatus('retry');
        } else if (changedWhileLoading) {
          dirtyRef.current = true;
          shouldSyncAfterHandshake = true;
          setSaveStatus(onlineRef.current ? 'saving' : 'offline');
        } else {
          dirtyRef.current = false;
          setSaveStatus('saved');
        }
      } else if (result.kind === 'missing') {
        revisionRef.current = null;
        etagRef.current = null;
        acknowledgedSnapshotRef.current = null;
        const hasUnsyncedLocalPlan = hasStoredSnapshotRef.current && hasActivePlanRef.current;
        hasActivePlanRef.current = hasUnsyncedLocalPlan;
        setHasActivePlan(hasUnsyncedLocalPlan);
        dirtyRef.current = hasUnsyncedLocalPlan;
        shouldSyncAfterHandshake = hasUnsyncedLocalPlan;
        if (!hasUnsyncedLocalPlan) setSaveStatus('saved');
      } else {
        const serverSnapshot = normalizePlannerSnapshot(
          result.aggregate.snapshot,
          new Date(),
          timeZoneRef.current
        );
        const rawServerSnapshotKey = getServerAcknowledgementKey(result.aggregate.snapshot);
        const serverSnapshotKey = serializeSnapshot(serverSnapshot);
        const serverNeedsDateMigration = needsTimeBlockDateMigration(result.aggregate.snapshot);
        const currentLocalSnapshotKey = serializeSnapshot(snapshotRef.current);
        const localWasAcknowledged = acknowledgedSnapshotRef.current === currentLocalSnapshotKey;
        const sameSnapshot = serverSnapshotKey === currentLocalSnapshotKey;
        const serverStillMatchesStart = canUseCachedEtag && serverSnapshotKey === localSnapshotKeyAtStart;
        const canHydrate = sameSnapshot
          || (!changedWhileLoading && (!hasStoredSnapshotRef.current || !dirtyRef.current || localWasAcknowledged));

        if (canHydrate) {
          replaceWithServerSnapshot(
            serverSnapshot,
            result.aggregate.revision,
            result.etag,
            serverNeedsDateMigration ? rawServerSnapshotKey : serverSnapshotKey
          );
          if (serverNeedsDateMigration) {
            dirtyRef.current = true;
            shouldSyncAfterHandshake = true;
            setSaveStatus(onlineRef.current ? 'saving' : 'offline');
          }
        } else if (changedWhileLoading && serverStillMatchesStart) {
          revisionRef.current = result.aggregate.revision;
          etagRef.current = result.etag;
          dirtyRef.current = true;
          shouldSyncAfterHandshake = true;
          setSaveStatus(onlineRef.current ? 'saving' : 'offline');
        } else {
          revisionRef.current = result.aggregate.revision;
          etagRef.current = result.etag;
          markConflict(serverSnapshot, result.aggregate.revision, result.etag);
        }
      }
    } catch (error) {
      if (requestEpoch !== resetEpochRef.current) return;
      if (error instanceof PlannerConflictError) {
        markConflict();
      } else {
        setSaveStatus(onlineRef.current ? 'retry' : 'offline');
      }
    } finally {
      requestInFlightRef.current = false;
      setPlannerReady(true);
      if (handshakeComplete) {
        markServerReady();
      } else if (!resettingRef.current) {
        serverReadyRef.current = false;
        setServerReady(false);
      }
    }

    if (shouldSyncAfterHandshake) void syncNow();
  }, [markConflict, markServerReady, replaceWithServerSnapshot, syncNow]);

  const retrySync = useCallback(() => {
    if (!onlineRef.current || conflictRef.current) return;
    if (serverReadyRef.current) void syncNow();
    else void initializeFromServer();
  }, [initializeFromServer, syncNow]);

  const reloadFromServer = useCallback(async () => {
    if (!onlineRef.current || requestInFlightRef.current) return false;
    requestInFlightRef.current = true;
    setSaveStatus('checking');
    try {
      const result = await plannerApi.get(null);
      if (result.kind !== 'found') {
        setSaveStatus(result.kind === 'missing' ? 'retry' : 'saved');
        return false;
      }
      const serverSnapshot = normalizePlannerSnapshot(
        result.aggregate.snapshot,
        new Date(),
        timeZoneRef.current
      );
      replaceWithServerSnapshot(serverSnapshot, result.aggregate.revision, result.etag);
      return true;
    } catch {
      setSaveStatus(onlineRef.current ? 'retry' : 'offline');
      return false;
    } finally {
      requestInFlightRef.current = false;
    }
  }, [replaceWithServerSnapshot]);

  const markActivePlanClosed = useCallback(() => {
    window.localStorage.setItem(storageKeys.activePlanAbsent, '1');
    window.localStorage.removeItem(storageKeys.syncMetadata);
    hasActivePlanRef.current = false;
    setHasActivePlan(false);
    setPlannerReady(true);
    revisionRef.current = null;
    etagRef.current = null;
    acknowledgedSnapshotRef.current = null;
    dirtyRef.current = false;
    removedTimeBlocksRef.current.clear();
    setSaveStatus('saved');
  }, [storageKeys]);

  const resolveConflict = useCallback((
    strategy: 'local' | 'server' | 'merge',
    choices: Partial<Record<SnapshotSection, 'local' | 'server'>> = {}
  ) => {
    if (!syncConflict) return;
    if (strategy === 'server') {
      replaceWithServerSnapshot(
        syncConflict.server,
        syncConflict.serverRevision,
        syncConflict.serverEtag
      );
      return;
    }

    let resolved = structuredClone(syncConflict.local);
    if (strategy === 'merge') {
      resolved = structuredClone(syncConflict.server);
      const target = resolved as unknown as Record<string, unknown>;
      const local = syncConflict.local as unknown as Record<string, unknown>;
      for (const section of Object.keys(syncConflict.server) as SnapshotSection[]) {
        if (choices[section] === 'local') target[section] = structuredClone(local[section]);
      }
      resolved = withDerivedOutcomeMetrics(reconcileSnapshotReferences(
        normalizePlannerSnapshot(resolved, new Date(), timeZone),
        syncConflict.local,
        syncConflict.server
      ), new Date(), timeZone);
      removedTimeBlocksRef.current.clear();
    }

    const serverSnapshotKey = serializeSnapshot(syncConflict.server);
    acknowledgeSnapshot(syncConflict.serverRevision, syncConflict.serverEtag, serverSnapshotKey);
    snapshotRef.current = resolved;
    setSnapshot(resolved);
    writeLocalSnapshot(storageKeys, resolved);
    pendingWriteRef.current = null;
    conflictRef.current = false;
    dirtyRef.current = serializeSnapshot(resolved) !== serverSnapshotKey;
    setSyncConflict(null);
    setSaveStatus(dirtyRef.current ? (onlineRef.current ? 'saving' : 'offline') : 'saved');
    if (dirtyRef.current) setSyncPulse((value) => value + 1);
  }, [acknowledgeSnapshot, replaceWithServerSnapshot, storageKeys, syncConflict, timeZone]);

  useEffect(() => {
    if (previousTimeZoneRef.current === timeZone) return;
    previousTimeZoneRef.current = timeZone;
    updateSnapshot((current) => {
      const recalculated = withDerivedOutcomeMetrics(current, new Date(), timeZone);
      const changed = recalculated.outcomes.some((outcome, index) => {
        const previous = current.outcomes[index];
        return !previous
          || outcome.actualHours !== previous.actualHours
          || outcome.lastUpdatedDays !== previous.lastUpdatedDays
          || outcome.attention !== previous.attention;
      });
      return changed ? recalculated : current;
    });
  }, [timeZone, updateSnapshot]);

  useEffect(() => {
    const goOnline = () => {
      onlineRef.current = true;
      setIsOnline(true);
      if (conflictRef.current) return;
      if (serverReadyRef.current) void syncNow();
      else void initializeFromServer();
    };
    const goOffline = () => {
      onlineRef.current = false;
      setIsOnline(false);
      setSaveStatus('offline');
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [initializeFromServer, syncNow]);

  useEffect(() => {
    if (onlineRef.current && !serverReadyRef.current) void initializeFromServer();
  }, [initializeFromServer]);

  useEffect(() => {
    if (
      !serverReady
      || !isOnline
      || !dirtyRef.current
      || conflictRef.current
      || resettingRef.current
    ) return undefined;
    const handle = window.setTimeout(() => void syncNow(), SERVER_SYNC_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [isOnline, serverReady, snapshot, syncNow, syncPulse]);

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

  const updateTask = useCallback((taskId: string, input: UpdateTaskInput): boolean => {
    let updated = false;
    updateSnapshot((current) => {
      const existing = current.tasks.find((task) => task.id === taskId);
      if (!existing) return current;

      const title = input.title === undefined ? existing.title : input.title.trim();
      const estimateMinutes = input.estimateMinutes === undefined
        ? existing.estimateMinutes
        : Math.round(input.estimateMinutes);
      const outcomeId = input.outcomeId === undefined ? existing.outcomeId : input.outcomeId;
      if (
        !title
        || !Number.isFinite(estimateMinutes)
        || estimateMinutes <= 0
        || (outcomeId !== null && !current.outcomes.some((outcome) => outcome.id === outcomeId))
      ) return current;

      const nextTask: Task = {
        ...existing,
        ...input,
        title,
        estimateMinutes,
        outcomeId,
        note: input.note === undefined ? existing.note : input.note.trim() || undefined
      };
      updated = true;
      return {
        ...current,
        tasks: current.tasks.map((task) => task.id === taskId ? nextTask : task),
        timeBlocks: current.timeBlocks.map((block) => block.taskId === taskId
          ? { ...block, title }
          : block)
      };
    });
    return updated;
  }, [updateSnapshot]);

  const removeTask = useCallback((taskId: string): boolean => {
    let removed = false;
    updateSnapshot((current) => {
      if (!current.tasks.some((task) => task.id === taskId)) return current;
      removed = true;
      return {
        ...current,
        tasks: current.tasks.filter((task) => task.id !== taskId),
        timeBlocks: current.timeBlocks.filter((block) => block.taskId !== taskId),
        timeEntries: current.timeEntries.filter((entry) => entry.taskId !== taskId),
        timer: current.timer?.taskId === taskId ? null : current.timer,
        review: {
          ...current.review,
          selectedTopTaskIds: current.review.selectedTopTaskIds.filter((id) => id !== taskId)
        }
      };
    });
    return removed;
  }, [updateSnapshot]);

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
          ? {
            ...outcome,
            ...input.outcomePatch,
            title: input.outcomePatch.title.trim(),
            target: toApiDecimal(input.outcomePatch.target),
            neededHours: toApiDecimal(input.outcomePatch.neededHours),
            availableHours: toApiDecimal(input.outcomePatch.availableHours)
          }
          : outcome)
      };
    });
  }, [updateSnapshot]);

  const updatePlan = useCallback((input: PlanContext): boolean => {
    if (!isValidPlanContext(input)) return false;
    updateSnapshot((current) => ({
      ...current,
      plan: {
        ...input,
        year: Math.trunc(input.year),
        annualDirection: input.annualDirection.trim(),
        quarterFocus: input.quarterFocus.trim(),
        quarterEndDate: input.quarterEndDate.trim()
      }
    }));
    return true;
  }, [updateSnapshot]);

  const addOutcome = useCallback((input: OutcomeInput): string => {
    const normalized = normalizeOutcomeInput(input);
    if (!normalized) return '';
    const outcomeId = safeId('outcome');
    updateSnapshot((current) => {
      const createdAt = new Date();
      const baseOutcome: Outcome = {
        id: outcomeId,
        title: normalized.title,
        parentTitle: current.plan.quarterFocus.trim() || '독립 분기 결과',
        current: null,
        target: normalized.target,
        unit: normalized.unit,
        confidence: normalized.confidence,
        lastUpdatedDays: null,
        metricUpdatedAt: null,
        nextCheckDate: normalized.nextCheckDate,
        metricHistory: [],
        actualHours: 0,
        neededHours: normalized.neededHours,
        availableHours: normalized.availableHours,
        evidenceLabel: normalized.evidenceLabel,
        changeLabel: '현재 미확인',
        attention: 'no-evidence'
      };
      const outcome = normalized.current === null
        ? { ...baseOutcome, attention: deriveOutcomeAttention(baseOutcome, createdAt, timeZone) }
        : appendOutcomeMetricHistory(
          baseOutcome,
          normalized.current,
          normalized.evidenceLabel,
          createdAt,
          timeZone
        );
      return { ...current, outcomes: [...current.outcomes, outcome] };
    });
    return outcomeId;
  }, [timeZone, updateSnapshot]);

  const updateOutcome = useCallback((outcomeId: string, input: OutcomeInput): boolean => {
    const normalized = normalizeOutcomeInput(input);
    if (!normalized || !snapshotRef.current.outcomes.some((outcome) => outcome.id === outcomeId)) return false;
    updateSnapshot((current) => ({
      ...current,
      outcomes: current.outcomes.map((outcome) => outcome.id === outcomeId
        ? (() => {
          const metricChanged = outcome.current !== normalized.current
            || outcome.evidenceLabel !== normalized.evidenceLabel;
          const nextOutcome: Outcome = {
            ...outcome,
            title: normalized.title,
            target: normalized.target,
            unit: normalized.unit,
            confidence: normalized.confidence,
            neededHours: normalized.neededHours,
            availableHours: normalized.availableHours,
            nextCheckDate: normalized.nextCheckDate
          };
          if (metricChanged) {
            return appendOutcomeMetricHistory(
              nextOutcome,
              normalized.current,
              normalized.evidenceLabel,
              new Date(),
              timeZone
            );
          }
          return {
            ...nextOutcome,
            attention: deriveOutcomeAttention(nextOutcome, new Date(), timeZone)
          };
        })()
        : outcome)
    }));
    return true;
  }, [timeZone, updateSnapshot]);

  const stopOutcome = useCallback((outcomeId: string, disposition: LinkedTaskDisposition): boolean => {
    if (!snapshotRef.current.outcomes.some((outcome) => outcome.id === outcomeId)) return false;
    updateSnapshot((current) => applyOutcomeLifecycle(
      current,
      outcomeId,
      'stop',
      disposition,
      new Date(),
      timeZone
    ));
    return true;
  }, [timeZone, updateSnapshot]);

  const removeOutcome = useCallback((outcomeId: string, disposition: LinkedTaskDisposition): boolean => {
    if (!snapshotRef.current.outcomes.some((outcome) => outcome.id === outcomeId)) return false;
    updateSnapshot((current) => applyOutcomeLifecycle(
      current,
      outcomeId,
      'remove',
      disposition,
      new Date(),
      timeZone
    ));
    return true;
  }, [timeZone, updateSnapshot]);

  const setPlannerWeekOffset = useCallback((offset: number) => {
    if (!Number.isFinite(offset)) return;
    const normalized = Math.trunc(offset);
    updateSnapshot((current) => current.plannerWeekOffset === normalized
      ? current
      : { ...current, plannerWeekOffset: normalized });
  }, [updateSnapshot]);

  const saveTimeBlock = useCallback((input: SaveTimeBlockInput): boolean => {
    let saved = false;
    updateSnapshot((current) => {
      const task = input.taskId === null
        ? null
        : current.tasks.find((item) => item.id === input.taskId);
      const title = (task?.title ?? input.title).trim();
      const requestedWeek = normalizeWeekOffset(input.weekOffset ?? current.plannerWeekOffset);
      const targetDate = isLocalDate(input.date)
        ? input.date
        : getDateForDay(input.day, requestedWeek, new Date(), timeZone);
      const targetWeek = getWeekOffsetForDate(targetDate, new Date(), timeZone);
      const targetDay = getDayKeyForDate(targetDate);
      const slot = {
        day: targetDay,
        startMinutes: Math.trunc(input.startMinutes),
        durationMinutes: Math.round(input.durationMinutes),
        weekOffset: targetWeek
      };
      if (!title || (input.taskId !== null && !task) || !isValidTimeBlockSlot(slot)) return current;

      const existing = input.id
        ? current.timeBlocks.find((block) => block.id === input.id && !block.external)
        : undefined;
      if (input.id && !existing) return current;
      const preservesExistingOccupancy = Boolean(
        existing
        && existing.taskId === input.taskId
        && existing.date === targetDate
        && existing.startMinutes === slot.startMinutes
        && existing.durationMinutes === slot.durationMinutes
      );
      const sameDateBlocks = current.timeBlocks
        .filter((block) => block.date === targetDate)
        .map((block) => ({ ...block, day: targetDay, weekOffset: targetWeek }));
      if (
        !preservesExistingOccupancy
        && findTimeBlockConflict(sameDateBlocks, slot, { ignoreBlockId: existing?.id })
      ) return current;

      const block: TimeBlock = {
        id: existing?.id ?? safeId('block'),
        taskId: input.taskId,
        title,
        ...slot,
        date: targetDate
      };
      saved = true;
      const shouldIncrementCarry = Boolean(
        input.incrementCarryCount
        && !existing
        && task
        && targetWeek === 1
      );
      return {
        ...current,
        tasks: incrementExplicitCarryCount(current.tasks, input.taskId, shouldIncrementCarry),
        timeBlocks: existing
          ? current.timeBlocks.map((item) => item.id === existing.id ? block : item)
          : [...current.timeBlocks, block]
      };
    });
    return saved;
  }, [timeZone, updateSnapshot]);

  const removeTimeBlock = useCallback((blockId: string): boolean => {
    let removed = false;
    updateSnapshot((current) => {
      const target = current.timeBlocks.find((block) => block.id === blockId && !block.external);
      if (!target) return current;
      const removedAt = Date.now();
      for (const [removedId, removed] of removedTimeBlocksRef.current) {
        if (removedAt > removed.expiresAt) removedTimeBlocksRef.current.delete(removedId);
      }
      removedTimeBlocksRef.current.set(blockId, {
        block: { ...target },
        expiresAt: removedAt + TIME_BLOCK_UNDO_WINDOW_MS,
        preExistingOverlaps: current.timeBlocks
          .filter((block) => (
            block.id !== target.id
            && block.date === target.date
            && timeRangesOverlap(
              block.startMinutes,
              block.durationMinutes,
              target.startMinutes,
              target.durationMinutes
            )
          ))
          .map((block) => ({
            id: block.id,
            date: block.date,
            startMinutes: block.startMinutes,
            durationMinutes: block.durationMinutes
          }))
      });
      removed = true;
      return { ...current, timeBlocks: current.timeBlocks.filter((block) => block.id !== blockId) };
    });
    return removed;
  }, [updateSnapshot]);

  const restoreTimeBlock = useCallback((block: TimeBlock): boolean => {
    let restored = false;
    updateSnapshot((current) => {
      const removed = removedTimeBlocksRef.current.get(block.id);
      if (!removed) return current;
      if (Date.now() > removed.expiresAt) {
        removedTimeBlocksRef.current.delete(block.id);
        return current;
      }

      const original = removed.block;
      const matchesRemovedBlock = block.id === original.id
        && block.taskId === original.taskId
        && block.title === original.title
        && block.day === original.day
        && block.date === original.date
        && block.startMinutes === original.startMinutes
        && block.durationMinutes === original.durationMinutes
        && Boolean(block.external) === Boolean(original.external)
        && normalizeWeekOffset(block.weekOffset) === normalizeWeekOffset(original.weekOffset);
      const task = original.taskId === null
        ? null
        : current.tasks.find((item) => item.id === original.taskId);
      const title = (task?.title ?? original.title).trim();
      if (
        !matchesRemovedBlock
        || original.external
        || current.timeBlocks.some((item) => item.id === original.id)
        || (original.taskId !== null && !task)
        || !title
        || !isLocalDate(original.date)
        || !Number.isInteger(original.startMinutes)
        || !Number.isInteger(original.durationMinutes)
      ) return current;

      const targetDay = getDayKeyForDate(original.date);
      const targetWeek = getWeekOffsetForDate(original.date, new Date(), timeZone);
      const slot = {
        day: targetDay,
        startMinutes: original.startMinutes,
        durationMinutes: original.durationMinutes,
        weekOffset: targetWeek
      };
      if (!isValidTimeBlockSlot(slot)) return current;
      const sameDateBlocks = current.timeBlocks
        .filter((item) => item.date === original.date)
        .map((item) => ({ ...item, day: targetDay, weekOffset: targetWeek }));
      const newConflictCandidates = sameDateBlocks.filter((item) => (
        !removed.preExistingOverlaps.some((overlap) => (
          overlap.id === item.id
          && overlap.date === item.date
          && overlap.startMinutes === item.startMinutes
          && overlap.durationMinutes === item.durationMinutes
        ))
      ));
      if (findTimeBlockConflict(newConflictCandidates, slot)) return current;

      removedTimeBlocksRef.current.delete(block.id);
      restored = true;
      return {
        ...current,
        timeBlocks: [...current.timeBlocks, {
          ...original,
          title,
          day: targetDay,
          weekOffset: targetWeek
        }]
      };
    });
    return restored;
  }, [timeZone, updateSnapshot]);

  const scheduleTask = useCallback((
    taskId: string,
    day: DayKey,
    startMinutes: number,
    durationMinutes: number,
    weekOffset?: number
  ): boolean => {
    const targetWeek = normalizeWeekOffset(weekOffset ?? snapshotRef.current.plannerWeekOffset);
    const targetDate = getDateForDay(day, targetWeek, new Date(), timeZone);
    const task = snapshotRef.current.tasks.find((item) => item.id === taskId);
    if (!task) return false;
    return saveTimeBlock({
      taskId,
      title: task.title,
      day,
      startMinutes,
      durationMinutes,
      date: targetDate,
      weekOffset: targetWeek
    });
  }, [saveTimeBlock, timeZone]);

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
    if (decision === 'stop') return;
    updateSnapshot((current) => ({
      ...current,
      outcomes: current.outcomes.map((outcome) => outcome.id === outcomeId ? { ...outcome, decision } : outcome)
    }));
  }, [updateSnapshot]);

  const updateOutcomeMetric = useCallback((outcomeId: string, currentValue: number, evidence: string): boolean => {
    const normalizedEvidence = evidence.trim();
    if (!Number.isFinite(currentValue) || currentValue < 0 || !normalizedEvidence) return false;
    const normalizedCurrent = toApiDecimal(currentValue);
    let updated = false;
    updateSnapshot((current) => {
      const target = current.outcomes.find((outcome) => outcome.id === outcomeId);
      if (!target) return current;
      updated = true;
      return {
        ...current,
        outcomes: current.outcomes.map((outcome) => outcome.id === outcomeId
          ? appendOutcomeMetricHistory(
            outcome,
            normalizedCurrent,
            normalizedEvidence,
            new Date(),
            timeZone
          )
          : outcome),
        review: { ...current.review, metricDraft: String(normalizedCurrent) }
      };
    });
    return updated;
  }, [timeZone, updateSnapshot]);

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
      const base = hasActivePlanRef.current ? current : createEmptySnapshot(timeZone);
      return applyOnboardingPayload(base, payload, new Date(), timeZone);
    });
    hasActivePlanRef.current = true;
    setHasActivePlan(true);
    setPlannerReady(true);
    window.localStorage.removeItem(storageKeys.activePlanAbsent);
    setSyncPulse((value) => value + 1);
  }, [storageKeys.activePlanAbsent, timeZone, updateSnapshot]);

  const resetPlanner = useCallback(async (): Promise<boolean> => {
    if (!onlineRef.current || resettingRef.current) {
      setSaveStatus(onlineRef.current ? 'retry' : 'offline');
      return false;
    }

    resetEpochRef.current += 1;
    resettingRef.current = true;
    setSaveStatus('saving');
    try {
      let deleted = false;
      for (let attempt = 0; attempt < 2 && !deleted; attempt += 1) {
        const current: PlannerReadResult = await plannerApi.get();
        const revision = current.kind === 'found' ? current.aggregate.revision : null;
        try {
          if (revision !== null) {
            await plannerApi.delete(revision, createIdempotencyKey(), current.kind === 'found' ? current.etag : null);
          }
          deleted = true;
        } catch (error) {
          if (!(error instanceof PlannerConflictError) || attempt === 1) throw error;
        }
      }

      const emptySnapshot = createEmptySnapshot(timeZone);
      snapshotRef.current = emptySnapshot;
      setSnapshot(emptySnapshot);
      hasStoredSnapshotRef.current = false;
      hasActivePlanRef.current = false;
      setHasActivePlan(false);
      setPlannerReady(true);
      revisionRef.current = null;
      etagRef.current = null;
      acknowledgedSnapshotRef.current = null;
      conflictRef.current = false;
      dirtyRef.current = false;
      pendingWriteRef.current = null;
      removedTimeBlocksRef.current.clear();
      setSyncConflict(null);
      window.localStorage.removeItem(storageKeys.snapshot);
      window.localStorage.removeItem(storageKeys.syncMetadata);
      window.localStorage.removeItem(storageKeys.conflictBackup);
      window.localStorage.setItem(storageKeys.activePlanAbsent, '1');
      markServerReady();
      setSaveStatus('saved');
      return true;
    } catch (error) {
      if (error instanceof PlannerConflictError) markConflict();
      else setSaveStatus(onlineRef.current ? 'retry' : 'offline');
      return false;
    } finally {
      resettingRef.current = false;
    }
  }, [markConflict, markServerReady, storageKeys, timeZone]);

  const value = useMemo<PlannerContextValue>(() => ({
    ...snapshot,
    saveStatus,
    isOnline,
    plannerReady,
    hasActivePlan,
    retrySync,
    reloadFromServer,
    markActivePlanClosed,
    syncConflict,
    resolveConflict,
    quickCapture,
    addTask,
    updateTask,
    removeTask,
    savePlan,
    updatePlan,
    addOutcome,
    updateOutcome,
    stopOutcome,
    removeOutcome,
    setPlannerWeekOffset,
    scheduleTask,
    saveTimeBlock,
    removeTimeBlock,
    restoreTimeBlock,
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
    resetPlanner
  }), [
    snapshot,
    saveStatus,
    isOnline,
    plannerReady,
    hasActivePlan,
    retrySync,
    reloadFromServer,
    markActivePlanClosed,
    syncConflict,
    resolveConflict,
    quickCapture,
    addTask,
    updateTask,
    removeTask,
    savePlan,
    updatePlan,
    addOutcome,
    updateOutcome,
    stopOutcome,
    removeOutcome,
    setPlannerWeekOffset,
    scheduleTask,
    saveTimeBlock,
    removeTimeBlock,
    restoreTimeBlock,
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
    resetPlanner
  ]);

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export function PlannerProvider({ children }: PropsWithChildren) {
  const { subject } = useAuth();
  if (!subject) throw new Error('PlannerProvider requires an authenticated storage subject');
  return <ScopedPlannerProvider key={subject} subject={subject}>{children}</ScopedPlannerProvider>;
}

export const usePlanner = () => {
  const context = useContext(PlannerContext);
  if (!context) throw new Error('usePlanner must be used inside PlannerProvider');
  return context;
};
