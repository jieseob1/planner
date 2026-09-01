import type { DayKey, Outcome, PlanContext, PlannerSnapshot, Task, TimeBlock } from '../domain/types';
import { getToday, weekDayMeta } from '../lib/calendarDate';

export const weekDays: Array<{ key: DayKey; short: string; date: string }> = [
  { key: 'mon', short: '월', date: '31' },
  { key: 'tue', short: '화', date: '1' },
  { key: 'wed', short: '수', date: '2' },
  { key: 'thu', short: '목', date: '3' },
  { key: 'fri', short: '금', date: '4' },
  { key: 'sat', short: '토', date: '5' },
  { key: 'sun', short: '일', date: '6' }
];

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
    actualHours: 18,
    neededHours: 6,
    availableHours: 12,
    evidenceLabel: '3일 전 갱신',
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
    actualHours: 6,
    neededHours: 22,
    availableHours: 9,
    evidenceLabel: '갱신 지연 9일',
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
    lastUpdatedDays: 12,
    actualHours: 4,
    neededHours: 4,
    availableHours: 9,
    evidenceLabel: '갱신 지연 12일',
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
    lastUpdatedDays: 61,
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
    weekOffset: 0
  },
  {
    id: 'block-diagram',
    taskId: 'task-diagram',
    title: '다이어그램 작성',
    day: demoToday.key,
    startMinutes: 1170,
    durationMinutes: 90,
    weekOffset: 0
  },
  {
    id: 'block-draft',
    taskId: 'task-draft',
    title: '글 초안',
    day: demoTomorrow,
    startMinutes: 1170,
    durationMinutes: 90,
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
