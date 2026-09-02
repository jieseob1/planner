import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoSnapshot } from '../data/demo';
import type { PlannerSnapshot } from '../domain/types';
import { applyOutcomeLifecycle, usePlanner } from '../state/PlannerProvider';
import { GoalsScreen } from './GoalsScreen';

vi.mock('../state/PlannerProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/PlannerProvider')>();
  return { ...actual, usePlanner: vi.fn() };
});

const mockedUsePlanner = vi.mocked(usePlanner);

const actions = {
  setOutcomeDecision: vi.fn(),
  updatePlan: vi.fn(() => true),
  addOutcome: vi.fn(() => 'outcome-new'),
  updateOutcome: vi.fn(() => true),
  stopOutcome: vi.fn(() => true),
  removeOutcome: vi.fn(() => true)
};

const plannerValue = (snapshot: PlannerSnapshot) => ({
  ...snapshot,
  ...actions
}) as unknown as ReturnType<typeof usePlanner>;

const renderGoals = (snapshot = createDemoSnapshot()) => {
  mockedUsePlanner.mockReturnValue(plannerValue(snapshot));
  return render(<MemoryRouter><GoalsScreen /></MemoryRouter>);
};

beforeEach(() => {
  vi.clearAllMocks();
  actions.updatePlan.mockReturnValue(true);
  actions.addOutcome.mockReturnValue('outcome-new');
  actions.updateOutcome.mockReturnValue(true);
  actions.stopOutcome.mockReturnValue(true);
  actions.removeOutcome.mockReturnValue(true);
});

