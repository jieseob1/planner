import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptySnapshot } from '../data/empty';
import type { PlannerSnapshot, SaveTimeBlockInput, Task, TimeBlock } from '../domain/types';
import { usePlanner } from '../state/PlannerProvider';
import { TodayScreen } from './TodayScreen';
import { PlannerScreen } from './PlannerScreen';
import { QUICK_CAPTURE_EVENT } from '../lib/quickCapture';

vi.mock('../state/PlannerProvider', () => ({ usePlanner: vi.fn() }));
vi.mock('../timezone/TimeZoneProvider', () => ({
  useTimeZone: () => ({ timeZone: 'UTC' })
}));

const mockedUsePlanner = vi.mocked(usePlanner);
const TODAY = '2026-09-02';

const task = (patch: Partial<Task> = {}): Task => ({
  id: 'task-one',
  title: '집중 작업',
  outcomeId: null,
  estimateMinutes: 30,
  status: 'todo',
  pinned: false,
  carryCount: 0,
  plannedDate: TODAY,
  ...patch
});

const block = (patch: Partial<TimeBlock> = {}): TimeBlock => ({
  id: 'block-one',
  taskId: 'task-one',
  title: '집중 작업',
  day: 'wed',
  date: TODAY,
  startMinutes: 600,
  durationMinutes: 30,
  weekOffset: 0,
  ...patch
});

const plannerValue = (snapshot: PlannerSnapshot, overrides: Record<string, unknown> = {}) => ({
  ...snapshot,
  saveStatus: 'saved',
  isOnline: false,
  plannerReady: true,
  hasActivePlan: true,
  syncConflict: null,
  retrySync: vi.fn(),
  reloadFromServer: vi.fn(),
  markActivePlanClosed: vi.fn(),
  resolveConflict: vi.fn(),
  quickCapture: vi.fn(),
  addTask: vi.fn(() => 'task-created'),
  updateTask: vi.fn(() => true),
  rescheduleTask: vi.fn(() => true),
  removeTask: vi.fn(() => true),
  savePlan: vi.fn(),
  updatePlan: vi.fn(() => true),
  addOutcome: vi.fn(),
  updateOutcome: vi.fn(() => true),
  stopOutcome: vi.fn(() => true),
  removeOutcome: vi.fn(() => true),
  setPlannerWeekOffset: vi.fn(),
  scheduleTask: vi.fn(() => true),
  saveTimeBlock: vi.fn(() => true),
  removeTimeBlock: vi.fn(() => true),
  restoreTimeBlock: vi.fn(() => true),
  startTimer: vi.fn(),
  toggleTimer: vi.fn(),
  stopTimer: vi.fn(),
  addManualTime: vi.fn(() => 'entry-one'),
  removeTimeEntry: vi.fn(),
  setOutcomeDecision: vi.fn(),
  updateOutcomeMetric: vi.fn(() => true),
  updateReview: vi.fn(),
  completeReview: vi.fn(),
  finishOnboarding: vi.fn(),
  resetPlanner: vi.fn(),
  ...overrides
}) as unknown as ReturnType<typeof usePlanner>;

const snapshotWith = (tasks: Task[] = [], timeBlocks: TimeBlock[] = []): PlannerSnapshot => ({
  ...createEmptySnapshot('UTC'),
  tasks,
  timeBlocks
});

const installMatchMedia = (matches: boolean) => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true)
  })));
};

const installMutableMatchMedia = (initialMatches: boolean) => {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    get matches() { return matches; },
    media: '(max-width: 800px)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener)),
    dispatchEvent: vi.fn(() => true)
  };
  vi.stubGlobal('matchMedia', vi.fn(() => query));
  return (nextMatches: boolean) => {
    matches = nextMatches;
    listeners.forEach((listener) => listener({ matches } as MediaQueryListEvent));
  };
};

const renderToday = () => render(
  <MemoryRouter>
    <TodayScreen />
  </MemoryRouter>
);

const timelineGrid = () => screen.getByLabelText(
  '00시부터 24시까지 15분 단위 시간표. 빈 시간을 누르거나 드래그해 일정을 만듭니다.'
);

const giveTimelineBounds = (element: HTMLElement) => {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 400,
    bottom: 1_536,
    width: 400,
    height: 1_536,
    toJSON: () => ({})
  });
};

