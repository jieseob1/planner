import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './App';
import { createDemoSnapshot } from './data/demo';
import type { PlannerSnapshot } from './domain/types';
import { PlannerProvider } from './state/PlannerProvider';

const snapshotResponse = (snapshot: PlannerSnapshot, revision: number) => new Response(
  JSON.stringify({ revision, snapshot }),
  { status: 200, headers: { 'Content-Type': 'application/json', ETag: `"${revision}"` } }
);

const createStatefulApiMock = () => {
  let snapshot: PlannerSnapshot | null = null;
  let revision = 0;
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') {
      return snapshot ? snapshotResponse(snapshot, revision) : new Response(null, { status: 404 });
    }
    if (method === 'PUT') {
      snapshot = JSON.parse(String(init?.body)) as PlannerSnapshot;
      revision += 1;
      return snapshotResponse(snapshot, revision);
    }
    if (method === 'DELETE') {
      snapshot = null;
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  });
};

beforeEach(() => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  vi.stubGlobal('fetch', createStatefulApiMock());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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

    const firstDialog = screen.getByRole('dialog', { name: '데모 데이터로 모두 초기화할까요?' });
    await user.click(within(firstDialog).getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog', { name: '데모 데이터로 모두 초기화할까요?' })).not.toBeInTheDocument();

    await openRouteFromNavigation(user, 'Planner');
    expect(screen.getByText('초기화 전에 남길 작업')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '데모 초기화' }));
    const secondDialog = screen.getByRole('dialog', { name: '데모 데이터로 모두 초기화할까요?' });
    await user.click(within(secondDialog).getByRole('button', { name: '기기·서버 데이터 초기화' }));

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

