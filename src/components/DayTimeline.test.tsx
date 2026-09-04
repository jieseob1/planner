import { createRef, type ComponentProps } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task, TimeBlock } from '../domain/types';
import { DayTimeline } from './DayTimeline';

const task: Task = {
  id: 'task-1',
  title: '기획서 정리',
  outcomeId: null,
  estimateMinutes: 30,
  status: 'todo',
  pinned: false,
  carryCount: 0
};

const block: TimeBlock = {
  id: 'block-1',
  taskId: task.id,
  title: task.title,
  day: 'fri',
  startMinutes: 600,
  durationMinutes: 60,
  date: '2026-09-04'
};

const externalBlock: TimeBlock = {
  id: 'google-1',
  taskId: null,
  title: 'Google 미팅',
  day: 'fri',
  startMinutes: 780,
  durationMinutes: 60,
  date: '2026-09-04',
  external: true
};

type Props = ComponentProps<typeof DayTimeline>;

const createProps = (): Props => ({
  blocks: [],
  currentMinute: null,
  date: '2026-09-04',
  day: 'fri',
  draggingTask: null,
  mobile: false,
  runningTaskId: null,
  timerPaused: false,
  scrollRef: createRef<HTMLDivElement>(),
  tasks: [task],
  onCompleteTask: vi.fn(),
  onCreate: vi.fn(() => true),
  onDragTaskEnd: vi.fn(),
  onRemoveBlock: vi.fn(),
  onScheduleTaskAgain: vi.fn(),
  onScheduleTask: vi.fn(() => true),
  onStartTask: vi.fn(),
  onUpdateBlock: vi.fn(() => true)
});

const renderTimeline = (overrides: Partial<Props> = {}) => {
  const props = { ...createProps(), ...overrides };
  render(<DayTimeline {...props} />);
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
  return { grid, props };
};

const openInlineAt = (grid: HTMLElement, clientY: number, pointerId = 1) => {
  fireEvent.pointerDown(grid, {
    button: 0,
    clientX: 100,
    clientY,
    isPrimary: true,
    pointerId,
    pointerType: 'mouse'
  });
  fireEvent.pointerUp(grid, {
    button: 0,
    clientX: 100,
    clientY,
    isPrimary: true,
    pointerId,
    pointerType: 'mouse'
  });
};

const dragOverAt = (grid: HTMLElement, clientY: number, dataTransfer: { dropEffect: string }) => {
  const event = new Event('dragover', { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientY: { value: clientY },
    dataTransfer: { value: dataTransfer }
  });
  fireEvent(grid, event);
};

const dropOn = (grid: HTMLElement, dataTransfer: { dropEffect: string }) => {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  fireEvent(grid, event);
};

describe('DayTimeline inline creation', () => {
  it('creates a default 30-minute Todo from an empty slot with Enter', () => {
    const { grid, props } = renderTimeline();

    openInlineAt(grid, 640);

    expect(screen.getByRole('combobox', { name: '생성 유형' })).toHaveValue('todo');
    expect(screen.getAllByText('10:00–10:30')).toHaveLength(2);
    const title = screen.getByRole('textbox', { name: '새 일정 제목' });
    expect(title).toHaveFocus();
    fireEvent.change(title, { target: { value: '집중 작업' } });
    fireEvent.keyDown(title, { key: 'Enter', code: 'Enter' });

    expect(props.onCreate).toHaveBeenCalledOnce();
    expect(props.onCreate).toHaveBeenCalledWith({
      kind: 'todo',
      range: { startMinutes: 600, endMinutes: 630 },
      title: '집중 작업'
    });
    expect(screen.queryByRole('textbox', { name: '새 일정 제목' })).not.toBeInTheDocument();
  });

  it('uses the final 15-minute range when the user selects 23:45', () => {
    const { grid, props } = renderTimeline();

    openInlineAt(grid, 1_520);
    expect(screen.getAllByText('23:45–24:00')).toHaveLength(2);
    const title = screen.getByRole('textbox', { name: '새 일정 제목' });
    fireEvent.change(title, { target: { value: '하루 마무리' } });
    fireEvent.keyDown(title, { key: 'Enter', code: 'Enter' });

    expect(props.onCreate).toHaveBeenCalledWith({
      kind: 'todo',
      range: { startMinutes: 1_425, endMinutes: 1_440 },
      title: '하루 마무리'
    });
  });

  it('lets a keyboard user open an exact empty slot and create an independent event', () => {
    const { props } = renderTimeline();
    const start = screen.getByLabelText('키보드 일정 시작 시간');

    fireEvent.change(start, { target: { value: '14:15' } });
    fireEvent.submit(start.closest('form') as HTMLFormElement);

    expect(screen.getAllByText('14:15–14:45')).toHaveLength(2);
    fireEvent.change(screen.getByRole('combobox', { name: '생성 유형' }), { target: { value: 'event' } });
    const title = screen.getByRole('textbox', { name: '새 일정 제목' });
    fireEvent.change(title, { target: { value: '은행 방문' } });
    fireEvent.keyDown(title, { key: 'Enter', code: 'Enter' });

    expect(props.onCreate).toHaveBeenCalledWith({
      kind: 'event',
      range: { startMinutes: 855, endMinutes: 885 },
      title: '은행 방문'
    });
  });

  it('cancels the inline editor with Escape without creating anything', () => {
    const { grid, props } = renderTimeline();

    openInlineAt(grid, 640);
    const title = screen.getByRole('textbox', { name: '새 일정 제목' });
    fireEvent.change(title, { target: { value: '취소할 작업' } });
    fireEvent.keyDown(title, { key: 'Escape', code: 'Escape' });

    expect(props.onCreate).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: '새 일정 제목' })).not.toBeInTheDocument();
  });

  it('ignores Enter while Korean IME composition is active', () => {
    const { grid, props } = renderTimeline();

    openInlineAt(grid, 640);
    const title = screen.getByRole('textbox', { name: '새 일정 제목' });
    fireEvent.change(title, { target: { value: '한글 입력' } });
    fireEvent.compositionStart(title);
    fireEvent.keyDown(title, { key: 'Enter', code: 'Enter', isComposing: true });
    fireEvent.submit(title.closest('form') as HTMLFormElement);

    expect(props.onCreate).not.toHaveBeenCalled();
    expect(title).toBeInTheDocument();

    fireEvent.compositionEnd(title);
    fireEvent.keyDown(title, { key: 'Enter', code: 'Enter', isComposing: false });
    expect(props.onCreate).toHaveBeenCalledOnce();
  });
});

