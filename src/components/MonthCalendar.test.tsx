import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calendarMonthDates, MonthCalendar, shiftCalendarMonth } from './MonthCalendar';
import { PlannerScreen } from '../screens/PlannerScreen';
import { getDayKeyForDate } from '../lib/calendarDate';
import type { SaveTimeBlockInput, Task, TimeBlock } from '../domain/types';

const state = vi.hoisted(() => ({ timeZone: 'Asia/Seoul', planner: {} as Record<string, unknown> }));
vi.mock('../timezone/TimeZoneProvider', () => ({ useTimeZone: () => ({ timeZone: state.timeZone }) }));
vi.mock('../state/PlannerProvider', () => ({ usePlanner: () => state.planner }));
const event = (id: string, date: string, startMinutes = 540, external = false): TimeBlock => ({ id, title: id, date, day: getDayKeyForDate(date), taskId: null, startMinutes, durationMinutes: 30, external });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-08T15:30:00Z'));
  state.timeZone = 'Asia/Seoul';
  state.planner = { tasks: [], outcomes: [], timeBlocks: [], review: { selectedTopTaskIds: [] }, plannerWeekOffset: 0,
    addTask: vi.fn().mockReturnValue('task-new'), updateTask: vi.fn(), removeTask: vi.fn(), saveTimeBlock: vi.fn().mockReturnValue(true), removeTimeBlock: vi.fn().mockReturnValue(true), setPlannerWeekOffset: vi.fn() };
});
afterEach(() => vi.useRealTimers());

describe('MonthCalendar date-only layout', () => {
  it('covers leap February, a six-week month and year boundaries without host timezone conversion', () => {
    const leap = calendarMonthDates('2028-02-15');
    expect(leap).toContain('2028-02-29');
    expect(leap[0]).toBe('2028-01-31');
    expect(leap.at(-1)).toBe('2028-03-05');
    expect(calendarMonthDates('2026-03-01')).toHaveLength(42);
    expect(calendarMonthDates('2027-02-01')).toHaveLength(28);
    expect(shiftCalendarMonth('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftCalendarMonth('2026-01-31', -1)).toBe('2025-12-01');
  });
  it('selects a date, exposes all overflow events in time order and keeps external events read-only', async () => {
    const user = userEvent.setup(); const onAdd = vi.fn(); const onEdit = vi.fn();
    const blocks = [event('저녁', '2026-09-09', 1080), event('구글 일정', '2026-09-09', 600, true), event('아침', '2026-09-09', 540)];
    render(<MonthCalendar today="2026-09-08" blocks={blocks} onAdd={onAdd} onEdit={onEdit} />);
    await user.click(screen.getByRole('button', { name: '2026년 9월 9일 일정 3개 모두 보기' }));
    const agenda = screen.getByRole('region', { name: '선택한 날짜의 일정' });
    expect(within(agenda).getAllByRole('listitem').map(item => item.querySelector('strong')?.textContent)).toEqual(['아침', '구글 일정', '저녁']);
    expect(within(agenda).queryByRole('button', { name: '구글 일정 일정 수정' })).not.toBeInTheDocument();
    expect(within(agenda).getByText(/원본 캘린더에서 수정/)).toBeInTheDocument();
    await user.click(within(agenda).getByRole('button', { name: '저녁 일정 수정' }));
    expect(onEdit).toHaveBeenCalledWith(blocks[0]);
    await user.click(within(agenda).getByRole('button', { name: '일정 추가' }));
    expect(onAdd).toHaveBeenCalledWith('2026-09-09');
    expect(blocks.map(block => block.id)).toEqual(['저녁', '구글 일정', '아침']);
  });
  it('moves date focus using arrows across a month boundary and returns to today', async () => {
    const user = userEvent.setup();
    render(<MonthCalendar today="2026-09-30" blocks={[]} onAdd={vi.fn()} onEdit={vi.fn()} />);
    screen.getByRole('button', { name: '2026년 9월 30일, 오늘, 일정 0개' }).focus();
    await user.keyboard('{ArrowRight}');
    const october = screen.getByRole('button', { name: '2026년 10월 1일, 일정 0개' });
    await waitFor(() => expect(october).toHaveFocus());
    expect(october).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: '2026년 10월' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '이번 달' }));
    expect(screen.getByRole('button', { name: '2026년 9월 30일, 오늘, 일정 0개' })).toHaveAttribute('aria-current', 'date');
  });
  it('supports a small-screen agenda without requiring hidden event chips and bounds navigation', async () => {
    const user = userEvent.setup(); const onAdd = vi.fn();
    render(<MonthCalendar today="2026-09-08" minDate="2026-09-07" maxDate="2026-09-13" blocks={[]} onAdd={onAdd} onEdit={vi.fn()} />);
    expect(screen.getByRole('button', { name: '이전 달' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '다음 달' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '2026년 9월 6일, 일정 0개' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '2026년 9월 10일, 일정 0개' }));
    await user.click(within(screen.getByRole('region', { name: '선택한 날짜의 일정' })).getByRole('button', { name: '일정 추가' }));
    expect(onAdd).toHaveBeenCalledWith('2026-09-10');
  });
});