describe('Planner API synchronization', () => {
  it('shows local state immediately and claims server save only after bootstrap acknowledgement', async () => {
    const localSnapshot = createDemoSnapshot();
    localSnapshot.tasks = [
      { ...localSnapshot.tasks[0], id: 'task-local-only', title: '로컬 우선 작업' },
      ...localSnapshot.tasks.slice(1)
    ];
    window.localStorage.setItem('planner.mvp.snapshot.v1', JSON.stringify(localSnapshot));

    let acknowledgePut: ((response: Response) => void) | undefined;
    const pendingPut = new Promise<Response>((resolve) => {
      acknowledgePut = resolve;
    });
    const apiMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') return new Response(null, { status: 404 });
      if (init?.method === 'PUT') return pendingPut;
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', apiMock);

    renderRoute('/planner');
    expect(screen.getByText('로컬 우선 작업')).toBeInTheDocument();
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('서버에 저장됨')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('planner.mvp.snapshot.v1')).toContain('로컬 우선 작업');

    await act(async () => {
      acknowledgePut?.(snapshotResponse(localSnapshot, 1));
      await pendingPut;
    });
    expect(await screen.findByText('서버에 저장됨')).toBeInTheDocument();

    const putRequest = apiMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(new Headers(putRequest?.[1]?.headers).get('If-None-Match')).toBe('*');
    expect(new Headers(putRequest?.[1]?.headers).get('Idempotency-Key')).toBeTruthy();
  });

  it('hydrates the server snapshot when no local snapshot exists', async () => {
    const serverSnapshot = createDemoSnapshot();
    serverSnapshot.tasks = [
      { ...serverSnapshot.tasks[0], id: 'task-from-server', title: '서버에서 불러온 작업' },
      ...serverSnapshot.tasks.slice(1)
    ];
    const apiMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => (
      (init?.method ?? 'GET') === 'GET'
        ? snapshotResponse(serverSnapshot, 8)
        : new Response(null, { status: 500 })
    ));
    vi.stubGlobal('fetch', apiMock);

    renderRoute('/planner');

    expect(await screen.findByText('서버에서 불러온 작업')).toBeInTheDocument();
    expect(await screen.findByText('서버에 저장됨')).toBeInTheDocument();
    expect(apiMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
    expect(window.localStorage.getItem('planner.mvp.snapshot.v1')).toContain('서버에서 불러온 작업');
  });

  it('writes local changes immediately and debounces a revision-checked server update', async () => {
    const apiMock = createStatefulApiMock();
    vi.stubGlobal('fetch', apiMock);
    const user = userEvent.setup();
    renderRoute('/today');
    expect(await screen.findByText('서버에 저장됨')).toBeInTheDocument();

    await user.type(screen.getByLabelText('빠른 메모'), '서버 저장 확인 작업{Enter}');
    expect(screen.getByText('서버에 저장 중')).toBeInTheDocument();
    expect(window.localStorage.getItem('planner.mvp.snapshot.v1')).toContain('서버 저장 확인 작업');

    await waitFor(() => {
      const matchingPut = apiMock.mock.calls.find(([, init]) => (
        init?.method === 'PUT' && String(init.body).includes('서버 저장 확인 작업')
      ));
      expect(matchingPut).toBeDefined();
      expect(new Headers(matchingPut?.[1]?.headers).get('If-Match')).toBe('"1"');
      expect(new Headers(matchingPut?.[1]?.headers).get('Idempotency-Key')).toBeTruthy();
    });
    expect(await screen.findByText('서버에 저장됨')).toBeInTheDocument();
  });

  it('preserves changes in localStorage while offline and retries after reconnect', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    const apiMock = vi.fn();
    vi.stubGlobal('fetch', apiMock);
    const user = userEvent.setup();
    renderRoute('/today');

    await user.type(screen.getByLabelText('빠른 메모'), '오프라인 보존 작업{Enter}');
    expect(screen.getByText('오프라인')).toBeInTheDocument();
    expect(window.localStorage.getItem('planner.mvp.snapshot.v1')).toContain('오프라인 보존 작업');
    expect(apiMock).not.toHaveBeenCalled();

    const reconnectedApi = createStatefulApiMock();
    vi.stubGlobal('fetch', reconnectedApi);
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    act(() => window.dispatchEvent(new Event('online')));

    await waitFor(() => {
      const matchingPut = reconnectedApi.mock.calls.find(([, init]) => (
        init?.method === 'PUT' && String(init.body).includes('오프라인 보존 작업')
      ));
      expect(matchingPut).toBeDefined();
    });
    expect(await screen.findByText('서버에 저장됨')).toBeInTheDocument();
  });

  it('surfaces a revision conflict without replacing the local change', async () => {
    const serverSnapshot = createDemoSnapshot();
    const apiMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') return snapshotResponse(serverSnapshot, 7);
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({
          type: 'https://nowline.local/problems/revision-conflict',
          title: 'Revision conflict',
          status: 412,
          detail: 'The planner has changed on another client.'
        }), { status: 412, headers: { 'Content-Type': 'application/problem+json' } });
      }
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', apiMock);
    const user = userEvent.setup();
    renderRoute('/today');
    expect(await screen.findByText('서버에 저장됨')).toBeInTheDocument();

    await user.type(screen.getByLabelText('빠른 메모'), '충돌에서도 지킬 작업{Enter}');

    expect(await screen.findByText('서버 저장 충돌')).toBeInTheDocument();
    expect(screen.getByText('기기 변경을 덮어쓰지 않고 보존했어요')).toBeInTheDocument();
    expect(window.localStorage.getItem('planner.mvp.snapshot.v1')).toContain('충돌에서도 지킬 작업');
    await openRouteFromNavigation(user, 'Planner');
    expect(screen.getByText('충돌에서도 지킬 작업')).toBeInTheDocument();
  });

  it('resets against the latest server revision after a stale-write conflict', async () => {
    const serverSnapshot = createDemoSnapshot();
    let getCount = 0;
    let putCount = 0;
    const apiMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        getCount += 1;
        return snapshotResponse(serverSnapshot, getCount === 1 ? 7 : 8);
      }
      if (method === 'PUT') {
        putCount += 1;
        if (putCount === 1) {
          return new Response(JSON.stringify({
            title: 'Revision conflict',
            status: 412,
            detail: 'The planner has changed on another client.'
          }), { status: 412, headers: { 'Content-Type': 'application/problem+json' } });
        }
        return snapshotResponse(JSON.parse(String(init?.body)) as PlannerSnapshot, 10);
      }
      if (method === 'DELETE') return new Response(null, { status: 204 });
      return new Response(null, { status: 405 });
    });
    vi.stubGlobal('fetch', apiMock);
    const user = userEvent.setup();
    renderRoute('/today');
    expect(await screen.findByText('서버에 저장됨')).toBeInTheDocument();

    await user.type(screen.getByLabelText('빠른 메모'), '초기화할 충돌 작업{Enter}');
    expect(await screen.findByText('서버 저장 충돌')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '데모 초기화' }));
    const dialog = screen.getByRole('dialog', { name: '데모 데이터로 모두 초기화할까요?' });
    await user.click(within(dialog).getByRole('button', { name: '기기·서버 데이터 초기화' }));

    await waitFor(() => {
      const deleteRequest = apiMock.mock.calls.find(([, init]) => init?.method === 'DELETE');
      expect(deleteRequest).toBeDefined();
      expect(new Headers(deleteRequest?.[1]?.headers).get('If-Match')).toBe('"8"');
    });
    expect(await screen.findByText('서버에 저장됨')).toBeInTheDocument();
    expect(screen.queryByText('초기화할 충돌 작업')).not.toBeInTheDocument();
  });

  it('does not hydrate over a local edit made while the initial GET is pending', async () => {
    const serverSnapshot = createDemoSnapshot();
    let resolveGet: ((response: Response) => void) | undefined;
    const pendingGet = new Promise<Response>((resolve) => {
      resolveGet = resolve;
    });
    const apiMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => (
      (init?.method ?? 'GET') === 'GET'
        ? pendingGet
        : new Response(null, { status: 500 })
    ));
    vi.stubGlobal('fetch', apiMock);
    const user = userEvent.setup();
    renderRoute('/today');

    await user.type(screen.getByLabelText('빠른 메모'), '초기 조회 중 작성한 작업{Enter}');
    expect(window.localStorage.getItem('planner.mvp.snapshot.v1')).toContain('초기 조회 중 작성한 작업');

    await act(async () => {
      resolveGet?.(snapshotResponse(serverSnapshot, 4));
      await pendingGet;
    });

    expect(await screen.findByText('서버 저장 충돌')).toBeInTheDocument();
    await openRouteFromNavigation(user, 'Planner');
    expect(screen.getByText('초기 조회 중 작성한 작업')).toBeInTheDocument();
    expect(apiMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
  });

  it('reuses the idempotency key when a failed write is retried', async () => {
    let putAttempts = 0;
    const apiMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') return new Response(null, { status: 404 });
      if (init?.method === 'PUT') {
        putAttempts += 1;
        if (putAttempts === 1) throw new TypeError('connection reset');
        return snapshotResponse(JSON.parse(String(init.body)) as PlannerSnapshot, 1);
      }
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', apiMock);
    const user = userEvent.setup();
    renderRoute('/today');

    expect(await screen.findByText('서버 연결 실패')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('서버에 저장됨')).toBeInTheDocument();

    const putCalls = apiMock.mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect(putCalls).toHaveLength(2);
    const firstKey = new Headers(putCalls[0][1]?.headers).get('Idempotency-Key');
    const secondKey = new Headers(putCalls[1][1]?.headers).get('Idempotency-Key');
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBe(firstKey);
  });
});
