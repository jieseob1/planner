export type TaskStatus = 'todo' | 'in-progress' | 'done' | 'cancelled';
export type Confidence = 'high' | 'medium' | 'low' | 'unknown';
export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface Task {
  id: string;
  title: string;
  outcomeId: string | null;
  estimateMinutes: number;
  status: TaskStatus;
  pinned: boolean;
  carryCount: number;
  note?: string;
}

export interface TimeBlock {
  id: string;
  taskId: string | null;
  title: string;
  day: DayKey;
  startMinutes: number;
  durationMinutes: number;
  external?: boolean;
  /** Absolute local calendar date (YYYY-MM-DD). This is authoritative for one-off blocks. */
  date: string;
  /** Derived compatibility field for legacy clients; `date` is authoritative. */
  weekOffset?: number;
}

export interface TimeEntry {
  id: string;
  taskId: string;
  durationSeconds: number;
  source: 'timer' | 'manual';
  observedAt: string;
  evidence?: string;
}

export interface OutcomeMetricHistoryEntry {
  id: string;
  value: number | null;
  observedAt: string;
  evidence: string;
}

export interface Outcome {
  id: string;
  title: string;
  parentTitle: string;
  current: number | null;
  target: number;
  unit: string;
  confidence: Confidence;
  /** Derived from metricUpdatedAt; legacy relative counters are never treated as timestamps. */
  lastUpdatedDays: number | null;
  metricUpdatedAt: string | null;
  nextCheckDate: string | null;
  metricHistory: OutcomeMetricHistoryEntry[];
  actualHours: number;
  neededHours: number;
  availableHours: number;
  evidenceLabel: string;
  changeLabel: string;
  attention: 'none' | 'stale' | 'time-shortage' | 'stalled' | 'no-evidence';
  decision?: 'keep' | 'reduce' | 'extend' | 'stop';
}

export type LinkedTaskDisposition = 'detach' | 'cancel';

export interface OutcomeInput {
  title: string;
  current: number | null;
  target: number;
  unit: string;
  confidence: Confidence;
  evidenceLabel: string;
  nextCheckDate: string | null;
  neededHours: number;
  availableHours: number;
}

export interface TimerSession {
  taskId: string;
  startedAt: number | null;
  accumulatedSeconds: number;
  paused: boolean;
}

export interface ReviewState {
  blocker: string | null;
  selectedTopTaskIds: string[];
  metricDraft: string;
  completedAt: string | null;
}

export interface PlanContext {
  year: number;
  annualDirection: string;
  quarter: 1 | 2 | 3 | 4;
  quarterFocus: string;
  quarterEndDate: string;
}

export interface AddTaskInput {
  title: string;
  outcomeId: string | null;
  estimateMinutes: number;
}

export interface UpdateTaskInput {
  title?: string;
  outcomeId?: string | null;
  estimateMinutes?: number;
  status?: TaskStatus;
  pinned?: boolean;
  note?: string;
}

export interface SaveTimeBlockInput {
  id?: string;
  taskId: string | null;
  title: string;
  day: DayKey;
  startMinutes: number;
  durationMinutes: number;
  /** Optional for backward-compatible callers; the provider derives it from day/weekOffset. */
  date?: string;
  weekOffset?: number;
  /** Set only by the explicit Review -> next-week carryover flow. */
  incrementCarryCount?: boolean;
}

export interface SavePlanInput {
  plan: PlanContext;
  outcomeId: string;
  outcomePatch: Pick<Outcome, 'title' | 'target' | 'neededHours' | 'availableHours'>;
}

export interface PlannerSnapshot {
  version: 1;
  plan: PlanContext;
  plannerWeekOffset: number;
  tasks: Task[];
  timeBlocks: TimeBlock[];
  timeEntries: TimeEntry[];
  outcomes: Outcome[];
  timer: TimerSession | null;
  review: ReviewState;
}

/** Server-side aggregate envelope. `revision` is the optimistic-lock version. */
export interface PlannerAggregate {
  revision: number;
  snapshot: PlannerSnapshot;
}

export type PlanStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED';

export interface PlanSummary {
  id: string;
  title: string;
  year: number;
  quarter: number;
  status: PlanStatus;
  sourceRevision: number | null;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  closedAt: string | null;
  archivedAt: string | null;
}

export interface PlanDetail {
  plan: PlanSummary;
  snapshot: PlannerSnapshot | null;
}

export interface PlanAuditEvent {
  id: string;
  planId: string;
  action: string;
  revision: number | null;
  details: Record<string, unknown>;
  occurredAt: string;
}

export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  [extension: string]: unknown;
}

export interface OnboardingPayload {
  /** Empty means start without creating a managed outcome. */
  outcomeTitle: string;
  /** Empty means start without creating a first Todo. */
  taskTitle: string;
  slot: 'today-evening' | 'tomorrow-morning' | 'saturday-morning';
  estimateMinutes: number;
  day: DayKey;
  /** Null means create the first task without assigning a calendar slot yet. */
  startMinutes: number | null;
  weekOffset: number;
}
