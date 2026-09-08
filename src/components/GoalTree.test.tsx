import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { descendantGoalIds, GoalTree } from './GoalTree';
import { periodRange, type PeriodDocument, type PeriodGoal } from '../domain/periods';

const goal = (id: string, parentId: string | null = null, done = false): PeriodGoal => ({ ...periodRange('year', '2026-01-01'), id, title: id, parentId, measurement: 'completion', baseline: 0, current: 0, target: 1, unit: '', done, note: '', taskIds: [] });
const doc = (value: PeriodGoal): PeriodDocument => ({ goal: value, review: null, revision: 1, deleted: false, updatedAt: '2026-09-08T00:00:00Z' });

describe('GoalTree', () => {
  it('shows ancestors and descendants across periods without unrelated siblings or progress rollup', () => {
    const parent = goal('올해 결과');
    const child = { ...goal('분기 결과', parent.id), ...periodRange('quarter', '2026-09-08') };
    const grandchild = { ...goal('월간 실행', child.id, true), ...periodRange('month', '2026-09-08') };
    const documents = [doc(parent), doc(child), doc(grandchild), doc(goal('다른 분기', parent.id))];
    render(<GoalTree documents={documents} selectedIds={[child.id]} onEdit={vi.fn()} onAddChild={vi.fn()} />);
    expect(screen.getByRole('button', { name: '올해 결과 목표 수정' })).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: '분기 결과 목표 수정' })).getByText('0%')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: '월간 실행 목표 수정' })).getByText('100%')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '다른 분기 목표 수정' })).not.toBeInTheDocument();
    expect(parent.done).toBe(false);
    expect(child.done).toBe(false);
  });
  it('collapses with the keyboard and adds a child without opening the parent editor', async () => {
    const user = userEvent.setup();
    const parent = goal('큰 목표');
    const onAddChild = vi.fn(); const onEdit = vi.fn();
    render(<GoalTree documents={[doc(parent), doc(goal('작은 목표', parent.id))]} selectedIds={[parent.id]} onEdit={onEdit} onAddChild={onAddChild} />);
    screen.getByRole('button', { name: '큰 목표 하위 목표 접기' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: '큰 목표 하위 목표 펼치기' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: '작은 목표 목표 수정' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '큰 목표 하위 목표 추가' }));
    expect(onAddChild).toHaveBeenCalledWith(parent);
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '작은 목표 목표 수정' })).toBeInTheDocument();
  });
  it('renders every selected goal once even if a malformed import contains a cycle or deleted parent', () => {
    const documents = [doc(goal('a', 'b')), doc(goal('b', 'a')), { ...doc(goal('removed')), deleted: true }, doc(goal('orphan', 'removed'))];
    render(<GoalTree documents={documents} selectedIds={['a', 'b', 'orphan']} onEdit={vi.fn()} onAddChild={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /목표 수정$/ })).toHaveLength(3);
    expect(descendantGoalIds(documents.map(d => d.goal!), 'a')).toEqual(new Set(['b']));
  });
});