describe('Planner monthly editing integration', () => {
  const view = () => render(<MemoryRouter><PlannerScreen /></MemoryRouter>);
  it('does not claim 0% utilization when available hours have never been configured', () => {
    state.planner.timeBlocks = [{ ...event('진행할 일', '2026-09-09'), durationMinutes: 150 }];
    view();
    const toolbar = screen.getByRole('region', { name: '주간 계획 도구' });
    expect(within(toolbar).getByText('가용 시간 미설정 · 계획한 시간만 표시합니다.')).toBeInTheDocument();
    expect(within(toolbar).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(within(toolbar).queryByText('0%')).not.toBeInTheDocument();
    expect(within(toolbar).getByText('2.5')).toBeInTheDocument();
  });
  it('uses the account timezone for today and writes an exact chosen date without a goal or Todo', async () => {
    const user = userEvent.setup(); view();
    await user.click(screen.getByRole('button', { name: '월간' }));
    expect(screen.getByRole('button', { name: '2026년 9월 9일, 오늘, 일정 0개' })).toHaveAttribute('aria-current', 'date');
    await user.click(screen.getByRole('button', { name: '다음 달' }));
    await user.click(screen.getByRole('button', { name: '2026년 10월 1일 일정 추가' }));
    expect(screen.getByLabelText('일정 날짜')).toHaveValue('2026-10-01');
    await user.type(screen.getByLabelText('일정 제목'), '월초 검토');
    await user.selectOptions(screen.getByLabelText('시작'), '0');
    fireEvent.submit(screen.getByLabelText('일정 제목').closest('form')!);
    expect(state.planner.saveTimeBlock).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-10-01', day: 'thu', taskId: null, startMinutes: 0, title: '월초 검토' }));
    expect(state.planner.addTask).not.toHaveBeenCalled();
  });
  it('edits and deletes an existing saved block, keeping its absolute date instead of the current week', async () => {
    const user = userEvent.setup();
    state.planner.timeBlocks = [event('나중 일정', '2026-09-30')];
    const viewResult = view(); await user.click(screen.getByRole('button', { name: '월간' }));
    await user.click(screen.getByRole('button', { name: '2026년 9월 30일 09:00 나중 일정 일정 수정' }));
    await user.clear(screen.getByLabelText('일정 제목')); await user.type(screen.getByLabelText('일정 제목'), '다음 달로 수정');
    fireEvent.change(screen.getByLabelText('일정 날짜'), { target: { value: '2026-10-02' } });
    fireEvent.submit(screen.getByLabelText('일정 제목').closest('form')!);
    const input = vi.mocked(state.planner.saveTimeBlock as (input: SaveTimeBlockInput) => boolean).mock.calls[0][0];
    expect(input).toMatchObject({ id: '나중 일정', date: '2026-10-02', day: 'fri', taskId: null });
    // Feed the persisted result back through the same model the provider exposes after saving.
    state.planner.timeBlocks = [{ ...event('나중 일정', input.date!), title: input.title }];
    viewResult.rerender(<MemoryRouter><PlannerScreen /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: '다음 달' }));
    await user.click(screen.getByRole('button', { name: '2026년 10월 2일 09:00 다음 달로 수정 일정 수정' }));
    await user.click(screen.getByRole('button', { name: '일정에서 삭제' }));
    expect(state.planner.removeTimeBlock).toHaveBeenCalledWith('나중 일정');
    expect(state.planner.removeTask).not.toHaveBeenCalled();
  });
  it('checks conflicts on the destination date and retains the editor when rejected', async () => {
    const user = userEvent.setup(); state.planner.timeBlocks = [event('다른 날짜 같은 시간', '2026-09-16', 1020), event('이미 잡힌 일정', '2026-09-23', 1020)];
    view(); await user.click(screen.getByRole('button', { name: '월간' }));
    await user.click(screen.getByRole('button', { name: '2026년 9월 23일 일정 추가' }));
    await user.type(screen.getByLabelText('일정 제목'), '수정할 내용 유지');
    fireEvent.submit(screen.getByLabelText('일정 제목').closest('form')!);
    expect(screen.getByRole('alert')).toHaveTextContent('이미 잡힌 일정');
    expect(screen.getByLabelText('일정 제목')).toHaveValue('수정할 내용 유지');
    expect(state.planner.saveTimeBlock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('일정 날짜'), { target: { value: '2026-09-30' } });
    fireEvent.submit(screen.getByLabelText('일정 제목').closest('form')!);
    expect(state.planner.saveTimeBlock).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-09-30', day: 'wed' }));
  });
  it('places a sidebar Todo on the selected month date without manufacturing a goal', async () => {
    const user = userEvent.setup();
    state.planner.tasks = [{ id: 't', title: '독립 할 일', status: 'todo', outcomeId: null, estimateMinutes: 25, pinned: false, carryCount: 0 } satisfies Task];
    view(); await user.click(screen.getByRole('button', { name: '월간' }));
    await user.click(screen.getByRole('button', { name: '2026년 9월 25일, 일정 0개' }));
    await user.click(screen.getByRole('button', { name: '독립 할 일 일정에 배치' }));
    expect(screen.getByLabelText('일정 날짜')).toHaveValue('2026-09-25');
    fireEvent.submit(screen.getByLabelText('할 일 제목').closest('form')!);
    expect(state.planner.saveTimeBlock).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-09-25', taskId: 't', taskPatch: { title: '독립 할 일', outcomeId: null, subtasks: [] } }));
  });
  it('leaves the existing weekly weekday editor available', async () => {
    const user = userEvent.setup(); view();
    await user.click(screen.getAllByRole('button', { name: '월요일 17:00에 할 일 또는 일정 추가' })[1]);
    expect(screen.queryByLabelText('일정 날짜')).not.toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: /^월\s*7$/ })).toBeInTheDocument();
  });
});
