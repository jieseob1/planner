import { render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planHistoryApi } from '../api/planHistoryApi';
import { createDemoSnapshot } from '../data/demo';
import type { PlannerSnapshot } from '../domain/types';
import { usePlanner } from '../state/PlannerProvider';
import { buildSlots, isSlotInPast, OnboardingScreen } from './OnboardingScreen';
import { buildPlanDraftSnapshot, PlansScreen, validatePlanDraft } from './PlansScreen';
import { getReviewWeekPeriod, ReviewScreen } from './ReviewScreen';
import { TodayScreen } from './TodayScreen';
import { PlannerScreen } from './PlannerScreen';

vi.mock('../state/PlannerProvider', () => ({ usePlanner: vi.fn() }));
vi.mock('../api/planHistoryApi', () => ({
  planHistoryApi: {
    list: vi.fn(),
    create: vi.fn(),
    action: vi.fn(),
    audit: vi.fn()
  }
}));

const mockedUsePlanner = vi.mocked(usePlanner);
const mockedPlanHistoryApi = vi.mocked(planHistoryApi);

const plannerValue = (snapshot: PlannerSnapshot, overrides: Record<string, unknown> = {}) => ({
  ...snapshot,
  saveStatus: 'saved',
  isOnline: true,
  plannerReady: true,
  hasActivePlan: true,
  syncConflict: null,
  retrySync: vi.fn(),
  reloadFromServer: vi.fn(),
  markActivePlanClosed: vi.fn(),
  resolveConflict: vi.fn(),
  setPlannerWeekOffset: vi.fn(),
  addTask: vi.fn(),
  updateTask: vi.fn(),
  removeTask: vi.fn(),
  scheduleTask: vi.fn(),
  saveTimeBlock: vi.fn(),
  removeTimeBlock: vi.fn(),
  startTimer: vi.fn(),
  toggleTimer: vi.fn(),
  stopTimer: vi.fn(),
  addManualTime: vi.fn(),
  removeTimeEntry: vi.fn(),
  setOutcomeDecision: vi.fn(),
  updateOutcomeMetric: vi.fn(() => true),
  updateReview: vi.fn(),
  completeReview: vi.fn(),
  finishOnboarding: vi.fn(),
  resetPlanner: vi.fn(),
  ...overrides
}) as unknown as ReturnType<typeof usePlanner>;

const renderScreen = (component: ReactNode) => render(
  <MemoryRouter>{component}</MemoryRouter>
);

