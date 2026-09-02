import type { DayKey, Outcome, PlanContext, PlannerSnapshot, Task, TimeBlock } from '../domain/types';
import { getDateForDay, getToday, getWeekDays, weekDayMeta } from '../lib/calendarDate';

export const weekDays: Array<{ key: DayKey; short: string; date: string }> = getWeekDays(0)
  .map(({ key, short, date }) => ({ key, short, date }));

const demoToday = getToday();
const demoTomorrow = weekDayMeta[(demoToday.index + 1) % 7].key;

export const demoPlan: PlanContext = {
  year: 2026,
  annualDirection: '시장에 증명할 백엔드 역량과 수익 기반 만들기',
  quarter: 3,
  quarterFocus: '포트폴리오 공개 · 첫 유료 검증',
  quarterEndDate: '2026-09-30'
};

export const demoOutcomes: Outcome[] = [
  {
    id: 'outcome-writing',
    title: '기술 글 6개 발행',
    parentTitle: '백엔드 포트폴리오 완성',
    current: 2,
    target: 6,
    unit: '편',
    confidence: 'medium',
    lastUpdatedDays: 3,
    metricUpdatedAt: '2026-08-30T03:00:00.000Z',
    nextCheckDate: '2026-09-04',
    metricHistory: [
      { id: 'metric-writing-1', value: 1, observedAt: '2026-08-23T03:00:00.000Z', evidence: '게시 URL 1건 확인' },
      { id: 'metric-writing-2', value: 2, observedAt: '2026-08-30T03:00:00.000Z', evidence: '게시 URL 2건 확인' }
    ],
    actualHours: 18,
    neededHours: 6,
    availableHours: 12,
    evidenceLabel: '게시 URL 2건 확인',
    changeLabel: '지난 갱신 대비 변화 없음',
    attention: 'stalled'
  },
  {
    id: 'outcome-redis',
    title: 'Redis Streams 배포',
    parentTitle: '백엔드 포트폴리오 완성',
    current: 2,
    target: 4,
    unit: '단계',
    confidence: 'low',
    lastUpdatedDays: 9,
    metricUpdatedAt: '2026-08-24T03:00:00.000Z',
    nextCheckDate: '2026-09-01',
    metricHistory: [
      { id: 'metric-redis-1', value: 1, observedAt: '2026-08-17T03:00:00.000Z', evidence: '로컬 소비자 테스트 통과' },
      { id: 'metric-redis-2', value: 2, observedAt: '2026-08-24T03:00:00.000Z', evidence: '스테이징 배포 로그 확인' }
    ],
    actualHours: 6,
    neededHours: 22,
    availableHours: 9,
    evidenceLabel: '스테이징 배포 로그 확인',
    changeLabel: '지난 갱신 대비 +1단계',
    attention: 'time-shortage'
  },
  {
    id: 'outcome-revenue',
    title: '사이드 수익 월 80만원',
    parentTitle: '사이드 수익 만들기',
    current: null,
    target: 80,
    unit: '만원',
    confidence: 'unknown',
    lastUpdatedDays: null,
    metricUpdatedAt: null,
    nextCheckDate: '2026-09-03',
    metricHistory: [],
    actualHours: 4,
    neededHours: 4,
    availableHours: 9,
    evidenceLabel: '근거 없음',
    changeLabel: '현재 미확인',
    attention: 'stale'
  },
  {
    id: 'outcome-interview',
    title: '영어 인터뷰 준비',
    parentTitle: '백엔드 포트폴리오 완성',
    current: null,
    target: 5,
    unit: '회',
    confidence: 'low',
    lastUpdatedDays: null,
    metricUpdatedAt: null,
    nextCheckDate: null,
    metricHistory: [],
    actualHours: 0,
    neededHours: 8,
    availableHours: 0,
    evidenceLabel: '근거 없음',
    changeLabel: '7일간 실행 기록 없음',
    attention: 'no-evidence'
  }
];

export const demoTasks: Task[] = [
  {
    id: 'task-diagram',
    title: '장애 복구 흐름 다이어그램 작성',
    outcomeId: 'outcome-redis',
    estimateMinutes: 90,
    status: 'todo',
    pinned: true,
    carryCount: 3
  },
  {
    id: 'task-draft',
    title: '기술 글 3편 초안',
    outcomeId: 'outcome-writing',
    estimateMinutes: 40,
    status: 'in-progress',
    pinned: true,
    carryCount: 0
  },
  {
    id: 'task-invoice',
    title: '세금계산서 발행',
    outcomeId: null,
    estimateMinutes: 15,
    status: 'todo',
    pinned: false,
    carryCount: 0
  },
  {
    id: 'task-benchmark',
    title: '벤치마크 스크립트 작성',
    outcomeId: 'outcome-redis',
    estimateMinutes: 120,
    status: 'todo',
    pinned: false,
    carryCount: 0
  },
  {
    id: 'task-cases',
    title: 'Redis 장애 사례 3개 정리',
    outcomeId: 'outcome-redis',
    estimateMinutes: 50,
    status: 'todo',
    pinned: false,
    carryCount: 1
  },
  {
    id: 'task-outline',
    title: '글 4편 개요 잡기',
    outcomeId: 'outcome-writing',
    estimateMinutes: 60,
    status: 'todo',
    pinned: false,
    carryCount: 0
  }
];

export const demoTimeBlocks: TimeBlock[] = [
  {
    id: 'block-standup',
    taskId: null,
    title: '팀 스탠드업',
    day: demoToday.key,
    startMinutes: 600,
    durationMinutes: 60,
    external: true,
    date: getDateForDay(demoToday.key, 0),
    weekOffset: 0
  },
  {
    id: 'block-client',
    taskId: null,
    title: '고객 미팅',
    day: demoToday.key,
    startMinutes: 840,
    durationMinutes: 60,
    external: true,
    date: getDateForDay(demoToday.key, 0),
    weekOffset: 0
  },
  {
    id: 'block-diagram',
    taskId: 'task-diagram',
    title: '다이어그램 작성',
    day: demoToday.key,
    startMinutes: 1170,
    durationMinutes: 90,
    date: getDateForDay(demoToday.key, 0),
    weekOffset: 0
  },
  {
    id: 'block-draft',
    taskId: 'task-draft',
    title: '글 초안',
    day: demoTomorrow,
    startMinutes: 1170,
    durationMinutes: 90,
    date: getDateForDay(demoTomorrow, demoToday.index === 6 ? 1 : 0),
    weekOffset: demoToday.index === 6 ? 1 : 0
  }
];

export const createDemoSnapshot = (): PlannerSnapshot => ({
  version: 1,
  plan: { ...demoPlan },
  plannerWeekOffset: 0,
  tasks: demoTasks.map((task) => ({ ...task })),
  timeBlocks: demoTimeBlocks.map((block) => ({ ...block })),
  timeEntries: [],
  outcomes: demoOutcomes.map((outcome) => ({ ...outcome })),
  timer: null,
  review: {
    blocker: null,
    selectedTopTaskIds: ['task-diagram', 'task-draft'],
    metricDraft: '',
    completedAt: null
  }
});
