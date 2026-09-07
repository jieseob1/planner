import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminScreen } from './AdminScreen';
import { adminApi, AdminApiError, type AdminOverview } from './adminApi';

let subject: string | null = 'admin-subject';
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ subject }) }));
vi.mock('./adminApi', async (original) => ({
  ...await original<typeof import('./adminApi')>(),
  adminApi: { access: vi.fn(), overview: vi.fn(), list: vi.fn() }
}));

const overview: AdminOverview = {
  observedAt: '2026-09-07T10:00:00Z', accounts: 123, recentAccounts: 42, activePlans: 50,
  calendarConnections: 24, syncFailures: 2, queuedJobs: 3, runningJobs: 1, deadJobs: 1,
  retryingJobs: 2, failedNotifications: 0, recentAuditEvents: 12
};
const empty = { items: [], page: 0, size: 20, hasNext: false, limited: false };
const renderAdmin = () => render(<MemoryRouter><AdminScreen /></MemoryRouter>);

beforeEach(() => {
  subject = 'admin-subject';
  vi.resetAllMocks();
  vi.mocked(adminApi.access).mockResolvedValue({ allowed: true });
  vi.mocked(adminApi.overview).mockResolvedValue(overview);
  vi.mocked(adminApi.list).mockResolvedValue(empty);
});

describe('AdminScreen', () => {
  it('waits for server authorization before requesting any operational data', async () => {
    let resolve!: (value: { allowed: boolean }) => void;
    vi.mocked(adminApi.access).mockReturnValue(new Promise((done) => { resolve = done; }));
    renderAdmin();
    expect(screen.getByRole('status')).toHaveTextContent('관리자 접근 권한');
    expect(adminApi.overview).not.toHaveBeenCalled();
    expect(adminApi.list).not.toHaveBeenCalled();
    await act(async () => resolve({ allowed: true }));
    expect(await screen.findByRole('heading', { name: '운영 현황' })).toBeInTheDocument();
    expect(await screen.findByText('123')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Grafana/ })).toHaveAttribute('href', '/ops/grafana/');
    expect(await screen.findByText('등록된 계정이 없습니다.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '이전' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();
  });

  it.each([401, 403])('shows forbidden for %s without requesting account data', async (status) => {
    vi.mocked(adminApi.access).mockRejectedValue(new AdminApiError(status));
    renderAdmin();
    expect(await screen.findByRole('heading', { name: '관리자 권한이 필요합니다' })).toBeInTheDocument();
    expect(adminApi.overview).not.toHaveBeenCalled();
    expect(adminApi.list).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: '오늘로 돌아가기' })).toHaveAttribute('href', '/today');
  });

  it.each([false, 'true'])('does not request operational data when discovery returns allowed=%s', async (allowed) => {
    vi.mocked(adminApi.access).mockResolvedValue({ allowed } as unknown as { allowed: boolean });
    renderAdmin();
    expect(await screen.findByRole('heading', { name: '관리자 권한이 필요합니다' })).toBeInTheDocument();
    expect(adminApi.list).not.toHaveBeenCalled();
  });

  it('retries failed access checks through a keyboard accessible button', async () => {
    vi.mocked(adminApi.access).mockRejectedValueOnce(new TypeError('offline'));
    renderAdmin();
    expect(await screen.findByRole('alert')).toHaveTextContent('접근 권한을 확인하지 못했습니다');
    const user = userEvent.setup();
    screen.getByRole('button', { name: '다시 시도' }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: '운영 현황' })).toBeInTheDocument();
  });

  it('paginates using the returned boundary and resets pages when switching categories', async () => {
    vi.mocked(adminApi.list).mockImplementation(async (kind, page) => ({
      ...empty, page, hasNext: kind === 'users' && page === 0,
      items: kind === 'users' ? [{ userId: `id-${page}`, maskedEmail: `${page}•••@example.com`,
        createdAt: overview.observedAt, lastSeenAt: overview.observedAt, deletionRequested: false,
        planCode: 'BETA', entitlementStatus: 'ACTIVE', syncStatus: null }] : []
    }));
    renderAdmin();
    const user = userEvent.setup();
    expect(await screen.findByText('0•••@example.com')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('1•••@example.com')).toBeInTheDocument();
    expect(screen.getByText('2페이지')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '캘린더 연결 문제' }));
    expect(await screen.findByText('현재 캘린더 연결 문제가 없습니다.')).toBeInTheDocument();
    expect(adminApi.list).toHaveBeenLastCalledWith('sync-failures', 0, expect.any(AbortSignal));
    expect(screen.getByText('1페이지')).toBeInTheDocument();
  });

  it('keeps overview available on list errors and retries the list', async () => {
    vi.mocked(adminApi.list).mockRejectedValueOnce(new AdminApiError(503));
    renderAdmin();
    expect(await screen.findByRole('alert')).toHaveTextContent('운영 정보를 불러오지 못했습니다');
    expect(screen.getByText('123')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '목록 다시 시도' }));
    expect(await screen.findByText('등록된 계정이 없습니다.')).toBeInTheDocument();
  });

  it('hides all operational data if an endpoint denies access after discovery', async () => {
    vi.mocked(adminApi.list).mockRejectedValueOnce(new AdminApiError(403));
    renderAdmin();
    expect(await screen.findByRole('heading', { name: '관리자 권한이 필요합니다' })).toBeInTheDocument();
    expect(screen.queryByText('123')).not.toBeInTheDocument();
  });

  it('discards a slow previous account response after identity changes', async () => {
    let resolve!: (value: { allowed: boolean }) => void;
    vi.mocked(adminApi.access).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const view = renderAdmin();
    subject = 'ordinary-subject';
    vi.mocked(adminApi.access).mockResolvedValue({ allowed: false });
    view.rerender(<MemoryRouter><AdminScreen /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: '관리자 권한이 필요합니다' })).toBeInTheDocument();
    await act(async () => resolve({ allowed: true }));
    await waitFor(() => expect(adminApi.list).not.toHaveBeenCalled());
  });
});
