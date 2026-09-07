import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { plannerApi, PlannerApiError } from '../api/plannerApi';
import { createEmptySnapshot } from '../data/empty';
import { getPlannerStorageKeys, PlannerProvider, usePlanner } from './PlannerProvider';

const SUBJECT = 'test:validation-save-provider';
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ subject: SUBJECT }) }));
vi.mock('../timezone/TimeZoneProvider', () => ({ useTimeZone: () => ({ timeZone: 'UTC' }) }));
const rejection = () => new PlannerApiError(400, 'unused PRIVATE raw text', {
  code: 'validation-failed', detail: '요청 값이 유효성 규칙을 충족하지 않습니다.',
  errors: [{ field: 'plan.annualDirection', message: 'must not be blank', rejectedValue: 'PRIVATE' }]
});
const wrapper = ({ children }: PropsWithChildren) => <PlannerProvider>{children}</PlannerProvider>;

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => vi.restoreAllMocks());

const mountSavedPlanner = async () => {
  const snapshot = createEmptySnapshot('UTC');
  snapshot.plan.annualDirection = 'initial direction';
  snapshot.plan.quarterFocus = 'initial focus';
  vi.spyOn(plannerApi, 'get').mockResolvedValue({ kind: 'found', aggregate: { revision: 7, snapshot }, etag: '"user-7"' });
  vi.spyOn(plannerApi, 'delete').mockResolvedValue();
  const view = renderHook(() => usePlanner(), { wrapper });
  await waitFor(() => expect(view.result.current.saveStatus).toBe('saved'));
  return view;
};

describe('PlannerProvider rejected-save recovery', () => {
  it('keeps local edits and acknowledged revision through400, then retries them without reset or reload', async () => {
    const put = vi.spyOn(plannerApi, 'put').mockRejectedValueOnce(rejection())
      .mockImplementation(async (snapshot) => ({ aggregate: { revision: 8, snapshot }, etag: '"user-8"' }));
    const { result } = await mountSavedPlanner();
    act(() => result.current.quickCapture('Keep this local task'));
    act(() => result.current.retrySync());
    await waitFor(() => expect(result.current.saveStatus).toBe('validation-error'));
    expect(result.current.saveProblem).toMatchObject({ status: 400, errors: [{ field: 'plan.annualDirection', message: '비워 둘 수 없습니다.' }] });
    expect(result.current.tasks[0].title).toBe('Keep this local task');
    const keys = getPlannerStorageKeys(SUBJECT);
    expect(JSON.parse(window.localStorage.getItem(keys.snapshot)!).tasks[0].title).toBe('Keep this local task');
    expect(JSON.parse(window.localStorage.getItem(keys.syncMetadata)!).revision).toBe(7);
    expect(plannerApi.get).toHaveBeenCalledTimes(1);
    expect(plannerApi.delete).not.toHaveBeenCalled();
    expect(JSON.stringify(result.current.saveProblem)).not.toContain('PRIVATE');

    act(() => result.current.retrySync());
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(result.current.saveProblem).toBeNull();
    expect(put.mock.calls[1][0].tasks[0].title).toBe('Keep this local task');
    expect(put.mock.calls[1][1]).toBe(7);
    expect(put.mock.calls[1][2]).toBe(put.mock.calls[0][2]);
    expect(put.mock.calls[1][3]).toBe('"user-7"');
    expect(JSON.parse(window.localStorage.getItem(keys.syncMetadata)!).revision).toBe(8);
  });

  it('clears the rejected-input guidance when the user edits the local snapshot', async () => {
    vi.spyOn(plannerApi, 'put').mockRejectedValue(rejection());
    const { result } = await mountSavedPlanner();
    act(() => result.current.quickCapture('first'));
    act(() => result.current.retrySync());
    await waitFor(() => expect(result.current.saveStatus).toBe('validation-error'));
    act(() => result.current.quickCapture('second'));
    expect(result.current.saveStatus).toBe('saving');
    expect(result.current.saveProblem).toBeNull();
    expect(result.current.tasks.map((task) => task.title)).toContain('first');
    expect(result.current.tasks.map((task) => task.title)).toContain('second');
  });

  it('keeps network failures in retry with local data preserved', async () => {
    vi.spyOn(plannerApi, 'put').mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = await mountSavedPlanner();
    act(() => result.current.quickCapture('offline recovery'));
    act(() => result.current.retrySync());
    await waitFor(() => expect(result.current.saveStatus).toBe('retry'));
    expect(result.current.saveProblem).toBeNull();
    expect(result.current.tasks[0].title).toBe('offline recovery');
  });
});
