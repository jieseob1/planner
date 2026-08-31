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
  /** Missing values belong to the original/current week for v1 snapshots. */
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

export interface Outcome {
  id: string;
  title: string;
  parentTitle: string;
  current: number | null;
  target: number;
  unit: string;
  confidence: Confidence;
  lastUpdatedDays: number | null;
  actualHours: number;
  neededHours: number;
  availableHours: number;
  evidenceLabel: string;
  changeLabel: string;
  attention: 'none' | 'stale' | 'time-shortage' | 'stalled' | 'no-evidence';
  decision?: 'keep' | 'reduce' | 'extend' | 'stop';
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

export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  [extension: string]: unknown;
}

export interface OnboardingPayload {
  outcomeTitle: string;
  taskTitle: string;
  slot: 'today-evening' | 'tomorrow-morning' | 'saturday-morning';
  estimateMinutes: number;
}