describe('DayTimeline task placement', () => {
  it('places an already-scheduled Todo at the exact empty slot selected by the user', () => {
    const { grid, props } = renderTimeline({ draggingTask: { ...task, estimateMinutes: 60 } });

    expect(document.querySelector('.today-direct-placement-mode')).toHaveTextContent('기획서 정리 배치할 빈 시간을 선택하세요.');
    openInlineAt(grid, 960);

    expect(props.onScheduleTask).toHaveBeenCalledOnce();
    expect(props.onScheduleTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: task.id }),
      { startMinutes: 900, endMinutes: 960 }
    );
    expect(props.onDragTaskEnd).toHaveBeenCalledOnce();
    expect(screen.queryByRole('textbox', { name: '새 일정 제목' })).not.toBeInTheDocument();
  });

  it('preserves a non-grid Todo estimate when placing it at a snapped start', () => {
    const estimatedTask = { ...task, estimateMinutes: 25 };
    const { grid, props } = renderTimeline({ draggingTask: estimatedTask });

    openInlineAt(grid, 960);

    expect(props.onScheduleTask).toHaveBeenCalledWith(
      estimatedTask,
      { startMinutes: 900, endMinutes: 925 }
    );
  });

  it('lets a keyboard user enter the exact start for another Todo placement', () => {
    const estimatedTask = { ...task, estimateMinutes: 25 };
    const { props } = renderTimeline({ draggingTask: estimatedTask });
    const start = screen.getByLabelText('기획서 정리 배치 시작 시간');

    fireEvent.change(start, { target: { value: '15:15' } });
    fireEvent.submit(start.closest('form') as HTMLFormElement);

    expect(props.onScheduleTask).toHaveBeenCalledWith(
      estimatedTask,
      { startMinutes: 915, endMinutes: 940 }
    );
    expect(props.onDragTaskEnd).toHaveBeenCalledOnce();
  });

  it('does not silently shorten a selected Todo that cannot finish before midnight', () => {
    const estimatedTask = { ...task, estimateMinutes: 25 };
    const { grid, props } = renderTimeline({ draggingTask: estimatedTask });

    openInlineAt(grid, 1_520);

    expect(props.onScheduleTask).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('25분 일정은 자정 전에 끝나야 합니다.');
  });

  it('schedules the same Todo every time it is dropped on a new slot', () => {
    const { grid, props } = renderTimeline({ draggingTask: task });
    const dataTransfer = { dropEffect: 'none' };

    dragOverAt(grid, 640, dataTransfer);
    dropOn(grid, dataTransfer);
    dragOverAt(grid, 704, dataTransfer);
    dropOn(grid, dataTransfer);

    expect(props.onScheduleTask).toHaveBeenCalledTimes(2);
    expect(props.onScheduleTask).toHaveBeenNthCalledWith(1, task, {
      startMinutes: 600,
      endMinutes: 630
    });
    expect(props.onScheduleTask).toHaveBeenNthCalledWith(2, task, {
      startMinutes: 660,
      endMinutes: 690
    });
    expect(props.onDragTaskEnd).toHaveBeenCalledTimes(2);
  });

  it('rejects a drop that conflicts with an existing block', () => {
    const { grid, props } = renderTimeline({ blocks: [block], draggingTask: task });
    const dataTransfer = { dropEffect: 'none' };

    dragOverAt(grid, 640, dataTransfer);
    dropOn(grid, dataTransfer);

    expect(props.onScheduleTask).not.toHaveBeenCalled();
    expect(props.onDragTaskEnd).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert')).toHaveTextContent('30분 겹침');
    expect(screen.getByRole('alert')).toHaveTextContent('기획서 정리은 배치하지 않았습니다');
  });
});

