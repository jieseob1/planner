import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskEditorSheet } from './TaskEditorSheet';
import type { Task } from '../domain/types';
const task: Task = { id: 'one', title: '원래 할 일', outcomeId: null, estimateMinutes: 37, status: 'done', pinned: false, carryCount: 0 };
const setup = (saveResult = true) => {
  const onSave = vi.fn(() => saveResult), onDelete = vi.fn(() => true), onClose = vi.fn();
  render(<TaskEditorSheet task={task} outcomes={[]} blockCount={2} entryCount={3} onSave={onSave} onDelete={onDelete} onClose={onClose} />);
  return { onSave, onDelete, onClose };
};
afterEach(cleanup);
describe('TaskEditorSheet', () => {
  it('edits title, status, estimate and memo without requiring a goal', () => {
    const { onSave, onClose } = setup();
    expect(screen.getByLabelText('예상 시간 (분)')).toHaveValue(37);
    fireEvent.change(screen.getByLabelText('할 일 제목'), { target: { value: '새 제목' } });
    fireEvent.change(screen.getByLabelText('상태'), { target: { value: 'todo' } });
    fireEvent.change(screen.getByLabelText('메모'), { target: { value: '메모 수정' } });
    fireEvent.click(screen.getByRole('button', { name: '변경 저장' }));
    expect(onSave).toHaveBeenCalledWith({ title: '새 제목', outcomeId: null, estimateMinutes: 37, status: 'todo', note: '메모 수정' });
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('keeps a failed edit open and does not claim success', () => {
    const { onClose } = setup(false);
    fireEvent.click(screen.getByRole('button', { name: '변경 저장' }));
    expect(screen.getByRole('alert')).toHaveTextContent('저장하지 못했습니다');
    expect(onClose).not.toHaveBeenCalled();
  });
  it('requires an explicit cascade confirmation and lets the user back out', () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole('button', { name: '할 일 삭제' }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText(/일정 2개, 실행 기록 3개/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '수정으로 돌아가기' }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '할 일 삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '할 일과 연결 기록 삭제' }));
    expect(onDelete).toHaveBeenCalledOnce();
  });
});
