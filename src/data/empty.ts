import type { PlanContext, PlannerSnapshot } from '../domain/types';
import { toLocalDate } from '../lib/calendarDate';

const currentPlan = (timeZone?: string, now = new Date()): PlanContext => {
  const [year, month] = toLocalDate(now, timeZone).split('-').map(Number);
  const quarter = (Math.floor((month - 1) / 3) + 1) as PlanContext['quarter'];
  const quarterEnd = new Date(Date.UTC(year, quarter * 3, 0));

  return {
    year,
    annualDirection: '',
    quarter,
    quarterFocus: '',
    quarterEndDate: quarterEnd.toISOString().slice(0, 10)
  };
};

export const createEmptySnapshot = (timeZone?: string, now = new Date()): PlannerSnapshot => ({
  version: 1,
  plan: currentPlan(timeZone, now),
  plannerWeekOffset: 0,
  tasks: [],
  timeBlocks: [],
  timeEntries: [],
  outcomes: [],
  timer: null,
  review: {
    blocker: null,
    selectedTopTaskIds: [],
    metricDraft: '',
    completedAt: null
  }
});
