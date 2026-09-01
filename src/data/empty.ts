import type { PlanContext, PlannerSnapshot } from '../domain/types';

const currentPlan = (): PlanContext => {
  const today = new Date();
  const year = today.getFullYear();
  const quarter = (Math.floor(today.getMonth() / 3) + 1) as PlanContext['quarter'];
  const quarterEnd = new Date(Date.UTC(year, quarter * 3, 0));

  return {
    year,
    annualDirection: '',
    quarter,
    quarterFocus: '',
    quarterEndDate: quarterEnd.toISOString().slice(0, 10)
  };
};

export const createEmptySnapshot = (): PlannerSnapshot => ({
  version: 1,
  plan: currentPlan(),
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