beforeEach(() => {
  vi.clearAllMocks();
  mockedPlanHistoryApi.list.mockResolvedValue([]);
  mockedPlanHistoryApi.create.mockResolvedValue(undefined as never);
  mockedPlanHistoryApi.action.mockResolvedValue(undefined as never);
  mockedPlanHistoryApi.audit.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('red-team planning flow remediation', () => {
  it('only recommends future onboarding slots, including late evenings and passed Saturday mornings', () => {
    const lateWednesday = new Date(2026, 8, 2, 21, 0);
    const saturdayAfterStart = new Date(2026, 8, 5, 10, 30);

    expect(buildSlots(lateWednesday).every((slot) => !isSlotInPast(slot, lateWednesday))).toBe(true);
    expect(buildSlots(lateWednesday)[0]).toMatchObject({ label: '내일 저녁', day: 'thu' });
    expect(buildSlots(saturdayAfterStart)[2]).toMatchObject({ label: '다음 토요일 오전', weekOffset: 1 });
    expect(buildSlots(saturdayAfterStart).every((slot) => !isSlotInPast(slot, saturdayAfterStart))).toBe(true);
  });

  it('lets a new account enter Todo and Calendar without creating a goal', async () => {
    const user = userEvent.setup();
    const source = createDemoSnapshot();
    const finishOnboarding = vi.fn();
    mockedUsePlanner.mockReturnValue(plannerValue(source, { finishOnboarding }));

    renderScreen(<OnboardingScreen />);
    await user.click(screen.getByRole('button', { name: '목표 없이 Todo·캘린더 시작' }));

    expect(finishOnboarding).toHaveBeenCalledWith(expect.objectContaining({
      outcomeTitle: '',
      taskTitle: '',
      startMinutes: null
    }));
  });

  it('derives the review period from the actual local week', () => {
    const period = getReviewWeekPeriod(new Date(2026, 8, 2, 12, 0));
    expect(period.label).toBe('8월 31일—9월 6일');
    expect(period.start).toEqual(new Date(2026, 7, 31, 0, 0, 0, 0));
    expect(period.end).toEqual(new Date(2026, 8, 7, 0, 0, 0, 0));
  });

  it('counts execution records only inside the reviewed week', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 2, 12, 0));
    const source = createDemoSnapshot();
    mockedUsePlanner.mockReturnValue(plannerValue({
      ...source,
      timeEntries: [
        { id: 'inside', taskId: source.tasks[0].id, durationSeconds: 3600, source: 'manual', observedAt: '2026-09-02T03:00:00.000Z' },
        { id: 'outside', taskId: source.tasks[0].id, durationSeconds: 7200, source: 'manual', observedAt: '2026-08-20T03:00:00.000Z' }
      ]
    }));

    renderScreen(<ReviewScreen />);

    expect(screen.getByText('1.0h')).toBeInTheDocument();
    expect(screen.queryByText('3.0h')).not.toBeInTheDocument();
  });

  it('records a weekly metric only with explicit evidence', async () => {
    const user = userEvent.setup();
    const source = createDemoSnapshot();
    const updateOutcomeMetric = vi.fn(() => true);
    mockedUsePlanner.mockReturnValue(plannerValue(source, { updateOutcomeMetric }));

    renderScreen(<ReviewScreen />);
    const valueInput = screen.getByLabelText(/현재 확인된 값/);
    await user.clear(valueInput);
    await user.type(valueInput, '5');
    await user.type(screen.getByLabelText(/확인 근거/), '주간 결제 대시보드 확인');
    await user.click(screen.getByRole('button', { name: '반영' }));

    expect(updateOutcomeMetric).toHaveBeenCalledWith(
      expect.any(String),
      5,
      '주간 결제 대시보드 확인'
    );
  });

  it('does not invent a 100 percent execution rate without a plan and keeps the 24-hour schedule before the Todo panel', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 2, 12, 0));
    const source = createDemoSnapshot();
    mockedUsePlanner.mockReturnValue(plannerValue({
      ...source,
      timer: null,
      timeBlocks: [],
      timeEntries: [
        { id: 'unplanned', taskId: source.tasks[0].id, durationSeconds: 1, source: 'manual', observedAt: '2026-09-02T03:00:00.000Z' }
      ]
    }));

    renderScreen(<TodayScreen />);

    expect(screen.getByText('계획 없음')).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
    const schedule = screen.getByRole('region', { name: /24시간 시간표/ });
    const todos = screen.getByRole('complementary', { name: '미배치 할 일' });
    expect(schedule.compareDocumentPosition(todos) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('00:00')).toBeInTheDocument();
    expect(screen.getByText('24:00')).toBeInTheDocument();
  });

  it('uses an action that navigates to Today instead of claiming an unpersisted plan confirmation', () => {
    const source = createDemoSnapshot();
    mockedUsePlanner.mockReturnValue(plannerValue(source));

    renderScreen(<PlannerScreen />);

    expect(screen.getByRole('link', { name: /오늘 실행 보기/ })).toHaveAttribute('href', '/today');
    expect(screen.queryByRole('button', { name: /계획 확정/ })).not.toBeInTheDocument();
  });

  it('creates plan drafts without copying execution history and can start completely blank', () => {
    const source = createDemoSnapshot();
    const input = {
      year: 2027,
      quarter: 1,
      annualDirection: '지속 가능한 제품',
      quarterFocus: '첫 유료 고객 확보',
      copyScope: 'goal-structure' as const
    };
    const draft = buildPlanDraftSnapshot(source, input);

    expect(draft.tasks).toEqual([]);
    expect(draft.timeBlocks).toEqual([]);
    expect(draft.timeEntries).toEqual([]);
    expect(draft.timer).toBeNull();
    expect(draft.review).toEqual({ blocker: null, selectedTopTaskIds: [], metricDraft: '', completedAt: null });
    expect(draft.outcomes).toHaveLength(source.outcomes.length);
    expect(draft.outcomes.every((outcome) => (
      outcome.current === null
      && outcome.metricUpdatedAt === null
      && outcome.nextCheckDate === null
      && outcome.metricHistory.length === 0
      && outcome.actualHours === 0
      && outcome.decision === undefined
      && outcome.attention === 'no-evidence'
    ))).toBe(true);
    expect(buildPlanDraftSnapshot(source, { ...input, copyScope: 'blank' }).outcomes).toEqual([]);
  });

  it('returns field-specific errors instead of silently ignoring an incomplete plan', () => {
    expect(validatePlanDraft('', {
      year: 12,
      quarter: 1,
      annualDirection: '',
      quarterFocus: '',
      copyScope: 'blank'
    })).toEqual({
      title: '계획 이름을 입력하세요.',
      year: '1900~9999 사이의 연도를 입력하세요.',
      annualDirection: '1년 방향을 입력하세요.',
      quarterFocus: '이번 분기 초점을 입력하세요.'
    });
  });

  it('shows every active task and lets an all-complete week finish without a Top 3', async () => {
    const user = userEvent.setup();
    const source = createDemoSnapshot();
    const allComplete = {
      ...source,
      tasks: source.tasks.map((task) => ({ ...task, status: 'done' as const })),
      review: { ...source.review, blocker: 'none', metricDraft: '24', selectedTopTaskIds: [] }
    };
    const completeReview = vi.fn();
    const setPlannerWeekOffset = vi.fn();
    mockedUsePlanner.mockReturnValue(plannerValue(allComplete, { completeReview, setPlannerWeekOffset }));

    const allCompleteView = renderScreen(<ReviewScreen />);

    expect(screen.getByText('진행 중인 일이 없습니다. Top 3 없이 회고를 마칠 수 있습니다.')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/확인 근거/), '주간 점검에서 직접 확인');
    await user.click(screen.getByRole('button', { name: /주간 점검 완료/ }));
    expect(setPlannerWeekOffset).toHaveBeenCalledWith(1);
    expect(completeReview).toHaveBeenCalledTimes(1);
    allCompleteView.unmount();

    const manyTasks = {
      ...source,
      tasks: Array.from({ length: 8 }, (_, index) => ({
        ...source.tasks[0],
        id: `task-${index + 1}`,
        title: `선택 가능한 작업 ${index + 1}`,
        carryCount: 0
      })),
      review: { ...source.review, completedAt: null }
    };
    mockedUsePlanner.mockReturnValue(plannerValue(manyTasks));
    renderScreen(<ReviewScreen />);
    expect(screen.getByText('선택 가능한 작업 8')).toBeInTheDocument();
  });

  it('opens both carryover and completion actions on the actual next-week Planner', async () => {
    const user = userEvent.setup();
    const source = createDemoSnapshot();
    const setPlannerWeekOffset = vi.fn();
    mockedUsePlanner.mockReturnValue(plannerValue(source, { setPlannerWeekOffset }));

    const carryoverView = renderScreen(<ReviewScreen />);
    await user.click(screen.getAllByRole('link', { name: '다음 주로' })[0]);
    expect(setPlannerWeekOffset).toHaveBeenLastCalledWith(1);
    carryoverView.unmount();

    const completed = { ...source, review: { ...source.review, completedAt: '2026-09-02T12:00:00.000Z' } };
    mockedUsePlanner.mockReturnValue(plannerValue(completed, { setPlannerWeekOffset }));
    renderScreen(<ReviewScreen />);
    await user.click(screen.getByRole('link', { name: /다음 주 시간 배치/ }));
    expect(setPlannerWeekOffset).toHaveBeenLastCalledWith(1);
  });

  it('marks carryover only after the explicit next-week editor saves successfully', async () => {
    const user = userEvent.setup();
    const source = { ...createDemoSnapshot(), plannerWeekOffset: 1 };
    const task = source.tasks[0];
    const saveTimeBlock = vi.fn(() => true);
    mockedUsePlanner.mockReturnValue(plannerValue(source, { saveTimeBlock }));

    const savedView = render(
      <MemoryRouter initialEntries={[`/planner?action=reschedule&task=${task.id}`]}>
        <PlannerScreen />
      </MemoryRouter>
    );
    const saveDialog = await screen.findByRole('dialog', { name: '할 일 또는 일정 추가' });
    await user.click(within(saveDialog).getByRole('button', { name: '추가' }));
    expect(saveTimeBlock).toHaveBeenCalledWith(expect.objectContaining({
      taskId: task.id,
      weekOffset: 1,
      incrementCarryCount: true
    }));
    savedView.unmount();

    saveTimeBlock.mockClear();
    mockedUsePlanner.mockReturnValue(plannerValue(source, { saveTimeBlock }));
    render(
      <MemoryRouter initialEntries={[`/planner?action=reschedule&task=${task.id}`]}>
        <PlannerScreen />
      </MemoryRouter>
    );
    const cancelledDialog = await screen.findByRole('dialog', { name: '할 일 또는 일정 추가' });
    await user.click(within(cancelledDialog).getByRole('button', { name: '취소' }));
    expect(saveTimeBlock).not.toHaveBeenCalled();
  });

  it('starts a fresh review automatically after a previously completed week ends', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 9, 12, 0));
    const source = createDemoSnapshot();
    const updateReview = vi.fn();
    mockedUsePlanner.mockReturnValue(plannerValue({
      ...source,
      review: {
        blocker: 'scope',
        selectedTopTaskIds: [source.tasks[0].id],
        metricDraft: '12',
        completedAt: '2026-09-02T12:00:00.000Z'
      }
    }, { updateReview }));

    renderScreen(<ReviewScreen />);

    expect(screen.getByRole('heading', { name: '한 주를 닫고, 다음 주를 고릅니다.' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '다음 주의 기준이 정해졌습니다.' })).not.toBeInTheDocument();
    await waitFor(() => expect(updateReview).toHaveBeenCalledWith({
      blocker: null,
      selectedTopTaskIds: [],
      metricDraft: '',
      completedAt: null
    }));
  });

  it('discloses unresolved carryovers before review completion', () => {
    const source = createDemoSnapshot();
    mockedUsePlanner.mockReturnValue(plannerValue(source));

    renderScreen(<ReviewScreen />);

    expect(screen.getByText(/이월 작업 2개가 아직 다음 주에 배치되지 않았습니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /주간 점검 완료 · 이월 2개 남김/ })).toBeInTheDocument();
  });

  it('shows required plan errors in the modal and submits a clean structural copy', async () => {
    const user = userEvent.setup();
    const source = createDemoSnapshot();
    mockedUsePlanner.mockReturnValue(plannerValue(source));
    renderScreen(<PlansScreen />);

    await user.click(screen.getByRole('button', { name: '새 계획' }));
    const dialog = screen.getByRole('dialog', { name: '새 연간·분기 계획' });
    const annualDirection = within(dialog).getByLabelText('1년 방향');
    await user.clear(annualDirection);
    await user.click(within(dialog).getByRole('button', { name: '초안 만들기' }));

    expect(within(dialog).getByText('1년 방향을 입력하세요.')).toBeInTheDocument();
    expect(within(dialog).getByText('이번 분기 초점을 입력하세요.')).toBeInTheDocument();
    expect(mockedPlanHistoryApi.create).not.toHaveBeenCalled();

    await user.type(annualDirection, '작은 팀을 위한 실행 도구');
    await user.type(within(dialog).getByLabelText('이번 분기 초점'), '베타 사용자 20명');
    await user.click(within(dialog).getByRole('button', { name: '초안 만들기' }));

    await waitFor(() => expect(mockedPlanHistoryApi.create).toHaveBeenCalledTimes(1));
    const createdSnapshot = mockedPlanHistoryApi.create.mock.calls[0][2];
    expect(createdSnapshot.tasks).toEqual([]);
    expect(createdSnapshot.timeBlocks).toEqual([]);
    expect(createdSnapshot.timeEntries).toEqual([]);
    expect(createdSnapshot.outcomes.every((outcome) => outcome.actualHours === 0 && outcome.current === null)).toBe(true);
  });

  it('does not enter Today with a stale snapshot when activated-plan reload fails', async () => {
    const user = userEvent.setup();
    const source = createDemoSnapshot();
    const reloadFromServer = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    mockedUsePlanner.mockReturnValue(plannerValue(source, { reloadFromServer }));
    mockedPlanHistoryApi.list.mockResolvedValue([{
      id: '11111111-1111-4111-8111-111111111111',
      title: '다음 분기 계획',
      year: 2026,
      quarter: 4,
      status: 'DRAFT',
      sourceRevision: 1,
      createdAt: '2026-09-02T00:00:00Z',
      updatedAt: '2026-09-02T00:00:00Z',
      activatedAt: null,
      closedAt: null,
      archivedAt: null
    }]);

    renderScreen(<PlansScreen />);
    await user.click(await screen.findByRole('button', { name: '이 계획 실행' }));

    expect(await screen.findByText(/계획은 활성화됐지만 새 내용을 불러오지 못했습니다/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '활성 계획 다시 불러오기' }));
    expect(reloadFromServer).toHaveBeenCalledTimes(2);
  });

  it('allows onboarding to create an unplaced task explicitly', async () => {
    const user = userEvent.setup();
    const source = createDemoSnapshot();
    const finishOnboarding = vi.fn();
    mockedUsePlanner.mockReturnValue(plannerValue(source, { finishOnboarding }));
    renderScreen(<OnboardingScreen />);

    await user.type(screen.getByLabelText('결과 한 문장'), '고객 인터뷰 5회 완료');
    await user.click(screen.getByRole('button', { name: '계속' }));
    await user.type(screen.getByLabelText('첫 번째 다음 행동'), '첫 인터뷰 질문 작성');
    await user.click(screen.getByRole('button', { name: '계속' }));
    await user.click(screen.getByRole('radio', { name: '직접 선택' }));
    expect(screen.getByLabelText('주')).toBeInTheDocument();
    expect(screen.getByLabelText('요일')).toBeInTheDocument();
    expect(screen.getByLabelText('시작 시간')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: '나중에 정하기' }));
    await user.click(screen.getByRole('button', { name: /첫 실행 만들기/ }));

    expect(finishOnboarding).toHaveBeenCalledWith(expect.objectContaining({
      outcomeTitle: '고객 인터뷰 5회 완료',
      taskTitle: '첫 인터뷰 질문 작성',
      startMinutes: null,
      weekOffset: 0
    }));
  });
});
