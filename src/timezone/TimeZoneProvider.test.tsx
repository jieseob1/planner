import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDeviceTimeZone } from '../lib/calendarDate';

const mocks = vi.hoisted(() => ({
  auth: {
    status: 'authenticated',
    subject: 'oidc:issuer:user-a'
  } as { status: string; subject: string | null },
  preferences: vi.fn()
}));

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => mocks.auth
}));

vi.mock('../api/accountApi', () => ({
  accountApi: {
    preferences: mocks.preferences
  }
}));

import { TimeZoneProvider, useTimeZone } from './TimeZoneProvider';

function Probe() {
  const { error, loading, refreshTimeZone, setAccountTimeZone, source, timeZone } = useTimeZone();
  return (
    <div>
      <output aria-label="timezone-state">{`${timeZone}|${source}|${loading ? 'loading' : 'ready'}`}</output>
      <output aria-label="timezone-error">{error ?? ''}</output>
      <button type="button" onClick={() => setAccountTimeZone('America/New_York')}>saved timezone</button>
      <button type="button" onClick={() => void refreshTimeZone()}>refresh timezone</button>
    </div>
  );
}

const renderProvider = () => render(
  <TimeZoneProvider>
    <Probe />
  </TimeZoneProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.status = 'authenticated';
  mocks.auth.subject = 'oidc:issuer:user-a';
});

describe('TimeZoneProvider', () => {
  it('loads the authenticated account timezone and applies a saved value immediately', async () => {
    const user = userEvent.setup();
    mocks.preferences.mockResolvedValue({ timezone: 'Asia/Seoul' });
    renderProvider();

    expect(await screen.findByText('Asia/Seoul|account|ready')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'saved timezone' }));
    expect(screen.getByText('America/New_York|account|ready')).toBeInTheDocument();
  });

  it('does not mount authenticated data consumers before the initial timezone resolves', async () => {
    let resolveLoad: ((value: { timezone: string }) => void) | undefined;
    mocks.preferences.mockImplementation(() => new Promise((resolve) => {
      resolveLoad = resolve;
    }));
    renderProvider();

    expect(screen.getByRole('status')).toHaveTextContent('계정 시간대를 불러오고 있습니다');
    expect(screen.queryByRole('button', { name: 'saved timezone' })).not.toBeInTheDocument();

    await act(async () => {
      resolveLoad?.({ timezone: 'Asia/Seoul' });
    });
    expect(await screen.findByText('Asia/Seoul|account|ready')).toBeInTheDocument();
  });

  it('uses the device timezone explicitly when account preferences fail', async () => {
    mocks.preferences.mockRejectedValue(new Error('network unavailable'));
    renderProvider();

    expect(await screen.findByText(`${getDeviceTimeZone()}|device|ready`)).toBeInTheDocument();
    expect(screen.getByLabelText('timezone-error')).toHaveTextContent('network unavailable');
    expect(screen.getByLabelText('timezone-error')).toHaveTextContent('기기 시간대를 임시로 사용합니다');
  });

  it('keeps authenticated content mounted while refreshing the same account', async () => {
    const user = userEvent.setup();
    let resolveRefresh: ((value: { timezone: string }) => void) | undefined;
    mocks.preferences
      .mockResolvedValueOnce({ timezone: 'Asia/Seoul' })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveRefresh = resolve;
      }));
    renderProvider();
    expect(await screen.findByText('Asia/Seoul|account|ready')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'refresh timezone' }));
    expect(screen.getByText('Asia/Seoul|account|loading')).toBeInTheDocument();
    expect(screen.queryByText('계정 시간대를 불러오고 있습니다…')).not.toBeInTheDocument();

    await act(async () => {
      resolveRefresh?.({ timezone: 'America/New_York' });
    });
    expect(await screen.findByText('America/New_York|account|ready')).toBeInTheDocument();
  });

  it('waits through consent and loads preferences after authenticated app entry', async () => {
    mocks.auth.status = 'consent';
    mocks.preferences.mockResolvedValue({ timezone: 'Asia/Seoul' });
    const view = renderProvider();

    expect(screen.getByText(`${getDeviceTimeZone()}|device|ready`)).toBeInTheDocument();
    expect(mocks.preferences).not.toHaveBeenCalled();

    mocks.auth.status = 'authenticated';
    view.rerender(
      <TimeZoneProvider>
        <Probe />
      </TimeZoneProvider>
    );

    expect(await screen.findByText('Asia/Seoul|account|ready')).toBeInTheDocument();
    expect(mocks.preferences).toHaveBeenCalledTimes(1);
  });

  it('never exposes the previous account timezone while a switched account is loading', async () => {
    let resolveSecond: ((value: { timezone: string }) => void) | undefined;
    mocks.preferences
      .mockResolvedValueOnce({ timezone: 'Asia/Seoul' })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecond = resolve;
      }));
    const view = renderProvider();
    expect(await screen.findByText('Asia/Seoul|account|ready')).toBeInTheDocument();

    mocks.auth.subject = 'oidc:issuer:user-b';
    view.rerender(
      <TimeZoneProvider>
        <Probe />
      </TimeZoneProvider>
    );

    expect(screen.queryByText(/Asia\/Seoul\|account/)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('계정 시간대를 불러오고 있습니다');

    await act(async () => {
      resolveSecond?.({ timezone: 'America/New_York' });
    });
    await waitFor(() => {
      expect(screen.getByText('America/New_York|account|ready')).toBeInTheDocument();
    });
  });
});