describe('DayTimeline block actions', () => {
  it('rejects a missing local date before invoking the update callback', () => {
    const { props } = renderTimeline({ blocks: [block] });
    fireEvent.keyDown(
      screen.getByRole('button', { name: /기획서 정리.*할 일 시간 블록/ }),
      { key: 'Enter', code: 'Enter' }
    );
    const dateInput = screen.getByLabelText('다른 날짜로 이동');
    fireEvent.change(dateInput, { target: { value: '' } });
    fireEvent.submit(dateInput.closest('form') as HTMLFormElement);

    expect(props.onUpdateBlock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('올바른 날짜를 선택하세요.');
  });

  it('rejects off-grid direct times and accepts 15-minute boundaries', () => {
    const { props } = renderTimeline({ blocks: [block] });
    fireEvent.keyDown(
      screen.getByRole('button', { name: /기획서 정리.*할 일 시간 블록/ }),
      { key: 'Enter', code: 'Enter' }
    );
    const start = screen.getByRole('textbox', { name: '시작 시간' });
    const end = screen.getByRole('textbox', { name: '종료 시간' });
    const form = start.closest('form') as HTMLFormElement;

    fireEvent.change(start, { target: { value: '10:07' } });
    fireEvent.change(end, { target: { value: '11:07' } });
    fireEvent.submit(form);
    expect(props.onUpdateBlock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('15분 단위');

    fireEvent.change(start, { target: { value: '10:15' } });
    fireEvent.change(end, { target: { value: '11:15' } });
    fireEvent.submit(form);
    expect(props.onUpdateBlock).toHaveBeenCalledWith(
      block,
      { startMinutes: 615, endMinutes: 675 },
      block.date,
      undefined
    );
  });

  it('allows title or date-only edits on an existing 25-minute block', () => {
    const independentBlock: TimeBlock = {
      ...block,
      id: 'event-25',
      taskId: null,
      title: '병원 예약',
      durationMinutes: 25
    };
    const { props } = renderTimeline({ blocks: [independentBlock] });
    fireEvent.keyDown(
      screen.getByRole('button', { name: /병원 예약.*독립 일정/ }),
      { key: 'Enter', code: 'Enter' }
    );
    fireEvent.change(screen.getByRole('textbox', { name: '일정 제목' }), { target: { value: '병원 재진' } });
    fireEvent.change(screen.getByLabelText('다른 날짜로 이동'), { target: { value: '2026-09-05' } });
    fireEvent.submit(screen.getByRole('textbox', { name: '시작 시간' }).closest('form') as HTMLFormElement);

    expect(props.onUpdateBlock).toHaveBeenCalledWith(
      independentBlock,
      { startMinutes: 600, endMinutes: 625 },
      '2026-09-05',
      '병원 재진'
    );
  });

  it('moves an existing 25-minute block from one snapped start without changing its duration', () => {
    const shortEstimateBlock = { ...block, durationMinutes: 25 };
    const { props } = renderTimeline({ blocks: [shortEstimateBlock] });
    fireEvent.keyDown(
      screen.getByRole('button', { name: /기획서 정리.*할 일 시간 블록/ }),
      { key: 'Enter', code: 'Enter' }
    );
    fireEvent.change(screen.getByRole('textbox', { name: '시작 시간' }), { target: { value: '10:15' } });
    fireEvent.change(screen.getByRole('textbox', { name: '종료 시간' }), { target: { value: '10:40' } });
    fireEvent.submit(screen.getByRole('textbox', { name: '시작 시간' }).closest('form') as HTMLFormElement);

    expect(props.onUpdateBlock).toHaveBeenCalledWith(
      shortEstimateBlock,
      { startMinutes: 615, endMinutes: 640 },
      shortEstimateBlock.date,
      undefined
    );
  });

  it('edits the title of an independent local event through the ID-based update callback', () => {
    const independentBlock: TimeBlock = {
      ...block,
      id: 'event-1',
      taskId: null,
      title: '치과 진료'
    };
    const { props } = renderTimeline({ blocks: [independentBlock] });
    fireEvent.keyDown(
      screen.getByRole('button', { name: /치과 진료.*독립 일정/ }),
      { key: 'Enter', code: 'Enter' }
    );
    const title = screen.getByRole('textbox', { name: '일정 제목' });
    fireEvent.change(title, { target: { value: '치과 정기 검진' } });
    fireEvent.submit(title.closest('form') as HTMLFormElement);

    expect(props.onUpdateBlock).toHaveBeenCalledWith(
      independentBlock,
      { startMinutes: 600, endMinutes: 660 },
      independentBlock.date,
      '치과 정기 검진'
    );
  });

  it('allows a title-only edit when an imported Google block already overlaps it', () => {
    const overlappingEvent: TimeBlock = {
      ...block,
      id: 'event-overlap',
      taskId: null,
      title: '기존 약속',
      startMinutes: externalBlock.startMinutes
    };
    const { props } = renderTimeline({ blocks: [overlappingEvent, externalBlock] });
    fireEvent.keyDown(
      screen.getByRole('button', { name: /기존 약속.*독립 일정/ }),
      { key: 'Enter', code: 'Enter' }
    );
    const title = screen.getByRole('textbox', { name: '일정 제목' });
    fireEvent.change(title, { target: { value: '변경한 약속' } });
    fireEvent.submit(title.closest('form') as HTMLFormElement);

    expect(props.onUpdateBlock).toHaveBeenCalledWith(
      overlappingEvent,
      { startMinutes: 780, endMinutes: 840 },
      overlappingEvent.date,
      '변경한 약속'
    );
  });

  it('does not save an independent-event title while Korean IME composition is active', () => {
    const independentBlock: TimeBlock = {
      ...block,
      id: 'event-ime',
      taskId: null,
      title: '기존 일정'
    };
    const { props } = renderTimeline({ blocks: [independentBlock] });
    fireEvent.keyDown(
      screen.getByRole('button', { name: /기존 일정.*독립 일정/ }),
      { key: 'Enter', code: 'Enter' }
    );
    const title = screen.getByRole('textbox', { name: '일정 제목' });
    const form = title.closest('form') as HTMLFormElement;
    fireEvent.change(title, { target: { value: '한글 일정' } });

    fireEvent.compositionStart(title);
    fireEvent.keyDown(title, { key: 'Enter', code: 'Enter', isComposing: true });
    fireEvent.submit(form);
    expect(props.onUpdateBlock).not.toHaveBeenCalled();

    fireEvent.compositionEnd(title);
    fireEvent.submit(form);
    expect(props.onUpdateBlock).toHaveBeenCalledOnce();
    expect(props.onUpdateBlock).toHaveBeenCalledWith(
      independentBlock,
      { startMinutes: 600, endMinutes: 660 },
      independentBlock.date,
      '한글 일정'
    );
  });

  it('extends a 25-minute block by exactly 15 minutes without snapping its end', () => {
    const shortEstimateBlock = { ...block, durationMinutes: 25 };
    const { props } = renderTimeline({ blocks: [shortEstimateBlock] });
    fireEvent.keyDown(
      screen.getByRole('button', { name: /기획서 정리.*할 일 시간 블록/ }),
      { key: 'Enter', code: 'Enter' }
    );

    fireEvent.click(screen.getByRole('button', { name: '+ 15분 늘리기' }));

    expect(props.onUpdateBlock).toHaveBeenCalledWith(
      shortEstimateBlock,
      { startMinutes: 600, endMinutes: 640 },
      shortEstimateBlock.date,
      undefined
    );
  });

  it('shortens a 40-minute block by exactly 15 minutes without snapping its end', () => {
    const longEstimateBlock = { ...block, durationMinutes: 40 };
    const { props } = renderTimeline({ blocks: [longEstimateBlock] });
    fireEvent.keyDown(
      screen.getByRole('button', { name: /기획서 정리.*할 일 시간 블록/ }),
      { key: 'Enter', code: 'Enter' }
    );

    fireEvent.click(screen.getByRole('button', { name: '− 15분 줄이기' }));

    expect(props.onUpdateBlock).toHaveBeenCalledWith(
      longEstimateBlock,
      { startMinutes: 600, endMinutes: 625 },
      longEstimateBlock.date,
      undefined
    );
  });

  it('offers another placement for a linked Todo without changing the existing block', async () => {
    const user = userEvent.setup();
    const { props } = renderTimeline({ blocks: [block] });
    fireEvent.keyDown(
      screen.getByRole('button', { name: /기획서 정리.*할 일 시간 블록/ }),
      { key: 'Enter', code: 'Enter' }
    );

    await user.click(screen.getByRole('button', { name: '같은 할 일 다시 배치' }));

    expect(props.onScheduleTaskAgain).toHaveBeenCalledOnce();
    expect(props.onScheduleTaskAgain).toHaveBeenCalledWith(task);
    expect(props.onUpdateBlock).not.toHaveBeenCalled();
  });

  it('labels a paused owned timer with the resume action', () => {
    const { props } = renderTimeline({ blocks: [block], runningTaskId: task.id, timerPaused: true });
    expect(screen.getByRole('button', { name: /기획서 정리.*할 일 시간 블록/ })).toHaveTextContent('일시정지');
    fireEvent.keyDown(
      screen.getByRole('button', { name: /기획서 정리.*할 일 시간 블록/ }),
      { key: 'Enter', code: 'Enter' }
    );
    fireEvent.click(screen.getByRole('button', { name: '타이머 계속' }));

    expect(props.onStartTask).toHaveBeenCalledOnce();
    expect(props.onStartTask).toHaveBeenCalledWith(task.id);
  });

  it('disables timer start while another Todo owns the active timer', () => {
    const { props } = renderTimeline({ blocks: [block], runningTaskId: 'task-other' });
    fireEvent.keyDown(
      screen.getByRole('button', { name: /기획서 정리.*할 일 시간 블록/ }),
      { key: 'Enter', code: 'Enter' }
    );

    expect(screen.getByRole('button', { name: '다른 할 일 실행 중' })).toBeDisabled();
    expect(props.onStartTask).not.toHaveBeenCalled();
  });

  it('labels a paused timer owned by another Todo without calling it active', () => {
    const { props } = renderTimeline({ blocks: [block], runningTaskId: 'task-other', timerPaused: true });
    fireEvent.keyDown(
      screen.getByRole('button', { name: /기획서 정리.*할 일 시간 블록/ }),
      { key: 'Enter', code: 'Enter' }
    );

    expect(screen.getByRole('button', { name: '다른 할 일 일시정지 중' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '다른 할 일 실행 중' })).not.toBeInTheDocument();
    expect(props.onStartTask).not.toHaveBeenCalled();
  });

  it('renders an allowed Google/local overlap in separate lanes so both stay reachable', () => {
    const overlappingGoogle = { ...externalBlock, startMinutes: 630 };
    renderTimeline({ blocks: [block, overlappingGoogle] });

    const localWrapper = screen.getByRole('button', { name: /기획서 정리.*할 일 시간 블록/ }).closest('.today-direct-block-wrap') as HTMLElement;
    const googleWrapper = screen.getByRole('button', { name: /Google 미팅.*Google Calendar 읽기 전용 일정/ }).closest('.today-direct-block-wrap') as HTMLElement;
    expect(localWrapper.style.getPropertyValue('--lane-left')).toBe('0%');
    expect(googleWrapper.style.getPropertyValue('--lane-left')).toBe('50%');
    expect(localWrapper.style.getPropertyValue('--lane-width')).toContain('50%');
    expect(googleWrapper.style.getPropertyValue('--lane-width')).toContain('50%');
  });

  it('avoids overlapping resize handles in narrow multi-event lanes and keeps panel controls available', () => {
    const googleBlocks = [1, 2, 3].map((index) => ({
      ...externalBlock,
      id: `google-${index}`,
      title: `Google 일정 ${index}`,
      startMinutes: block.startMinutes
    }));
    renderTimeline({ blocks: [block, ...googleBlocks] });

    expect(screen.queryByRole('button', { name: '기획서 정리 시작 시간 조절' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '기획서 정리 종료 시간 조절' })).not.toBeInTheDocument();
    fireEvent.keyDown(
      screen.getByRole('button', { name: /기획서 정리.*할 일 시간 블록/ }),
      { key: 'Enter', code: 'Enter' }
    );
    expect(screen.getByRole('button', { name: '+ 15분 늘리기' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '시작 시간' })).toBeInTheDocument();
  });

  it('shows external Google blocks as read-only without move, resize, or delete actions', () => {
    renderTimeline({ blocks: [externalBlock] });
    const googleBlock = screen.getByRole('button', { name: /Google 미팅.*Google Calendar 읽기 전용 일정/ });

    expect(googleBlock).not.toHaveTextContent('실행 중');
    expect(screen.queryByRole('button', { name: 'Google 미팅 시작 시간 조절' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Google 미팅 종료 시간 조절' })).not.toBeInTheDocument();
    fireEvent.keyDown(googleBlock, { key: 'Enter', code: 'Enter' });

    const panel = screen.getByRole('dialog', { name: 'Google 미팅 블록 작업' });
    expect(panel).toHaveAttribute('aria-modal', 'true');
    expect(within(panel).getByText('Google Calendar 읽기 전용 일정')).toBeInTheDocument();
    expect(within(panel).getByText('이동·변경·삭제는 Google Calendar에서 관리하세요.')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /15분/ })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: '시간표에서 빼기' })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('textbox', { name: /시간/ })).not.toBeInTheDocument();
  });

  it.each([
    ['Enter', 'Enter'],
    ['Space', ' ']
  ])('opens the block action panel with %s', (_label, key) => {
    renderTimeline({ blocks: [block] });
    const blockButton = screen.getByRole('button', { name: /기획서 정리.*할 일 시간 블록/ });

    fireEvent.keyDown(blockButton, { key, code: key === ' ' ? 'Space' : 'Enter' });

    expect(screen.getByRole('dialog', { name: '기획서 정리 블록 작업' })).toBeInTheDocument();
  });

  it('removes only the selected block through the action panel callback', async () => {
    const user = userEvent.setup();
    const { props } = renderTimeline({ blocks: [block] });
    const blockButton = screen.getByRole('button', { name: /기획서 정리.*할 일 시간 블록/ });
    fireEvent.keyDown(blockButton, { key: 'Enter', code: 'Enter' });

    await user.click(screen.getByRole('button', { name: '시간표에서 빼기' }));

    expect(props.onRemoveBlock).toHaveBeenCalledOnce();
    expect(props.onRemoveBlock).toHaveBeenCalledWith(block);
    expect(screen.queryByRole('dialog', { name: '기획서 정리 블록 작업' })).not.toBeInTheDocument();
  });

  it('keeps pointer movement local and saves exactly once on pointerup', () => {
    const { grid, props } = renderTimeline({ blocks: [block] });
    const blockButton = screen.getByRole('button', { name: /기획서 정리.*할 일 시간 블록/ });

    fireEvent.pointerDown(blockButton, {
      button: 0,
      clientX: 100,
      clientY: 640,
      isPrimary: true,
      pointerId: 9,
      pointerType: 'mouse'
    });
    fireEvent.pointerMove(grid, {
      button: 0,
      clientX: 100,
      clientY: 704,
      isPrimary: true,
      pointerId: 9,
      pointerType: 'mouse'
    });

    expect(props.onUpdateBlock).not.toHaveBeenCalled();

    fireEvent.pointerUp(grid, {
      button: 0,
      clientX: 100,
      clientY: 704,
      isPrimary: true,
      pointerId: 9,
      pointerType: 'mouse'
    });

    expect(props.onUpdateBlock).toHaveBeenCalledOnce();
    expect(props.onUpdateBlock).toHaveBeenCalledWith(block, {
      startMinutes: 660,
      endMinutes: 720
    });
  });
});

describe('DayTimeline touch gestures', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('opens the action panel on a short touch without updating the block', () => {
    const { grid, props } = renderTimeline({ blocks: [block] });
    const blockButton = screen.getByRole('button', { name: /기획서 정리.*할 일 시간 블록/ });

    fireEvent.pointerDown(blockButton, {
      button: 0,
      clientX: 100,
      clientY: 640,
      isPrimary: true,
      pointerId: 21,
      pointerType: 'touch'
    });
    fireEvent.pointerUp(grid, {
      button: 0,
      clientX: 100,
      clientY: 640,
      isPrimary: true,
      pointerId: 21,
      pointerType: 'touch'
    });
    act(() => vi.advanceTimersByTime(0));

    expect(screen.getByRole('dialog', { name: '기획서 정리 블록 작업' })).toBeInTheDocument();
    expect(props.onUpdateBlock).not.toHaveBeenCalled();
  });

  it('keeps the full 44px compact control active while the main lane still creates in adjacent slots', () => {
    const compactBlock = { ...block, durationMinutes: 15 };
    const { grid, props } = renderTimeline({ blocks: [compactBlock], mobile: true });
    const touchTarget = screen.getByRole('button', { name: '기획서 정리 빠른 조작' });
    const compactBody = screen.getByRole('button', { name: /기획서 정리.*할 일 시간 블록/ });
    vi.spyOn(compactBody, 'getBoundingClientRect').mockReturnValue({
      bottom: 654,
      height: 14,
      left: 60,
      right: 760,
      top: 640,
      width: 700,
      x: 60,
      y: 640,
      toJSON: () => ({})
    });

    fireEvent.pointerDown(touchTarget, {
      button: 0,
      clientX: 250,
      clientY: 628,
      isPrimary: true,
      pointerId: 27,
      pointerType: 'touch'
    });
    fireEvent.pointerUp(grid, {
      button: 0,
      clientX: 250,
      clientY: 628,
      isPrimary: true,
      pointerId: 27,
      pointerType: 'touch'
    });
    act(() => vi.advanceTimersByTime(0));

    expect(screen.getByRole('dialog', { name: '기획서 정리 블록 작업' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '새 일정 제목' })).not.toBeInTheDocument();
    expect(props.onUpdateBlock).not.toHaveBeenCalled();

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '블록 작업 닫기' }));
    fireEvent.pointerDown(compactBody, {
      button: 0,
      clientX: 120,
      clientY: 658,
      isPrimary: true,
      pointerId: 28,
      pointerType: 'touch'
    });
    fireEvent.pointerUp(grid, {
      button: 0,
      clientX: 120,
      clientY: 658,
      isPrimary: true,
      pointerId: 28,
      pointerType: 'touch'
    });
    expect(screen.getByRole('textbox', { name: '새 일정 제목' })).toBeInTheDocument();
    expect(screen.getAllByText('10:15–10:45')).toHaveLength(2);
  });

  it('groups close mobile controls at their original time and lets the user identify the exact block', async () => {
    vi.useRealTimers();
    renderTimeline({
      mobile: true,
      blocks: [
        { ...block, id: 'compact-a', title: '연속 A', durationMinutes: 15 },
        { ...block, id: 'compact-b', title: '연속 B', startMinutes: 615, durationMinutes: 15 },
        { ...block, id: 'compact-c', title: '같은 시간 C', durationMinutes: 30 }
      ]
    });

    const groupControl = screen.getByRole('button', { name: '10:00–10:30 일정 3개 선택' });
    expect(groupControl).toHaveTextContent('3');
    expect(groupControl.closest('.today-direct-block-wrap')).toBeNull();
    expect(groupControl.closest('.today-direct-mobile-block-controls')).not.toBeNull();

    groupControl.focus();
    fireEvent.click(groupControl);
    const picker = await screen.findByRole('dialog', { name: '이 시간의 일정 선택' });
    expect(within(picker).getByText('10:00–10:30 · 3개')).toBeInTheDocument();
    const firstOption = within(picker).getByRole('button', { name: '연속 A, 10:00–10:15, 할 일 선택' });
    expect(firstOption).toBeInTheDocument();
    expect(within(picker).getByRole('button', { name: '같은 시간 C, 10:00–10:30, 할 일 선택' })).toBeInTheDocument();
    expect(within(picker).getByRole('button', { name: '연속 B, 10:15–10:30, 할 일 선택' })).toBeInTheDocument();
    await waitFor(() => expect(firstOption).toHaveFocus());

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '이 시간의 일정 선택' })).not.toBeInTheDocument();
    await waitFor(() => expect(groupControl).toHaveFocus());

    fireEvent.click(groupControl);
    const reopenedPicker = await screen.findByRole('dialog', { name: '이 시간의 일정 선택' });
    fireEvent.click(within(reopenedPicker).getByRole('button', { name: '연속 B, 10:15–10:30, 할 일 선택' }));
    expect(await screen.findByRole('dialog', { name: '연속 B 블록 작업' })).toBeInTheDocument();
  });

  it('keeps more than 35 dense mobile blocks accessible through one bounded group control', async () => {
    vi.useRealTimers();
    const denseBlocks = Array.from({ length: 36 }, (_, index) => ({
      ...block,
      id: `dense-${index}`,
      title: `겹친 일정 ${index + 1}`,
      durationMinutes: 30
    }));
    renderTimeline({
      mobile: true,
      blocks: [
        ...denseBlocks,
        { ...block, id: 'later', title: '오후 일정', startMinutes: 720, durationMinutes: 30 }
      ]
    });

    const denseControl = screen.getByRole('button', { name: '10:00–10:30 일정 36개 선택' });
    const laterControl = screen.getByRole('button', { name: '오후 일정 빠른 조작' });
    expect(denseControl).toHaveTextContent('36');
    expect(Number.parseFloat(laterControl.style.top) - Number.parseFloat(denseControl.style.top)).toBeGreaterThanOrEqual(44);

    fireEvent.click(denseControl);
    const picker = await screen.findByRole('dialog', { name: '이 시간의 일정 선택' });
    expect(within(picker).getAllByRole('button', { name: /겹친 일정 .* 선택/ })).toHaveLength(36);
  });

  it('uses the 44px action sheet controls as the mobile resize path', () => {
    const compactBlock = { ...block, durationMinutes: 30 };
    const { grid, props } = renderTimeline({ blocks: [compactBlock], mobile: true });
    const touchTarget = screen.getByRole('button', { name: '기획서 정리 빠른 조작' });

    fireEvent.pointerDown(touchTarget, {
      button: 0,
      clientX: 300,
      clientY: 648,
      isPrimary: true,
      pointerId: 29,
      pointerType: 'touch'
    });
    fireEvent.pointerUp(grid, {
      button: 0,
      clientX: 300,
      clientY: 648,
      isPrimary: true,
      pointerId: 29,
      pointerType: 'touch'
    });
    act(() => vi.advanceTimersByTime(0));

    expect(screen.queryByRole('button', { name: '기획서 정리 시작 시간 조절' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ 15분 늘리기' }));
    expect(props.onUpdateBlock).toHaveBeenCalledWith(
      compactBlock,
      { startMinutes: 600, endMinutes: 645 },
      compactBlock.date,
      undefined
    );
  });

  it('opens a Google block only after a short touch ends and cancels when the gesture becomes a scroll', () => {
    const first = renderTimeline({ blocks: [externalBlock], mobile: true });
    const googleControl = screen.getByRole('button', { name: 'Google 미팅 읽기 전용 일정 보기' });
    expect(googleControl.querySelector('.lucide-lock-keyhole')).toBeInTheDocument();
    const googleBlock = screen.getByRole('button', { name: /Google 미팅.*Google Calendar 읽기 전용 일정/ });
    fireEvent.pointerDown(googleBlock, {
      button: 0, clientX: 100, clientY: 832, isPrimary: true, pointerId: 25, pointerType: 'touch'
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.pointerMove(first.grid, {
      button: 0, clientX: 100, clientY: 850, isPrimary: true, pointerId: 25, pointerType: 'touch'
    });
    fireEvent.pointerUp(first.grid, {
      button: 0, clientX: 100, clientY: 850, isPrimary: true, pointerId: 25, pointerType: 'touch'
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.pointerDown(googleBlock, {
      button: 0, clientX: 100, clientY: 832, isPrimary: true, pointerId: 26, pointerType: 'touch'
    });
    fireEvent.pointerUp(first.grid, {
      button: 0, clientX: 100, clientY: 832, isPrimary: true, pointerId: 26, pointerType: 'touch'
    });
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByRole('dialog', { name: 'Google 미팅 블록 작업' })).toBeInTheDocument();
  });

  it('treats movement before the long-press threshold as scrolling and cancels the gesture', () => {
    const { grid, props } = renderTimeline({ blocks: [block] });
    const blockButton = screen.getByRole('button', { name: /기획서 정리.*할 일 시간 블록/ });

    fireEvent.pointerDown(blockButton, {
      button: 0,
      clientX: 100,
      clientY: 640,
      isPrimary: true,
      pointerId: 22,
      pointerType: 'touch'
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.pointerMove(grid, {
      button: 0,
      clientX: 112,
      clientY: 660,
      isPrimary: true,
      pointerId: 22,
      pointerType: 'touch'
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.pointerUp(grid, {
      button: 0,
      clientX: 112,
      clientY: 660,
      isPrimary: true,
      pointerId: 22,
      pointerType: 'touch'
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(props.onUpdateBlock).not.toHaveBeenCalled();
  });

  it('commits a long-press move and a resize only once each on pointerup', () => {
    const { grid, props } = renderTimeline({ blocks: [block] });
    const blockButton = screen.getByRole('button', { name: /기획서 정리.*할 일 시간 블록/ });

    fireEvent.pointerDown(blockButton, {
      button: 0,
      clientX: 100,
      clientY: 640,
      isPrimary: true,
      pointerId: 23,
      pointerType: 'touch'
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    const activeTouchMove = new Event('touchmove', { bubbles: true, cancelable: true });
    window.dispatchEvent(activeTouchMove);
    expect(activeTouchMove.defaultPrevented).toBe(true);
    fireEvent.pointerMove(grid, {
      button: 0,
      clientX: 100,
      clientY: 704,
      isPrimary: true,
      pointerId: 23,
      pointerType: 'touch'
    });
    expect(props.onUpdateBlock).not.toHaveBeenCalled();

    fireEvent.pointerUp(grid, {
      button: 0,
      clientX: 100,
      clientY: 704,
      isPrimary: true,
      pointerId: 23,
      pointerType: 'touch'
    });
    expect(props.onUpdateBlock).toHaveBeenCalledOnce();
    expect(props.onUpdateBlock).toHaveBeenCalledWith(block, {
      startMinutes: 660,
      endMinutes: 720
    });

    vi.mocked(props.onUpdateBlock).mockClear();
    const bottomHandle = screen.getByRole('button', { name: '기획서 정리 종료 시간 조절' });
    fireEvent.pointerDown(bottomHandle, {
      button: 0,
      clientX: 100,
      clientY: 704,
      isPrimary: true,
      pointerId: 24,
      pointerType: 'mouse'
    });
    fireEvent.pointerMove(grid, {
      button: 0,
      clientX: 100,
      clientY: 720,
      isPrimary: true,
      pointerId: 24,
      pointerType: 'mouse'
    });
    expect(props.onUpdateBlock).not.toHaveBeenCalled();

    fireEvent.pointerUp(grid, {
      button: 0,
      clientX: 100,
      clientY: 720,
      isPrimary: true,
      pointerId: 24,
      pointerType: 'mouse'
    });
    expect(props.onUpdateBlock).toHaveBeenCalledOnce();
    expect(props.onUpdateBlock).toHaveBeenCalledWith(block, {
      startMinutes: 600,
      endMinutes: 675
    });
  });

  it('keeps a mobile long-press move alive when its control becomes a grouped control', () => {
    const laterBlock = {
      ...block,
      id: 'block-later',
      title: '후속 일정',
      startMinutes: 690,
      durationMinutes: 30
    };
    const { grid, props } = renderTimeline({ blocks: [block, laterBlock], mobile: true });
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.defineProperties(grid, {
      setPointerCapture: { configurable: true, value: setPointerCapture },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: releasePointerCapture }
    });
    const touchTarget = screen.getByRole('button', { name: '기획서 정리 빠른 조작' });

    fireEvent.pointerDown(touchTarget, {
      button: 0,
      clientX: 300,
      clientY: 672,
      isPrimary: true,
      pointerId: 31,
      pointerType: 'touch'
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(setPointerCapture).toHaveBeenCalledWith(31);

    fireEvent.pointerMove(grid, {
      button: 0,
      clientX: 300,
      clientY: 736,
      isPrimary: true,
      pointerId: 31,
      pointerType: 'touch'
    });
    expect(screen.getByRole('button', { name: /일정 2개 선택/ })).toBeInTheDocument();
    expect(touchTarget).not.toBeInTheDocument();

    fireEvent.pointerMove(grid, {
      button: 0,
      clientX: 300,
      clientY: 800,
      isPrimary: true,
      pointerId: 31,
      pointerType: 'touch'
    });

    fireEvent.pointerUp(grid, {
      button: 0,
      clientX: 300,
      clientY: 800,
      isPrimary: true,
      pointerId: 31,
      pointerType: 'touch'
    });

    expect(releasePointerCapture).toHaveBeenCalledWith(31);
    expect(props.onUpdateBlock).toHaveBeenCalledOnce();
    expect(props.onUpdateBlock).toHaveBeenCalledWith(block, {
      startMinutes: 720,
      endMinutes: 780
    });
  });
});
