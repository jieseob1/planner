import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TaskEditorSheet } from './TaskEditorSheet';
import { SubtaskEditor } from './SubtaskEditor';
import { TimeBlockSheet } from './TimeBlockSheet';
import type { Subtask, Task } from '../domain/types';
import { validSubtasks } from '../domain/subtasks';

afterEach(cleanup);
const task: Task = { id: 't', title: '상위 할 일', outcomeId: null, estimateMinutes: 60, status: 'todo', pinned: false, carryCount: 0 };

it('adds, edits, completes, reorders and undoes deletion without completing the parent', () => {
  const save = vi.fn(() => true);
  render(<TaskEditorSheet task={task} outcomes={[]} blockCount={1} entryCount={0} onSave={save} onDelete={() => true} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '하위 할 일 추가' }));
  expect(screen.getByRole('button', { name: '변경 저장' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('하위 할 일 1 제목'), { target: { value: '원인 찾기' } });
  fireEvent.click(screen.getByRole('button', { name: '하위 할 일 추가' }));
  fireEvent.change(screen.getByLabelText('하위 할 일 2 제목'), { target: { value: '회귀 테스트' } });
  fireEvent.click(screen.getByLabelText('원인 찾기 완료'));
  fireEvent.click(screen.getByRole('button', { name: '하위 할 일 2 위로' }));
  expect(screen.getByLabelText('하위 할 일 1 제목')).toHaveValue('회귀 테스트');
  fireEvent.click(screen.getByRole('button', { name: '하위 할 일 2 삭제' }));
  expect(screen.queryByLabelText('원인 찾기 완료')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '마지막 삭제 취소' }));
  expect(screen.getByLabelText('원인 찾기 완료')).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: '변경 저장' }));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ status: 'todo', subtasks: [
    expect.objectContaining({ title: '회귀 테스트', done: false }), expect.objectContaining({ title: '원인 찾기', done: true })
  ] }));
});

it('does not submit the parent form or append during Korean composition', () => {
  const submit = vi.fn(event => event.preventDefault());
  function Fixture() {
    const [items, setItems] = useState<Subtask[]>([{ id: 'one', title: '한글', done: false }]);
    return <form onSubmit={submit}><SubtaskEditor value={items} onChange={setItems} /></form>;
  }
  render(<Fixture />);
  fireEvent.keyDown(screen.getByLabelText('하위 할 일 1 제목'), { key: 'Enter', isComposing: true });
  expect(screen.queryByLabelText('하위 할 일 2 제목')).not.toBeInTheDocument();
  expect(submit).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByLabelText('하위 할 일 1 제목'), { key: 'Enter', isComposing: false });
  expect(screen.getByLabelText('하위 할 일 2 제목')).toHaveFocus();
});

it('enforces blank, duplicate id, title and count limits while permitting explicit clearing', () => {
  expect(validSubtasks([])).toBe(true);
  const item = { id: 'one', title: '기록', done: false };
  expect(validSubtasks([item])).toBe(true);
  expect(validSubtasks([item, item])).toBe(false);
  expect(validSubtasks([{ ...item, title: ' ' }])).toBe(false);
  expect(validSubtasks([{ ...item, title: 'x'.repeat(501) }])).toBe(false);
  expect(validSubtasks(Array.from({ length: 101 }, (_, i) => ({ ...item, id: String(i) })))).toBe(false);
});

it('keeps task selection drafts separate and cannot undo a deletion into another task', () => {
  const save = vi.fn();
  const first = { ...task, subtasks: [{ id: 'a', title: '첫 할 일 단계', done: false }] };
  const second = { ...task, id: 'other', title: '다른 할 일', subtasks: [{ id: 'b', title: '다른 할 일 단계', done: true }] };
  render(<TimeBlockSheet tasks={[first, second]} initialDay="mon" initialStartMinutes={540} initialDurationMinutes={60} onClose={() => {}} onSave={save} />);
  fireEvent.click(screen.getByRole('button', { name: '하위 할 일 1 삭제' }));
  expect(screen.getByRole('button', { name: '마지막 삭제 취소' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('할 일 선택'), { target: { value: 'other' } });
  expect(screen.queryByRole('button', { name: '마지막 삭제 취소' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('하위 할 일 1 제목')).toHaveValue('다른 할 일 단계');
  fireEvent.click(screen.getByRole('button', { name: '추가' }));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'other', subtasks: second.subtasks }));
  fireEvent.change(screen.getByLabelText('할 일 선택'), { target: { value: 't' } });
  expect(screen.queryByLabelText('하위 할 일 1 제목')).not.toBeInTheDocument();
});
