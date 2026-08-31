import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from './App';
import { PlannerProvider } from './state/PlannerProvider';

function renderRoute(route: string) {
  return render(
    <PlannerProvider>
      <MemoryRouter initialEntries={[route]}>
        <AppRoutes />
      </MemoryRouter>
    </PlannerProvider>
  );
}

async function openRouteFromNavigation(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getAllByRole('link', { name })[0]);
}

async function completeReviewChoices(user: ReturnType<typeof userEvent.setup>) {
  const metric = screen.getByPlaceholderText('예: 24');
  await user.clear(metric);
  await user.type(metric, '24');
  await user.click(screen.getByRole('radio', { name: /일이 너무 컸어요/ }));
}

describe('Planner frontend core flows', () => {
  it('starts and completes the primary task from Today', async () => {
    const user = userEvent.setup();
    renderRoute('/today');

    expect(screen.getByRole('heading', { name: '오늘은 하나를 끝냅니다.' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /지금 시작/ }));
    expect(screen.getByText('지금 실행 중')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /종료/ }));
    expect(screen.getByRole('dialog', { name: '이번 실행을 정리할까요?' })).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/다이어그램 초안 링크/), '복구 흐름 초안 작성');
    await user.click(screen.getByRole('button', { name: /이 작업은 완료/ }));

    expect(screen.queryByText('지금 실행 중')).not.toBeInTheDocument();
    expect(screen.getByText(/기록 00:01/)).toBeInTheDocument();
  });

  it('submits quick capture exactly once when Enter is pressed', async () => {
    const user = userEvent.setup();
    renderRoute('/today');

    const capture = screen.getByLabelText('빠른 메모');
    await user.type(capture, '배포 체크리스트 확인{Enter}');

    expect(screen.getByText('수집함에 넣었어요.')).toBeInTheDocument();
    expect(capture).toHaveValue('');

    await openRouteFromNavigation(user, 'Planner');
    expect(screen.getAllByText('배포 체크리스트 확인')).toHaveLength(1);
  });

  it('keeps local data when reset is cancelled and restores demo data only after confirmation', async () => {
    const user = userEvent.setup();
    renderRoute('/today');

    await user.type(screen.getByLabelText('빠른 메모'), '초기화 전에 남길 작업{Enter}');
    await user.click(screen.getByRole('button', { name: '데모 초기화' }));

    const firstDialog = screen.getByRole('dialog', { name: '데모 데이터를 초기화할까요?' });
    await user.click(within(firstDialog).getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog', { name: '데모 데이터를 초기화할까요?' })).not.toBeInTheDocument();

    await openRouteFromNavigation(user, 'Planner');
    expect(screen.getByText('초기화 전에 남길 작업')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '데모 초기화' }));
    const secondDialog = screen.getByRole('dialog', { name: '데모 데이터를 초기화할까요?' });
    await user.click(within(secondDialog).getByRole('button', { name: '기기 데이터 초기화' }));

    expect(screen.queryByText('초기화 전에 남길 작업')).not.toBeInTheDocument();
    expect(screen.getByText('세금계산서 발행')).toBeInTheDocument();
  });

  it('adds a next action to the Planner backlog', async () => {
    const user = userEvent.setup();
    renderRoute('/planner');

    await user.click(screen.getByRole('button', { name: /다음 행동 추가/ }));
    const dialog = screen.getByRole('dialog', { name: '다음 행동 추가' });
    await user.type(within(dialog).getByLabelText('실행할 행동'), '회고 요약 초안 작성');
    await user.click(within(dialog).getByRole('button', { name: '목록에 추가' }));

    expect(screen.queryByRole('dialog', { name: '다음 행동 추가' })).not.toBeInTheDocument();
    expect(screen.getByText('회고 요약 초안 작성')).toBeInTheDocument();
  });

  it('rejects an overlapping placement and accepts a nonconflicting time', async () => {
    const user = userEvent.setup();
    renderRoute('/planner');

    await user.click(screen.getByRole('button', { name: /세금계산서 발행/ }));
    const dialog = screen.getByRole('dialog', { name: '실행 시간을 정해요' });
    const start = within(dialog).getByLabelText(/시작/);

    await user.selectOptions(start, '1170');
    await user.click(within(dialog).getByRole('button', { name: '계획에 배치' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('19:30 다이어그램 작성과 시간이 겹칩니다.');

    await user.selectOptions(start, '420');
    await user.click(within(dialog).getByRole('button', { name: '계획에 배치' }));

    expect(screen.queryByRole('dialog', { name: '실행 시간을 정해요' })).not.toBeInTheDocument();
    expect(screen.getByText('세금계산서 발행 · 07:00에 배치했어요.')).toBeInTheDocument();
  });

  it('changes the visible week with the previous and next controls', async () => {
    const user = userEvent.setup();
    renderRoute('/planner');

    expect(screen.getByText('주간 Planner · 8월 31일 – 9월 6일')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '다음 주' }));
    expect(screen.getByText('주간 Planner · 9월 7일 – 13일')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '이전 주' }));
    expect(screen.getByText('주간 Planner · 8월 31일 – 9월 6일')).toBeInTheDocument();
  });

  it('rejects invalid review metrics and applies a valid value to Goals', async () => {
    const user = userEvent.setup();
    renderRoute('/review');

    const metric = screen.getByPlaceholderText('예: 24');
    fireEvent.change(metric, { target: { value: '숫자 아님' } });
    fireEvent.blur(metric);
    expect(screen.getByRole('alert')).toHaveTextContent('0 이상의 숫자를 입력하세요.');

    fireEvent.change(metric, { target: { value: '-1' } });
    expect(screen.getByRole('alert')).toHaveTextContent('0 이상의 숫자를 입력하세요.');

    await user.clear(metric);
    await user.type(metric, '24');
    await user.click(screen.getByRole('button', { name: '반영' }));
    expect(screen.getByRole('button', { name: '반영됨' })).toBeInTheDocument();

    await openRouteFromNavigation(user, 'Goals');
    const revenueRow = screen.getByText('사이드 수익 월 80만원').closest('tr');
    expect(revenueRow).not.toBeNull();
    expect(within(revenueRow as HTMLTableRowElement).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30');
    expect(within(revenueRow as HTMLTableRowElement).getByText(/24/)).toBeInTheDocument();
  });

  it('opens next-week Planner with the review Top 3 prioritized after completion', async () => {
    const user = userEvent.setup();
    renderRoute('/review');

    await completeReviewChoices(user);
    await user.click(screen.getByRole('button', { name: /주간 점검 완료/ }));
    expect(screen.getByRole('heading', { name: '다음 주의 기준이 정해졌습니다.' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /다음 주 시간 배치/ }));
    expect(screen.getByText('주간 Planner · 9월 7일 – 13일')).toBeInTheDocument();
    expect(screen.getByText('회고에서 고른 다음 주 Top 3를 먼저 보여드려요.')).toBeInTheDocument();

    const backlog = screen.getByRole('complementary', { name: '배치 전 다음 행동' });
    const taskButtons = within(backlog).getAllByRole('button');
    const diagramIndex = taskButtons.findIndex((button) => button.textContent?.includes('장애 복구 흐름 다이어그램 작성'));
    const draftIndex = taskButtons.findIndex((button) => button.textContent?.includes('기술 글 3편 초안'));
    const invoiceIndex = taskButtons.findIndex((button) => button.textContent?.includes('세금계산서 발행'));
    expect(diagramIndex).toBeGreaterThanOrEqual(0);
    expect(draftIndex).toBeGreaterThan(diagramIndex);
    expect(invoiceIndex).toBeGreaterThan(draftIndex);
  });

  it('opens the exact split action from a carryover query', () => {
    renderRoute('/planner?action=split&task=task-diagram');

    const dialog = screen.getByRole('dialog', { name: '다음 행동 추가' });
    expect(within(dialog).getByLabelText('실행할 행동')).toHaveValue('장애 복구 흐름 다이어그램 작성 — 1단계');
    expect(within(dialog).getByLabelText('예상 시간')).toHaveValue('40');
  });

  it('opens the exact reschedule action from a carryover query', () => {
    renderRoute('/planner?action=reschedule&task=task-diagram');

    const dialog = screen.getByRole('dialog', { name: '실행 시간을 정해요' });
    expect(dialog).toHaveAccessibleDescription('“장애 복구 흐름 다이어그램 작성”을 달력에 배치합니다.');
  });

  it('opens the parent outcome stop confirmation from a carryover query', () => {
    renderRoute('/goals?action=stop&task=task-diagram');

    const dialog = screen.getByRole('dialog', { name: 'Redis Streams 배포 중단 확인' });
    expect(within(dialog).getByText(/장애 복구 흐름 다이어그램 작성/)).toBeInTheDocument();
    expect(within(dialog).getByText(/상위 결과는/)).toHaveTextContent('Redis Streams 배포');
  });

  it('edits the annual plan and its selected outcome in one save', async () => {
    const user = userEvent.setup();
    renderRoute('/goals');

    await user.click(screen.getByRole('button', { name: '계획 편집' }));
    const dialog = screen.getByRole('dialog', { name: '계획 편집' });
    const annualDirection = within(dialog).getByLabelText('연간 방향');
    const outcomeTitle = within(dialog).getByLabelText('결과 이름');
    const target = within(dialog).getByLabelText('목표값');

    await user.clear(annualDirection);
    await user.type(annualDirection, '검증 가능한 제품과 실행 습관 만들기');
    await user.clear(outcomeTitle);
    await user.type(outcomeTitle, '기술 글 8개 발행');
    await user.clear(target);
    await user.type(target, '8');
    await user.click(within(dialog).getByRole('button', { name: '계획 반영' }));

    expect(screen.queryByRole('dialog', { name: '계획 편집' })).not.toBeInTheDocument();
    expect(screen.getByText('검증 가능한 제품과 실행 습관 만들기')).toBeInTheDocument();
    expect(screen.getAllByText('기술 글 8개 발행').length).toBeGreaterThan(0);
  });

  it('prevents onboarding from choosing an overlapping recommended slot', async () => {
    const user = userEvent.setup();
    renderRoute('/onboarding');

    await user.type(screen.getByLabelText('결과 한 문장'), '운영 자동화 글 3개 발행');
    await user.click(screen.getByRole('button', { name: /계속/ }));
    await user.type(screen.getByLabelText('첫 번째 다음 행동'), '첫 글의 실패 흐름 목차 작성');
    await user.click(screen.getByRole('button', { name: /계속/ }));

    const conflictingSlot = screen.getByRole('radio', { name: /오늘 저녁.*시간 겹침.*19:30 다이어그램 작성/ });
    expect(conflictingSlot).toBeDisabled();
    expect(conflictingSlot).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: /내일 아침/ })).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('button', { name: /첫 실행 만들기/ }));
    expect(screen.getByRole('heading', { name: '오늘은 하나를 끝냅니다.' })).toBeInTheDocument();
    expect(screen.getByText('첫 글의 실패 흐름 목차 작성')).toBeInTheDocument();
  });

  it('records a goal decision', async () => {
    const user = userEvent.setup();
    renderRoute('/goals');

    const group = screen.getByRole('group', { name: /기술 글 6개 발행 결정/ });
    await user.click(within(group).getByRole('button', { name: '유지' }));
    expect(within(group).getByRole('button', { name: '유지' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('1/4 결정')).toBeInTheDocument();
  });
});