describe('Today direct calendar integration', () => {
  it('uses a seven-column time calendar as the default desktop Planner, not the old goal matrix', () => {
    render(<MemoryRouter><PlannerScreen /></MemoryRouter>);
    expect(document.querySelectorAll('.planning-week-body .today-direct-grid')).toHaveLength(7);
    expect(screen.getByRole('button', { name: '주간' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('table', { name: '목표 결과별 7일 시간표' })).not.toBeInTheDocument();
  });

  it('creates on the clicked week column even when a different date is selected', () => {
    const value = plannerValue(snapshotWith()); mockedUsePlanner.mockReturnValue(value);
    render(<MemoryRouter><PlannerScreen /></MemoryRouter>);
    const grid = document.querySelector('[data-day="tue"]') as HTMLElement; giveTimelineBounds(grid);
    const pointer = { button: 0, clientY: 640, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    fireEvent.pointerDown(grid, pointer); fireEvent.pointerUp(grid, pointer);
    fireEvent.change(screen.getByLabelText('새 일정 제목'), { target: { value: '화요일 공부' } });
    fireEvent.change(screen.getByLabelText('새 일정 시작 시간'), { target: { value: '18:00' } });
    fireEvent.change(screen.getByLabelText('새 일정 종료 시간'), { target: { value: '20:00' } });
    fireEvent.click(screen.getByRole('button', { name: '새 일정 저장' }));
    expect(value.addTask).toHaveBeenCalledWith(expect.objectContaining({ title: '화요일 공부', plannedDate: '2026-09-01' }));
    expect(value.saveTimeBlock).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-09-01', day: 'tue', startMinutes: 1080, durationMinutes: 120 }));
  });

  it('keeps the original date when resizing a block in another week column', () => {
    const value = plannerValue(snapshotWith([task()], [block({ date: '2026-09-01', day: 'tue' })])); mockedUsePlanner.mockReturnValue(value);
    render(<MemoryRouter><PlannerScreen /></MemoryRouter>);
    fireEvent.keyDown(screen.getByRole('button', { name: /집중 작업.*할 일 시간 블록/ }), { key: 'Enter' });
    fireEvent.change(screen.getByLabelText('종료 시간'), { target: { value: '11:00' } });
    fireEvent.click(screen.getByRole('button', { name: '변경 저장' }));
    expect(value.saveTimeBlock).toHaveBeenCalledWith(expect.objectContaining({ id: 'block-one', date: '2026-09-01', day: 'tue', startMinutes: 600, durationMinutes: 60 }));
  });

  it('preserves quick-entry drafts and the selected date when switching all calendar views', () => {
    render(<MemoryRouter initialEntries={['/planner?date=2026-09-03']}><PlannerScreen /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('빠른 메모'), { target: { value: '작성 중인 할 일' } });
    fireEvent.click(screen.getByRole('button', { name: '월간' }));
    expect(screen.getByRole('region', { name: '월간 일정표' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '일간' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('9월 3일');
    expect(screen.getByLabelText('빠른 메모')).toHaveValue('작성 중인 할 일');
  });

  it('creates an independent monthly event on its exact selected date', () => {
    const value = plannerValue(snapshotWith()); mockedUsePlanner.mockReturnValue(value);
    render(<MemoryRouter initialEntries={['/planner?view=month&date=2026-09-03']}><PlannerScreen /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '2026년 9월 25일 일정 추가' }));
    fireEvent.change(screen.getByLabelText('일정 제목'), { target: { value: '월간 독립 일정' } });
    fireEvent.change(screen.getByLabelText('시작', { exact: true }), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('종료', { exact: true }), { target: { value: '30' } });
    fireEvent.submit(screen.getByLabelText('일정 제목').closest('form')!);
    expect(value.saveTimeBlock).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-09-25', day: 'fri', title: '월간 독립 일정', taskId: null, startMinutes: 0, durationMinutes: 30 }));
    expect(value.addTask).not.toHaveBeenCalled();
  });

  it('starts mobile Planner with the same task-first daily controls', () => {
    installMatchMedia(true); render(<MemoryRouter><PlannerScreen /></MemoryRouter>);
    expect(screen.getByRole('button', { name: '일간', hidden: true })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /^시간표/ }));
    expect(screen.getByRole('button', { name: '일간' })).toBeInTheDocument();
  });

  it('adds into the active later list and preserves the draft if creation is rejected', () => {
    const value = plannerValue(snapshotWith()); mockedUsePlanner.mockReturnValue(value); renderToday();
    fireEvent.click(screen.getByRole('button', { name: /^나중에/ }));
    const input = screen.getByPlaceholderText('나중에 할 일 추가');
    fireEvent.change(input, { target: { value: '나중에 공부' } }); fireEvent.keyDown(input, { key: 'Enter' });
    expect(value.addTask).toHaveBeenCalledWith(expect.objectContaining({ title: '나중에 공부', plannedDate: 'later' }));
    vi.mocked(value.addTask).mockReturnValueOnce('');
    fireEvent.change(input, { target: { value: '사라지면 안 되는 초안' } }); fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('사라지면 안 되는 초안');
  });

  it('preserves an independently changed remote time while saving a local monthly title edit', () => {
    const original = block({ taskId: null, title: '독립 일정' });
    const value = plannerValue(snapshotWith([], [original])); mockedUsePlanner.mockReturnValue(value);
    const ui = render(<MemoryRouter initialEntries={['/planner?view=month&date=2026-09-02']}><PlannerScreen /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '2026년 9월 2일 10:00 독립 일정 일정 수정' }));
    fireEvent.change(screen.getByLabelText('일정 제목'), { target: { value: '이 기기의 새 제목' } });
    mockedUsePlanner.mockReturnValue({ ...value, timeBlocks: [{ ...original, startMinutes: 720 }] });
    ui.rerender(<MemoryRouter><PlannerScreen /></MemoryRouter>);
    fireEvent.submit(screen.getByLabelText('일정 제목').closest('form')!);
    expect(value.saveTimeBlock).toHaveBeenCalledWith(expect.objectContaining({ id: original.id, title: '이 기기의 새 제목', startMinutes: 720, durationMinutes: 30 }));
  });

  it('retains the month editor when another device changes the same time range', () => {
    const original = block({ taskId: null, title: '독립 일정' });
    const value = plannerValue(snapshotWith([], [original])); mockedUsePlanner.mockReturnValue(value);
    const ui = render(<MemoryRouter initialEntries={['/planner?view=month&date=2026-09-02']}><PlannerScreen /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '2026년 9월 2일 10:00 독립 일정 일정 수정' }));
    fireEvent.change(screen.getByLabelText('시작', { exact: true }), { target: { value: '660' } });
    mockedUsePlanner.mockReturnValue({ ...value, timeBlocks: [{ ...original, startMinutes: 720 }] });
    ui.rerender(<MemoryRouter><PlannerScreen /></MemoryRouter>);
    fireEvent.submit(screen.getByLabelText('일정 제목').closest('form')!);
    expect(screen.getByRole('alert')).toHaveTextContent('다른 기기에서 같은 일정의 시간이 바뀌었습니다');
    expect(screen.getByLabelText('시작', { exact: true })).toHaveValue('660'); expect(value.saveTimeBlock).not.toHaveBeenCalled();
  });
  it('opens the exact date from a notification link, and can return to today', () => {
    mockedUsePlanner.mockReturnValue(plannerValue(snapshotWith([task()], [block({ date: '2026-09-03', day: 'thu', title: '자정 뒤 일정' })])));
    render(<MemoryRouter initialEntries={['/today?date=2026-09-03']}><TodayScreen /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('9월 3일');
    expect(screen.getByRole('button', { name: /자정 뒤 일정.*할 일 시간 블록/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '오늘' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('9월 2일');
    expect(screen.queryByRole('button', { name: /자정 뒤 일정.*할 일 시간 블록/ })).not.toBeInTheDocument();
  });

  it('falls back to today for an invalid notification date', () => {
    render(<MemoryRouter initialEntries={['/today?date=2026-02-31']}><TodayScreen /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('9월 2일');
  });

  it('opens an unscheduled Todo editor and saves its title without adding a goal', () => {
    const value = plannerValue(snapshotWith([task()]));
    mockedUsePlanner.mockReturnValue(value);
    renderToday();
    fireEvent.click(screen.getByRole('button', { name: '집중 작업 수정' }));
    fireEvent.change(screen.getByLabelText('할 일 제목'), { target: { value: '수정한 작업' } });
    fireEvent.click(screen.getByRole('button', { name: '변경 저장' }));
    expect(value.updateTask).toHaveBeenCalledWith('task-one', { title: '수정한 작업' });
  });

  it('allows reopening and deleting completed Todos from the folded list', () => {
    const value = plannerValue(snapshotWith([task({ status: 'done', plannedDate: 'later' })]));
    mockedUsePlanner.mockReturnValue(value);
    renderToday();
    fireEvent.click(screen.getByText('완료·취소한 할 일 (1)'));
    fireEvent.click(screen.getByRole('button', { name: '집중 작업 수정' }));
    fireEvent.change(screen.getByLabelText('상태'), { target: { value: 'todo' } });
    fireEvent.click(screen.getByRole('button', { name: '변경 저장' }));
    expect(value.updateTask).toHaveBeenCalledWith('task-one', expect.objectContaining({ status: 'todo' }));
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-02T12:00:00.000Z'));
    vi.clearAllMocks();
    window.localStorage.clear();
    window.history.replaceState(null, '', '/today');
    installMatchMedia(false);
    mockedUsePlanner.mockReturnValue(plannerValue(snapshotWith()));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('places the Todo entry before the full 24-hour timeline in DOM order', () => {
    const { container } = renderToday();
    const timeline = screen.getByRole('region', { name: /24시간 시간표/ });
    const todoPanel = screen.getByRole('complementary', { name: '선택한 날짜의 할 일' });

    expect(todoPanel.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(container.querySelectorAll('.today-direct-hour')).toHaveLength(25);
    expect(timelineGrid()).toBeInTheDocument();
  });

  it('creates a fast unscheduled Todo without requiring a goal', () => {
    const addTask = vi.fn(() => 'task-created');
    mockedUsePlanner.mockReturnValue(plannerValue(snapshotWith(), { addTask }));
    renderToday();

    const title = screen.getByPlaceholderText('이 날짜에 할 일 추가');
    fireEvent.change(title, { target: { value: '세금계산서 확인' } });
    fireEvent.submit(title.closest('form') as HTMLFormElement);

    expect(addTask).toHaveBeenCalledWith({
      title: '세금계산서 확인',
      outcomeId: null,
      estimateMinutes: 30,
      plannedDate: TODAY
    });
  });

  it('prefills the next available time and waits for explicit save, preserving a 25-minute estimate', () => {
    const estimatedTask = task({ estimateMinutes: 25 });
    const saveTimeBlock = vi.fn((_input: SaveTimeBlockInput) => true);
    mockedUsePlanner.mockReturnValue(plannerValue(
      snapshotWith([estimatedTask]),
      { saveTimeBlock }
    ));
    renderToday();

    fireEvent.click(screen.getByRole('button', { name: '집중 작업 시간 지정' }));
    expect(screen.getByLabelText('시작')).toHaveValue('720');
    expect(screen.getByLabelText('종료')).toHaveValue('745');
    expect(saveTimeBlock).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '시간 저장' }));

    expect(saveTimeBlock).toHaveBeenCalledWith(expect.objectContaining({
      taskId: estimatedTask.id,
      startMinutes: 720,
      durationMinutes: 25
    }));
  });

  it('does not send the next-empty action backward into an earlier time today', () => {
    vi.setSystemTime(new Date('2026-09-02T23:50:00.000Z'));
    const saveTimeBlock = vi.fn((_input: SaveTimeBlockInput) => true);
    mockedUsePlanner.mockReturnValue(plannerValue(
      snapshotWith([task()]),
      { saveTimeBlock }
    ));
    renderToday();

    fireEvent.click(screen.getByRole('button', { name: '집중 작업 시간 지정' }));

    expect(saveTimeBlock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('일정 날짜')).toHaveValue('2026-09-03');
    expect(screen.getByLabelText('시작')).toHaveValue('540');
  });

  it('does not send a 15-minute Todo into the past after 23:45 today', () => {
    vi.setSystemTime(new Date('2026-09-02T23:50:00.000Z'));
    const saveTimeBlock = vi.fn((_input: SaveTimeBlockInput) => true);
    mockedUsePlanner.mockReturnValue(plannerValue(
      snapshotWith([task({ estimateMinutes: 15 })]),
      { saveTimeBlock }
    ));
    renderToday();

    fireEvent.click(screen.getByRole('button', { name: '집중 작업 시간 지정' }));

    expect(saveTimeBlock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('일정 날짜')).toHaveValue('2026-09-03');
  });

  it('shows the destination date after scheduling late at night instead of hiding the saved item', () => {
    vi.setSystemTime(new Date('2026-09-02T23:50:00.000Z'));
    const value = plannerValue(snapshotWith([task()])); mockedUsePlanner.mockReturnValue(value); renderToday();
    fireEvent.click(screen.getByRole('button', { name: '집중 작업 시간 지정' }));
    fireEvent.click(screen.getByRole('button', { name: '시간 저장' }));
    expect(value.saveTimeBlock).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-09-03' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('9월 3일');
  });

  it('checks every earlier start on another date after trying 09:00 and later first', () => {
    const saveTimeBlock = vi.fn((_input: SaveTimeBlockInput) => true);
    const nextDate = '2026-09-03';
    mockedUsePlanner.mockReturnValue(plannerValue(
      snapshotWith(
        [task({ plannedDate: nextDate })],
        [
          block({ id: 'before-gap', taskId: null, title: '오전 앞 일정', day: 'thu', date: nextDate, startMinutes: 0, durationMinutes: 525 }),
          block({ id: 'after-gap', taskId: null, title: '오전 뒤 일정', day: 'thu', date: nextDate, startMinutes: 555, durationMinutes: 885 })
        ]
      ),
      { saveTimeBlock }
    ));
    renderToday();

    fireEvent.click(screen.getByRole('button', { name: '다음 날짜' }));
    fireEvent.click(screen.getByRole('button', { name: '집중 작업 시간 지정' }));
    expect(screen.getByLabelText('시작')).toHaveValue('525');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '시간 저장' }));

    expect(saveTimeBlock).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-one',
      date: nextDate,
      startMinutes: 525,
      durationMinutes: 30
    }));
  });

  it('does not submit the quick Todo form while Korean IME composition is active', () => {
    const addTask = vi.fn(() => 'task-created');
    mockedUsePlanner.mockReturnValue(plannerValue(snapshotWith(), { addTask }));
    renderToday();

    const title = screen.getByPlaceholderText('이 날짜에 할 일 추가');
    fireEvent.compositionStart(title);
    fireEvent.change(title, { target: { value: '한글 입력' } });
    fireEvent.submit(title.closest('form') as HTMLFormElement);
    expect(addTask).not.toHaveBeenCalled();

    fireEvent.compositionEnd(title);
    fireEvent.submit(title.closest('form') as HTMLFormElement);
    expect(addTask).toHaveBeenCalledOnce();
  });

  it('offers Continue instead of Stop for a paused Todo timer', () => {
    const toggleTimer = vi.fn();
    const snapshot = snapshotWith([task()]);
    snapshot.timer = {
      taskId: 'task-one',
      startedAt: null,
      accumulatedSeconds: 90,
      paused: true
    };
    mockedUsePlanner.mockReturnValue(plannerValue(snapshot, { toggleTimer }));
    renderToday();

    expect(screen.getByRole('region', { name: '현재 일시정지됨' })).toHaveTextContent('일시정지');
    expect(screen.queryByRole('region', { name: '현재 실행 중' })).not.toBeInTheDocument();
    const resume = screen.getByRole('button', { name: '집중 작업 타이머 계속' });
    expect(resume).toHaveTextContent('계속');
    fireEvent.click(resume);
    expect(toggleTimer).toHaveBeenCalledOnce();
  });

  it('labels other Todo controls as unavailable because the active timer is paused', () => {
    const snapshot = snapshotWith([
      task(),
      task({ id: 'task-two', title: '두 번째 작업' })
    ]);
    snapshot.timer = {
      taskId: 'task-one',
      startedAt: null,
      accumulatedSeconds: 90,
      paused: true
    };
    mockedUsePlanner.mockReturnValue(plannerValue(snapshot));
    renderToday();

    const unavailable = screen.getByRole('button', { name: '두 번째 작업 다른 할 일 일시정지 중' });
    expect(unavailable).toBeDisabled();
    expect(unavailable).toHaveTextContent('일시정지 중');
  });

  it('creates a scheduled item through saveTimeBlock without passing an edit ID', () => {
    const addTask = vi.fn(() => 'task-created');
    const saveTimeBlock = vi.fn((_input: SaveTimeBlockInput) => true);
    mockedUsePlanner.mockReturnValue(plannerValue(snapshotWith(), { addTask, saveTimeBlock }));
    renderToday();

    const grid = timelineGrid();
    giveTimelineBounds(grid);
    fireEvent.pointerDown(grid, {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      clientY: 640
    });
    fireEvent.pointerUp(grid, {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      clientY: 640
    });

    const title = screen.getByLabelText('새 일정 제목');
    fireEvent.change(title, { target: { value: '배포 확인' } });
    fireEvent.submit(title.closest('form') as HTMLFormElement);

    expect(addTask).toHaveBeenCalledWith(expect.objectContaining({
      title: '배포 확인',
      outcomeId: null
    }));
    expect(saveTimeBlock).toHaveBeenCalledTimes(1);
    const input = saveTimeBlock.mock.calls[0][0];
    expect(input).not.toHaveProperty('id');
    expect(input).toMatchObject({
      taskId: 'task-created',
      title: '배포 확인',
      date: TODAY
    });
  });

  it('passes the identical removed block to the 10-second Undo mutation', () => {
    const removed = block();
    const removeTimeBlock = vi.fn(() => true);
    const restoreTimeBlock = vi.fn(() => true);
    mockedUsePlanner.mockReturnValue(plannerValue(
      snapshotWith([task()], [removed]),
      { removeTimeBlock, restoreTimeBlock }
    ));
    renderToday();

    const blockButton = screen.getByRole('button', { name: /집중 작업.*할 일 시간 블록/ });
    fireEvent.keyDown(blockButton, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: '시간표에서 빼기' }));

    expect(removeTimeBlock).toHaveBeenCalledWith(removed.id);
    expect(screen.getByRole('button', { name: '실행 취소' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '실행 취소' }));

    expect(restoreTimeBlock).toHaveBeenCalledWith(removed);
  });

  it('closes an invalidated Undo and explains that its snapshot is no longer current', () => {
    const removed = block();
    const restoreTimeBlock = vi.fn(() => false);
    mockedUsePlanner.mockReturnValue(plannerValue(
      snapshotWith([task()], [removed]),
      { restoreTimeBlock }
    ));
    renderToday();

    fireEvent.keyDown(
      screen.getByRole('button', { name: /집중 작업.*할 일 시간 블록/ }),
      { key: 'Enter' }
    );
    fireEvent.click(screen.getByRole('button', { name: '시간표에서 빼기' }));
    fireEvent.click(screen.getByRole('button', { name: '실행 취소' }));

    expect(restoreTimeBlock).toHaveBeenCalledWith(removed);
    expect(screen.queryByRole('button', { name: '실행 취소' })).not.toBeInTheDocument();
    expect(screen.getByText('실행 취소 시간이 지났거나 일정·동기화 변경으로 복원할 수 없습니다.')).toBeInTheDocument();
  });

  it('can add another TimeBlock for the same Todo from the existing block action', () => {
    const saveTimeBlock = vi.fn((_input: SaveTimeBlockInput) => true);
    const repeatedTask = task({ estimateMinutes: 25 });
    mockedUsePlanner.mockReturnValue(plannerValue(
      snapshotWith([repeatedTask], [block()]),
      { saveTimeBlock }
    ));
    renderToday();

    fireEvent.keyDown(
      screen.getByRole('button', { name: /집중 작업.*할 일 시간 블록/ }),
      { key: 'Enter' }
    );
    fireEvent.click(screen.getByRole('button', { name: '같은 할 일 다시 배치' }));

    expect(document.querySelector('.today-direct-placement-mode')).toHaveTextContent('집중 작업 배치할 빈 시간을 선택하세요.');
    const grid = screen.getByLabelText(/00시부터 24시까지 15분 단위 시간표/);
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({
      bottom: 1_536,
      height: 1_536,
      left: 0,
      right: 800,
      top: 0,
      width: 800,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });
    fireEvent.pointerDown(grid, { button: 0, clientY: 960, isPrimary: true, pointerId: 31, pointerType: 'mouse' });
    fireEvent.pointerUp(grid, { button: 0, clientY: 960, isPrimary: true, pointerId: 31, pointerType: 'mouse' });

    expect(saveTimeBlock).toHaveBeenCalledTimes(1);
    expect(saveTimeBlock).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-one',
      title: '집중 작업',
      date: TODAY,
      startMinutes: 900,
      durationMinutes: 25
    }));
    expect(saveTimeBlock.mock.calls[0][0]).not.toHaveProperty('id');
  });

  it('removes the schedule Undo affordance after ten seconds', () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T12:00:00.000Z'));
    const removed = block();
    mockedUsePlanner.mockReturnValue(plannerValue(
      snapshotWith([task()], [removed]),
      { removeTimeBlock: vi.fn(() => true) }
    ));
    renderToday();

    fireEvent.keyDown(
      screen.getByRole('button', { name: /집중 작업.*할 일 시간 블록/ }),
      { key: 'Enter' }
    );
    fireEvent.click(screen.getByRole('button', { name: '시간표에서 빼기' }));
    expect(screen.getByRole('button', { name: '실행 취소' })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(9_999));
    expect(screen.getByRole('button', { name: '실행 취소' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('button', { name: '실행 취소' })).not.toBeInTheDocument();
  });

  it('opens the task list by default on mobile and switches without losing the quick-add draft', () => {
    installMatchMedia(true);
    mockedUsePlanner.mockReturnValue(plannerValue(snapshotWith([task()])));
    renderToday();
    fireEvent.change(screen.getByLabelText('빠른 메모'), { target: { value: '입력 중' } });
    expect(screen.queryByRole('region', { name: /24시간 시간표/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^시간표/ }));
    expect(screen.getByRole('region', { name: /24시간 시간표/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^할 일 / }));
    expect(screen.getByLabelText('빠른 메모')).toHaveValue('입력 중');
  });

  it('switches to the mobile task list and focuses the input for global quick capture', async () => {
    installMatchMedia(true);
    mockedUsePlanner.mockReturnValue(plannerValue(snapshotWith([task()])));
    renderToday();
    fireEvent.click(screen.getByRole('button', { name: /^시간표/ }));
    act(() => window.dispatchEvent(new Event(QUICK_CAPTURE_EVENT)));

    expect(screen.queryByRole('region', { name: /24시간 시간표/ })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('빠른 메모')).toHaveFocus());
  });

  it('reveals both views on desktop after rotation without a modal or scroll lock', () => {
    const changeLayout = installMutableMatchMedia(true);
    mockedUsePlanner.mockReturnValue(plannerValue(snapshotWith([task()])));
    renderToday();

    fireEvent.click(screen.getByRole('button', { name: /^시간표/ }));

    act(() => changeLayout(false));

    expect(screen.getByRole('complementary', { name: '선택한 날짜의 할 일' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /24시간 시간표/ })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
  });

  it('renders the current-time line only for today', () => {
    renderToday();

    expect(screen.getByLabelText('현재 시각 12:00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다음 날짜' }));
    expect(screen.queryByLabelText('현재 시각 12:00')).not.toBeInTheDocument();
  });

  it('hides manual time recording while browsing another date', () => {
    mockedUsePlanner.mockReturnValue(plannerValue(snapshotWith([task()])));
    renderToday();

    expect(screen.getByText('수동으로 시간 기록')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '다음 날짜' }));

    expect(screen.queryByText('수동으로 시간 기록')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('시간을 기록할 할 일')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '기록' })).not.toBeInTheDocument();
  });

  it('keeps Google blocks keyboard-accessible while exposing them as read-only', () => {
    const google = block({
      id: 'google-one',
      taskId: null,
      title: '고객 미팅',
      external: true
    });
    const removeTimeBlock = vi.fn(() => true);
    mockedUsePlanner.mockReturnValue(plannerValue(
      snapshotWith([], [google]),
      { removeTimeBlock }
    ));
    renderToday();

    const googleBlock = screen.getByRole('button', {
      name: /고객 미팅.*Google Calendar 읽기 전용 일정/
    });
    expect(googleBlock).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(googleBlock, { key: 'Enter' });

    expect(screen.getByRole('dialog', { name: '고객 미팅 블록 작업' })).toBeInTheDocument();
    expect(screen.getByText('Google Calendar 읽기 전용 일정')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '시간표에서 빼기' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '고객 미팅 시작 시간 조절' })).not.toBeInTheDocument();
    expect(removeTimeBlock).not.toHaveBeenCalled();
  });
});