describe('red-team outcome lifecycle remediation', () => {
  it('shows the persisted next check date and recent metric evidence', async () => {
    const user = userEvent.setup();
    renderGoals();

    expect(screen.getByText('9월 4일')).toBeInTheDocument();
    const summary = screen.getAllByText('지표 이력 2건')[0];
    await user.click(summary);
    const history = summary.closest('details');
    expect(history).not.toBeNull();
    expect(within(history!).getByText('게시 URL 2건 확인')).toBeInTheDocument();
    expect(within(history!).getByText('게시 URL 1건 확인')).toBeInTheDocument();
  });

  it('adds an outcome independently with every management field', async () => {
    const user = userEvent.setup();
    renderGoals();

    await user.click(screen.getByRole('button', { name: '결과 추가' }));
    const dialog = screen.getByRole('dialog', { name: '분기 결과 추가' });
    await user.type(within(dialog).getByLabelText('결과 이름'), '베타 사용자 인터뷰');
    await user.type(within(dialog).getByLabelText(/현재값/), '3');
    await user.type(within(dialog).getByLabelText('목표값'), '12');
    await user.type(within(dialog).getByLabelText('측정 단위'), '명');
    await user.selectOptions(within(dialog).getByLabelText('달성 확신'), 'high');
    await user.type(within(dialog).getByLabelText('필요 시간'), '20');
    await user.type(within(dialog).getByLabelText('가용 시간'), '24');
    await user.type(within(dialog).getByLabelText('판단 근거'), '인터뷰 기록 3건');
    await user.type(within(dialog).getByLabelText(/다음 점검일/), '2026-09-10');
    await user.click(within(dialog).getByRole('button', { name: '결과 추가' }));

    expect(actions.addOutcome).toHaveBeenCalledWith({
      title: '베타 사용자 인터뷰',
      current: 3,
      target: 12,
      unit: '명',
      confidence: 'high',
      evidenceLabel: '인터뷰 기록 3건',
      nextCheckDate: '2026-09-10',
      neededHours: 20,
      availableHours: 24
    });
    expect(screen.getByRole('status')).toHaveTextContent('새 분기 결과를 추가했습니다.');
  });

  it('edits title, current, target, unit, confidence, evidence, and capacity together', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();
    const outcome = snapshot.outcomes[0];
    renderGoals(snapshot);

    await user.click(screen.getByRole('button', { name: `${outcome.title} 결과 수정` }));
    const dialog = screen.getByRole('dialog', { name: '계획 편집' });
    const replace = async (label: string | RegExp, value: string) => {
      const input = within(dialog).getByLabelText(label);
      await user.clear(input);
      await user.type(input, value);
    };
    await replace('결과 이름', '기술 글 10개 발행');
    await replace(/현재값/, '4');
    await replace('목표값', '10');
    await replace('측정 단위', '편');
    await user.selectOptions(within(dialog).getByLabelText('달성 확신'), 'medium');
    await replace('필요 시간', '30');
    await replace('가용 시간', '18');
    await replace('판단 근거', '게시 URL 4건');
    await user.click(within(dialog).getByRole('button', { name: '결과 저장' }));

    expect(actions.updateOutcome).toHaveBeenCalledWith(outcome.id, {
      title: '기술 글 10개 발행',
      current: 4,
      target: 10,
      unit: '편',
      confidence: 'medium',
      evidenceLabel: '게시 URL 4건',
      nextCheckDate: outcome.nextCheckDate,
      neededHours: 30,
      availableHours: 18
    });
  });

  it('requires a linked-task choice before stopping an outcome', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();
    const outcome = snapshot.outcomes.find((item) => item.attention !== 'none')!;
    renderGoals(snapshot);

    const decisionGroup = screen.getByRole('group', { name: `${outcome.title} 결정` });
    await user.click(within(decisionGroup).getByRole('button', { name: '중단' }));
    const dialog = screen.getByRole('dialog', { name: `${outcome.title} 중단 확인` });
    const confirm = within(dialog).getByRole('button', { name: '선택대로 중단' });
    expect(confirm).toBeDisabled();

    await user.click(within(dialog).getByRole('radio', { name: /연결만 해제하고 작업 유지/ }));
    await user.click(confirm);
    expect(actions.stopOutcome).toHaveBeenCalledWith(outcome.id, 'detach');
    expect(screen.getByRole('status')).toHaveTextContent('독립 작업으로 유지했습니다.');
  });

  it('confirms deletion and passes the explicit cancel choice', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();
    const outcome = snapshot.outcomes[0];
    renderGoals(snapshot);

    await user.click(screen.getByRole('button', { name: `${outcome.title} 결과 수정` }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '결과 삭제' }));
    const dialog = screen.getByRole('dialog', { name: `${outcome.title} 삭제 확인` });
    await user.click(within(dialog).getByRole('radio', { name: /연결된 미완료 작업 취소/ }));
    await user.click(within(dialog).getByRole('button', { name: '선택대로 삭제' }));

    expect(actions.removeOutcome).toHaveBeenCalledWith(outcome.id, 'cancel');
  });

  it('preserves completed work, past schedule, and the execution ledger when cancelling linked work', () => {
    const source = createDemoSnapshot();
    const outcome = source.outcomes[0];
    const snapshot: PlannerSnapshot = {
      ...source,
      tasks: [
        { id: 'todo', title: '미완료 작업', outcomeId: outcome.id, estimateMinutes: 30, status: 'todo', pinned: true, carryCount: 0 },
        { id: 'done', title: '완료 작업', outcomeId: outcome.id, estimateMinutes: 30, status: 'done', pinned: false, carryCount: 0 }
      ],
      timeBlocks: [
        { id: 'past', taskId: 'todo', title: '과거 일정', day: 'tue', date: '2026-09-01', startMinutes: 600, durationMinutes: 30 },
        { id: 'future', taskId: 'todo', title: '미래 일정', day: 'thu', date: '2026-09-03', startMinutes: 600, durationMinutes: 30 },
        { id: 'done-future', taskId: 'done', title: '완료 작업 일정', day: 'thu', date: '2026-09-03', startMinutes: 700, durationMinutes: 30 }
      ],
      timeEntries: [
        { id: 'todo-log', taskId: 'todo', durationSeconds: 600, source: 'manual', observedAt: '2026-09-01T01:00:00.000Z' },
        { id: 'done-log', taskId: 'done', durationSeconds: 900, source: 'manual', observedAt: '2026-09-01T02:00:00.000Z' }
      ],
      timer: { taskId: 'todo', startedAt: null, accumulatedSeconds: 20, paused: true },
      review: { ...source.review, selectedTopTaskIds: ['todo', 'done'] }
    };

    const result = applyOutcomeLifecycle(snapshot, outcome.id, 'remove', 'cancel', new Date(2026, 8, 2, 12));

    expect(result.outcomes.some((item) => item.id === outcome.id)).toBe(false);
    expect(result.tasks.find((task) => task.id === 'todo')).toMatchObject({ status: 'cancelled', outcomeId: null });
    expect(result.tasks.find((task) => task.id === 'done')).toMatchObject({ status: 'done', outcomeId: null });
    expect(result.timeBlocks.map((block) => block.id)).toEqual(['past', 'done-future']);
    expect(result.timeEntries.map((entry) => entry.id)).toEqual(['todo-log', 'done-log']);
    expect(result.timer).toBeNull();
    expect(result.review.selectedTopTaskIds).toEqual(['done']);
  });
});
