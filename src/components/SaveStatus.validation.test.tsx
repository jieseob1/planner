import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveStatus } from './SaveStatus';
import { plannerSaveProblem } from '../state/saveProblem';
import { PlannerApiError } from '../api/plannerApi';

const mock = vi.hoisted(() => ({ planner: {} as Record<string, unknown>, retry: vi.fn() }));
vi.mock('../state/PlannerProvider', () => ({ usePlanner: () => mock.planner }));
vi.mock('./ConflictResolutionModal', () => ({ ConflictResolutionModal: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  mock.planner = {
    saveStatus: 'validation-error', retrySync: mock.retry, syncConflict: null,
    saveProblem: plannerSaveProblem(new PlannerApiError(400, 'PRIVATE', {
      code: 'validation-failed', detail: '요청 값이 유효성 규칙을 충족하지 않습니다.',
      errors: [{ field: 'plan.annualDirection', message: 'must not be blank' }]
    }), true)
  };
});

describe('SaveStatus validation guidance', () => {
  it('shows400 and the actionable field, opens safe details and retries only on explicit action', async () => {
    render(<SaveStatus />);
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('서버 저장 거절 (400)');
    expect(notice).toHaveTextContent('계획 · 연간 방향: 비워 둘 수 없습니다.');
    expect(screen.queryByText('서버 연결 실패')).not.toBeInTheDocument();
    expect(mock.retry).not.toHaveBeenCalled();
    const user = userEvent.setup();
    screen.getByRole('button', { name: '오류 확인' }).focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: '저장할 내용을 확인해 주세요' });
    expect(dialog).toHaveTextContent('변경 내용은 이 기기에 보관 중입니다.');
    expect(dialog).toHaveTextContent('plan.annualDirection');
    expect(dialog).toHaveTextContent('HTTP 400 · validation-failed');
    expect(dialog).not.toHaveTextContent('PRIVATE');
    expect(within(dialog).queryByRole('button', { name: /초기화|서버에서 불러오기/ })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '다시 저장' }));
    expect(mock.retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not claim durable local storage when writing the local snapshot also failed', async () => {
    mock.planner.saveProblem = { ...(mock.planner.saveProblem as object), localStored: false };
    render(<SaveStatus />);
    await userEvent.setup().click(screen.getByRole('button', { name: '오류 확인' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('기기 저장에도 실패했으니 이 탭을 닫지 마세요.');
  });

  it('retains network retry wording and recovers to the existing saved status', () => {
    mock.planner.saveStatus = 'retry';
    mock.planner.saveProblem = null;
    const view = render(<SaveStatus />);
    expect(screen.getByRole('status')).toHaveTextContent('서버 연결 실패');
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
    mock.planner.saveStatus = 'saved';
    view.rerender(<SaveStatus />);
    expect(screen.getByRole('status')).toHaveTextContent('서버에 저장됨');
    expect(screen.queryByRole('button', { name: '오류 확인' })).not.toBeInTheDocument();
  });
});
