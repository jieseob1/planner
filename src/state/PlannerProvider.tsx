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
const SYNC_METADATA_KEY = 'planner.mvp.sync.v1';
const CONFLICT_BACKUP_KEY = 'planner.mvp.last-conflict.v1';
const ACTIVE_PLAN_ABSENT_KEY = 'nowline.active-plan.absent.v1';
const SERVER_SYNC_DELAY_MS = 350;
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

interface SyncMetadata {
  revision: number;
  etag: string;
  acknowledgedSnapshot: string;
}

interface InitialPlannerState {
  snapshot: PlannerSnapshot;
  hasStoredSnapshot: boolean;
  metadata: SyncMetadata | null;
}

interface PendingWrite {
  snapshotKey: string;
  revision: number | null;
  idempotencyKey: string;
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

/** Merge missing v1 fields while preserving the user's existing local arrays. */
export const normalizePlannerSnapshot = (value: unknown): PlannerSnapshot => {
  const fallback = createEmptySnapshot();
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

const serializeSnapshot = (snapshot: PlannerSnapshot) => JSON.stringify(snapshot);

const parseSnapshot = (value: string | null): PlannerSnapshot | null => {
  if (!value) return null;
  try {
    return normalizePlannerSnapshot(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
};

const readSyncMetadata = (): SyncMetadata | null => {
  try {
    const value = JSON.parse(window.localStorage.getItem(SYNC_METADATA_KEY) ?? 'null') as unknown;
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

const loadInitialPlannerState = (): InitialPlannerState => {
  if (typeof window === 'undefined') {
    return { snapshot: createEmptySnapshot(), hasStoredSnapshot: false, metadata: null };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return {
      snapshot: raw ? normalizePlannerSnapshot(JSON.parse(raw) as unknown) : createEmptySnapshot(),
      hasStoredSnapshot: raw !== null,
      metadata: readSyncMetadata()
    };
  } catch {
    return { snapshot: createEmptySnapshot(), hasStoredSnapshot: false, metadata: null };
  }
};

const writeLocalSnapshot = (snapshot: PlannerSnapshot): boolean => {
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeSnapshot(snapshot));
    return true;
  } catch {
    return false;
  }
};

const writeSyncMetadata = (metadata: SyncMetadata): boolean => {
  try {
    window.localStorage.setItem(SYNC_METADATA_KEY, JSON.stringify(metadata));
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

export function PlannerProvider({ children }: PropsWithChildren) {
  const initialStateRef = useRef<InitialPlannerState | null>(null);
  if (initialStateRef.current === null) initialStateRef.current = loadInitialPlannerState();
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
    && (typeof window === 'undefined' || window.localStorage.getItem(ACTIVE_PLAN_ABSENT_KEY) !== '1')
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
        base: parseSnapshot(acknowledgedSnapshotRef.current),
        local: structuredClone(snapshotRef.current),
        server: structuredClone(serverSnapshot),
        serverRevision,
        serverEtag,
        detectedAt: new Date().toISOString()
      };
      setSyncConflict(conflict);
      try {
        window.localStorage.setItem(CONFLICT_BACKUP_KEY, JSON.stringify(conflict));
      } catch {
        // The active local and server snapshots remain in React state even if backup storage is full.
      }
    }
    setSaveStatus('conflict');
  }, []);

  const acknowledgeSnapshot = useCallback((
    revision: number,
    etag: string,
    acknowledgedSnapshot: string
  ) => {
    revisionRef.current = revision;
    etagRef.current = etag;
    acknowledgedSnapshotRef.current = acknowledgedSnapshot;
    return writeSyncMetadata({ revision, etag, acknowledgedSnapshot });
  }, []);

  const replaceWithServerSnapshot = useCallback((
    serverSnapshot: PlannerSnapshot,
    revision: number,
    etag: string
  ) => {
    const serverSnapshotKey = serializeSnapshot(serverSnapshot);
    snapshotRef.current = serverSnapshot;
    setSnapshot(serverSnapshot);
    hasActivePlanRef.current = true;
    setHasActivePlan(true);
    setPlannerReady(true);
    window.localStorage.removeItem(ACTIVE_PLAN_ABSENT_KEY);
    hasStoredSnapshotRef.current = true;
    dirtyRef.current = false;
    conflictRef.current = false;
    setSyncConflict(null);
    pendingWriteRef.current = null;
    const localStored = writeLocalSnapshot(serverSnapshot);
    const metadataStored = acknowledgeSnapshot(revision, etag, serverSnapshotKey);
    setSaveStatus(localStored && metadataStored ? 'saved' : 'storage-error');
  }, [acknowledgeSnapshot]);

  const updateSnapshot = useCallback((updater: (current: PlannerSnapshot) => PlannerSnapshot) => {
    const current = snapshotRef.current;
    const next = updater(current);
    if (next !== current) {
      snapshotRef.current = next;
      setSnapshot(next);
      hasStoredSnapshotRef.current = true;
      dirtyRef.current = true;
      localChangeCountRef.current += 1;
      const stored = writeLocalSnapshot(next);
      if (!stored) {
        setSaveStatus('storage-error');
      } else if (conflictRef.current) {
        setSaveStatus('conflict');
      } else {
        setSaveStatus(onlineRef.current ? 'saving' : 'offline');
      }
    }
    return next;
  }, []);

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
    const localStored = writeLocalSnapshot(submittedSnapshot);
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

    try {
      const result = await plannerApi.put(
        submittedSnapshot,
        submittedRevision,
        pendingWrite.idempotencyKey
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
        setSyncPulse((value) => value + 1);
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
              normalizePlannerSnapshot(latest.aggregate.snapshot),
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
    }
  }, [acknowledgeSnapshot, markConflict]);

  const initializeFromServer = useCallback(async () => {
    if (!onlineRef.current || requestInFlightRef.current || conflictRef.current) return;
    requestInFlightRef.current = true;
    const requestEpoch = resetEpochRef.current;
    setSaveStatus('checking');
    const startedAtLocalChange = localChangeCountRef.current;
    const localSnapshotKeyAtStart = serializeSnapshot(snapshotRef.current);
    const canUseCachedEtag = acknowledgedSnapshotRef.current === localSnapshotKeyAtStart
      && revisionRef.current !== null;
    let shouldBootstrap = false;
    let handshakeComplete = false;

    try {
      const result = await plannerApi.get(canUseCachedEtag ? etagRef.current : null);
      if (requestEpoch !== resetEpochRef.current) return;
      handshakeComplete = true;
      if (result.kind === 'not-modified') {
        if (!canUseCachedEtag || revisionRef.current === null) {
          setSaveStatus('retry');
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
        shouldBootstrap = hasUnsyncedLocalPlan;
        if (!hasUnsyncedLocalPlan) setSaveStatus('saved');
      } else {
        const serverSnapshot = normalizePlannerSnapshot(result.aggregate.snapshot);
        const serverSnapshotKey = serializeSnapshot(serverSnapshot);
        const currentLocalSnapshotKey = serializeSnapshot(snapshotRef.current);
        const changedWhileLoading = localChangeCountRef.current !== startedAtLocalChange;
        const localWasAcknowledged = acknowledgedSnapshotRef.current === currentLocalSnapshotKey;
        const sameSnapshot = serverSnapshotKey === currentLocalSnapshotKey;
        const canHydrate = sameSnapshot
          || (!changedWhileLoading && (!hasStoredSnapshotRef.current || !dirtyRef.current || localWasAcknowledged));

        if (canHydrate) {
          replaceWithServerSnapshot(serverSnapshot, result.aggregate.revision, result.etag);
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

    if (shouldBootstrap) void syncNow();
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
      const serverSnapshot = normalizePlannerSnapshot(result.aggregate.snapshot);
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
    window.localStorage.setItem(ACTIVE_PLAN_ABSENT_KEY, '1');
    window.localStorage.removeItem(SYNC_METADATA_KEY);
    hasActivePlanRef.current = false;
    setHasActivePlan(false);
    setPlannerReady(true);
    revisionRef.current = null;
    etagRef.current = null;
    acknowledgedSnapshotRef.current = null;
    dirtyRef.current = false;
    setSaveStatus('saved');
  }, []);

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
      resolved = normalizePlannerSnapshot(resolved);
    }

    const serverSnapshotKey = serializeSnapshot(syncConflict.server);
    acknowledgeSnapshot(syncConflict.serverRevision, syncConflict.serverEtag, serverSnapshotKey);
    snapshotRef.current = resolved;
    setSnapshot(resolved);
    writeLocalSnapshot(resolved);
    pendingWriteRef.current = null;
    conflictRef.current = false;
    dirtyRef.current = serializeSnapshot(resolved) !== serverSnapshotKey;
    setSyncConflict(null);
    setSaveStatus(dirtyRef.current ? (onlineRef.current ? 'saving' : 'offline') : 'saved');
    if (dirtyRef.current) setSyncPulse((value) => value + 1);
  }, [acknowledgeSnapshot, replaceWithServerSnapshot, syncConflict]);

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
    if (onlineRef.current) void initializeFromServer();
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
    const normalizedCurrent = toApiDecimal(currentValue);
    updateSnapshot((current) => {
      const target = current.outcomes.find((outcome) => outcome.id === outcomeId);
      if (!target) return current;
      return {
        ...current,
        outcomes: current.outcomes.map((outcome) => outcome.id === outcomeId
          ? {
            ...outcome,
            current: normalizedCurrent,
            lastUpdatedDays: 0,
            evidenceLabel: '방금 갱신',
            changeLabel: metricChangeLabel(outcome, normalizedCurrent),
            attention: outcome.neededHours > outcome.availableHours ? 'time-shortage' : 'none'
          }
          : outcome),
        review: { ...current.review, metricDraft: String(normalizedCurrent) }
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
      const base = hasActivePlanRef.current ? current : createEmptySnapshot();
      const outcomeId = safeId('outcome');
      const taskId = safeId('task');
      const candidate = {
        day: payload.day,
        startMinutes: payload.startMinutes,
        durationMinutes: Math.round(payload.estimateMinutes),
        weekOffset: payload.weekOffset
      };
      const conflict = !isValidTimeBlockSlot(candidate)
        || Boolean(findTimeBlockConflict(base.timeBlocks, candidate));
      const outcome: Outcome = {
        id: outcomeId,
        title: payload.outcomeTitle,
        parentTitle: payload.outcomeTitle,
        current: null,
        target: 1,
        unit: '결과',
        confidence: 'unknown',
        lastUpdatedDays: null,
        actualHours: 0,
        neededHours: toApiDecimal(payload.estimateMinutes / 60),
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
        ...base,
        plan: {
          ...base.plan,
          annualDirection: payload.outcomeTitle,
          quarterFocus: payload.outcomeTitle
        },
        outcomes: [outcome, ...base.outcomes],
        tasks: [task, ...base.tasks],
        timeBlocks: conflict ? base.timeBlocks : [block, ...base.timeBlocks]
      };
    });
    hasActivePlanRef.current = true;
    setHasActivePlan(true);
    setPlannerReady(true);
    window.localStorage.removeItem(ACTIVE_PLAN_ABSENT_KEY);
    setSyncPulse((value) => value + 1);
  }, [updateSnapshot]);

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
          if (revision !== null) await plannerApi.delete(revision, createIdempotencyKey());
          deleted = true;
        } catch (error) {
          if (!(error instanceof PlannerConflictError) || attempt === 1) throw error;
        }
      }

      const emptySnapshot = createEmptySnapshot();
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
      setSyncConflict(null);
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(SYNC_METADATA_KEY);
      window.localStorage.removeItem(CONFLICT_BACKUP_KEY);
      window.localStorage.setItem(ACTIVE_PLAN_ABSENT_KEY, '1');
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
  }, [markConflict, markServerReady]);

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
    resetPlanner
  ]);

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export const usePlanner = () => {
  const context = useContext(PlannerContext);
  if (!context) throw new Error('usePlanner must be used inside PlannerProvider');
  return context;
};
