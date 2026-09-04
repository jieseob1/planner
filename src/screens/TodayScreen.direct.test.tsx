import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptySnapshot } from '../data/empty';
import type { PlannerSnapshot, SaveTimeBlockInput, Task, TimeBlock } from '../domain/types';
import { usePlanner } from '../state/PlannerProvider';
import { TodayScreen } from './TodayScreen';
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

  it('places the full 24-hour timeline before the desktop Todo panel in DOM order', () => {
    const { container } = renderToday();
    const timeline = screen.getByRole('region', { name: /24시간 시간표/ });
    const todoPanel = screen.getByRole('complementary', { name: '미배치 할 일' });

    expect(timeline.compareDocumentPosition(todoPanel) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(container.querySelectorAll('.today-direct-hour')).toHaveLength(25);
    expect(timelineGrid()).toBeInTheDocument();
  });

  it('creates a fast unscheduled Todo without requiring a goal', () => {
    const addTask = vi.fn(() => 'task-created');
    mockedUsePlanner.mockReturnValue(plannerValue(snapshotWith(), { addTask }));
    renderToday();

    const title = screen.getByPlaceholderText('할 일 추가');
    fireEvent.change(title, { target: { value: '세금계산서 확인' } });
    fireEvent.submit(title.closest('form') as HTMLFormElement);

    expect(addTask).toHaveBeenCalledWith({
      title: '세금계산서 확인',
      outcomeId: null,
      estimateMinutes: 30
    });
  });

  it('keeps a 25-minute estimate when placing a Todo in the next empty time', () => {
    const estimatedTask = task({ estimateMinutes: 25 });
    const saveTimeBlock = vi.fn((_input: SaveTimeBlockInput) => true);
    mockedUsePlanner.mockReturnValue(plannerValue(
      snapshotWith([estimatedTask]),
      { saveTimeBlock }
    ));
    renderToday();

    fireEvent.click(screen.getByRole('button', { name: '집중 작업 다음 빈 시간에 배치' }));

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

    fireEvent.click(screen.getByRole('button', { name: '집중 작업 다음 빈 시간에 배치' }));

    expect(saveTimeBlock).not.toHaveBeenCalled();
    expect(screen.getByText('이 날짜에는 배치할 수 있는 빈 시간이 없습니다.')).toBeInTheDocument();
  });

  it('does not send a 15-minute Todo into the past after 23:45 today', () => {
    vi.setSystemTime(new Date('2026-09-02T23:50:00.000Z'));
    const saveTimeBlock = vi.fn((_input: SaveTimeBlockInput) => true);
    mockedUsePlanner.mockReturnValue(plannerValue(
      snapshotWith([task({ estimateMinutes: 15 })]),
      { saveTimeBlock }
    ));
    renderToday();

    fireEvent.click(screen.getByRole('button', { name: '집중 작업 다음 빈 시간에 배치' }));

    expect(saveTimeBlock).not.toHaveBeenCalled();
    expect(screen.getByText('이 날짜에는 배치할 수 있는 빈 시간이 없습니다.')).toBeInTheDocument();
  });

  it('checks every earlier start on another date after trying 09:00 and later first', () => {
    const saveTimeBlock = vi.fn((_input: SaveTimeBlockInput) => true);
    const nextDate = '2026-09-03';
    mockedUsePlanner.mockReturnValue(plannerValue(
      snapshotWith(
        [task()],
        [
          block({ id: 'before-gap', taskId: null, title: '오전 앞 일정', day: 'thu', date: nextDate, startMinutes: 0, durationMinutes: 525 }),
          block({ id: 'after-gap', taskId: null, title: '오전 뒤 일정', day: 'thu', date: nextDate, startMinutes: 555, durationMinutes: 885 })
        ]
      ),
      { saveTimeBlock }
    ));
    renderToday();

    fireEvent.click(screen.getByRole('button', { name: '다음 날짜' }));
    fireEvent.click(screen.getByRole('button', { name: '집중 작업 다음 빈 시간에 배치' }));

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

    const title = screen.getByPlaceholderText('할 일 추가');
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

  it('opens unscheduled Todos as a mobile bottom sheet and closes on Escape or popstate', () => {
    installMatchMedia(true);
    mockedUsePlanner.mockReturnValue(plannerValue(snapshotWith([task()])));
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    renderToday();

    const trigger = screen.getByRole('button', { name: /시간 미정 할 일/ });
    expect(screen.queryByRole('dialog', { name: '시간 미정 할 일' })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: '시간 미정 할 일' })).toHaveAttribute('aria-modal', 'true');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(back).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: '시간 미정 할 일' })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: '시간 미정 할 일' })).toBeInTheDocument();
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(screen.queryByRole('dialog', { name: '시간 미정 할 일' })).not.toBeInTheDocument();
  });

  it('opens the mobile Todo sheet and focuses its input for global quick capture', async () => {
    installMatchMedia(true);
    mockedUsePlanner.mockReturnValue(plannerValue(snapshotWith([task()])));
    renderToday();

    act(() => window.dispatchEvent(new Event(QUICK_CAPTURE_EVENT)));

    expect(screen.getByRole('dialog', { name: '시간 미정 할 일' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('빠른 메모')).toHaveFocus());
  });

  it('closes and cleans up the mobile Todo sheet when viewport rotation exits compact layout', () => {
    const changeLayout = installMutableMatchMedia(true);
    mockedUsePlanner.mockReturnValue(plannerValue(snapshotWith([task()])));
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    renderToday();

    fireEvent.click(screen.getByRole('button', { name: /시간 미정 할 일/ }));
    expect(screen.getByRole('dialog', { name: '시간 미정 할 일' })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    act(() => changeLayout(false));

    expect(screen.queryByRole('dialog', { name: '시간 미정 할 일' })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
    expect(back).toHaveBeenCalledOnce();
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
