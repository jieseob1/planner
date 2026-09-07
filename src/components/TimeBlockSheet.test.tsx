import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimeBlockSheet } from './TimeBlockSheet';
import type { Task } from '../domain/types';

const task: Task = { id: 'one', title: '원래 할 일', outcomeId: null, estimateMinutes: 25, status: 'done', pinned: false, carryCount: 0 };
const setup = () => {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(<TimeBlockSheet tasks={[task]} initialTaskId={task.id} initialBlockId="block" initialDay="mon" initialStartMinutes={540} initialDurationMinutes={25} onSave={onSave} onClose={onClose} />);
  return { onSave, onClose };
};
afterEach(cleanup);
describe('TimeBlockSheet existing Todo editing', () => {
  it('allows editing a completed Todo and preserves an existing 25-minute block', () => {
    const { onSave } = setup();
    expect(screen.getByLabelText('종료')).toHaveValue('565');
    fireEvent.change(screen.getByLabelText('할 일 제목'), { target: { value: '변경된 할 일' } });
    fireEvent.submit(screen.getByLabelText('할 일 제목').closest('form')!);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: '변경된 할 일', taskId: 'one', blockId: 'block', durationMinutes: 25, outcomeId: null }));
  });
  it('cancels without saving the title draft', () => {
    const { onSave, onClose } = setup();
    fireEvent.change(screen.getByLabelText('할 일 제목'), { target: { value: '버릴 초안' } });
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });
  it('can detach as an event without erasing the current title', () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByRole('button', { name: '일정만' }));
    expect(screen.getByLabelText('일정 제목')).toHaveValue(task.title);
    fireEvent.submit(screen.getByLabelText('일정 제목').closest('form')!);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ mode: 'event', taskId: null, title: task.title }));
  });
});
