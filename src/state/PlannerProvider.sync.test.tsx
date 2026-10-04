import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { plannerApi, PlannerConflictError } from '../api/plannerApi';
import { createEmptySnapshot } from '../data/empty';
import type { PlannerSnapshot, Task } from '../domain/types';
import { PlannerProvider, usePlanner } from './PlannerProvider';
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ subject: 'test:two-devices' }) }));
vi.mock('../timezone/TimeZoneProvider', () => ({ useTimeZone: () => ({ timeZone: 'UTC' }) }));
const wrapper = ({ children }: PropsWithChildren) => <PlannerProvider>{children}</PlannerProvider>;
const task = (id: string): Task => ({ id, title: id, outcomeId: null, estimateMinutes: 30, status: 'todo', pinned: false, carryCount: 0 });
beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function serverFixture() {
  let snapshot: PlannerSnapshot = { ...createEmptySnapshot('UTC'), tasks: [task('a'), task('b')] };
  let revision = 1;
  const etag = () => `"rev-${revision}"`;
  const get = vi.spyOn(plannerApi, 'get').mockImplementation(async cached => cached === etag()
    ? { kind: 'not-modified', etag: etag() } : { kind: 'found', aggregate: { revision, snapshot: structuredClone(snapshot) }, etag: etag() });
  const put = vi.spyOn(plannerApi, 'put').mockImplementation(async (submitted, expected) => {
    if (expected !== revision) throw new PlannerConflictError(412, null);
    snapshot = structuredClone(submitted); revision++;
    return { aggregate: { revision, snapshot: structuredClone(snapshot) }, etag: etag() };
  });
  return { get, put, read: () => snapshot, change: (next: PlannerSnapshot) => { snapshot = next; revision++; } };
}
async function twoDevices() {
  const left = renderHook(usePlanner, { wrapper });
  await waitFor(() => expect(left.result.current.saveStatus).toBe('saved'));
  const right = renderHook(usePlanner, { wrapper });
  await waitFor(() => expect(right.result.current.saveStatus).toBe('saved'));
  return { left, right };
}
describe('independent planner sessions', () => {
  it('retries a failed server conflict read without trapping the local draft', async () => {
    const server = serverFixture(); const view = renderHook(usePlanner, { wrapper });
    await waitFor(() => expect(view.result.current.saveStatus).toBe('saved'));
    const remote = structuredClone(server.read()); remote.tasks[1].note = 'remote'; server.change(remote);
    server.get.mockRejectedValueOnce(new TypeError('temporary offline read'));
    act(() => { view.result.current.updateTask('a', { title: 'preserved draft' }); view.result.current.retrySync(); });
    await waitFor(() => expect(view.result.current.saveStatus).toBe('retry'));
    expect(view.result.current.syncConflict).toBeNull();
    expect(view.result.current.tasks[0].title).toBe('preserved draft');
    act(() => view.result.current.retrySync());
    await waitFor(() => expect(view.result.current.saveStatus).toBe('saved'));
    expect(server.read().tasks[0].title).toBe('preserved draft'); expect(server.read().tasks[1].note).toBe('remote');
  });
  it('refreshes an already open second device without a reload', async () => {
    serverFixture(); const { left, right } = await twoDevices();
    act(() => { left.result.current.updateTask('a', { title: 'live edit' }); left.result.current.retrySync(); });
    await waitFor(() => expect(right.result.current.tasks[0].title).toBe('live edit'), { timeout: 2_000 });
    expect(right.result.current.saveStatus).toBe('saved');
  });
  it('rebases concurrent disjoint edits and acknowledges both without manual conflict', async () => {
    const server = serverFixture(); const { left, right } = await twoDevices();
    act(() => {
      left.result.current.updateTask('a', { title: 'left' }); right.result.current.updateTask('b', { note: 'right' });
      left.result.current.retrySync(); right.result.current.retrySync();
    });
    await waitFor(() => expect(server.read().tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'a', title: 'left' }), expect.objectContaining({ id: 'b', note: 'right' })
    ])), { timeout: 2_000 });
    await waitFor(() => expect(left.result.current.tasks[1].note).toBe('right'), { timeout: 2_000 });
    expect(right.result.current.syncConflict).toBeNull(); expect(server.put).toHaveBeenCalledTimes(3);
  });
  it('preserves same-field conflict drafts and resolves only that field', async () => {
    const server = serverFixture(); const { left, right } = await twoDevices();
    act(() => {
      left.result.current.updateTask('a', { title: 'left' }); right.result.current.updateTask('a', { title: 'right' });
      right.result.current.updateTask('b', { note: 'must survive' });
      left.result.current.retrySync(); right.result.current.retrySync();
    });
    await waitFor(() => expect(right.result.current.saveStatus).toBe('conflict'));
    expect(right.result.current.tasks[0].title).toBe('right');
    act(() => right.result.current.resolveConflict('merge', { 'tasks.a.title': 'server' }));
    await waitFor(() => expect(server.read().tasks[1].note).toBe('must survive'));
    expect(server.read().tasks[0].title).toBe('left');
  });
  it('keeps offline edits, merges remote edits after reconnect, and refreshes on focus', async () => {
    const server = serverFixture(); const view = renderHook(usePlanner, { wrapper });
    await waitFor(() => expect(view.result.current.saveStatus).toBe('saved'));
    act(() => window.dispatchEvent(new Event('offline')));
    act(() => view.result.current.updateTask('a', { note: 'offline draft' }));
    const remote = structuredClone(server.read()); remote.tasks[1].title = 'remote edit'; server.change(remote);
    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(view.result.current.saveStatus).toBe('saved'), { timeout: 2_000 });
    expect(server.read().tasks[0].note).toBe('offline draft'); expect(view.result.current.tasks[1].title).toBe('remote edit');
    const fresh = structuredClone(server.read()); fresh.tasks[1].status = 'done'; server.change(fresh);
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(view.result.current.tasks[1].status).toBe('done'));
  });
  it('does not resurrect a delete racing an edit', async () => {
    const server = serverFixture(); const { left, right } = await twoDevices();
    act(() => { left.result.current.removeTask('a'); right.result.current.updateTask('a', { note: 'draft' }); left.result.current.retrySync(); right.result.current.retrySync(); });
    await waitFor(() => expect(right.result.current.saveStatus).toBe('conflict'));
    expect(server.read().tasks.some(task => task.id === 'a')).toBe(false);
    act(() => right.result.current.resolveConflict('merge', { 'tasks.a': 'server' }));
    expect(right.result.current.tasks.some(task => task.id === 'a')).toBe(false);
  });
  it('does not recreate a remotely closed aggregate from an acknowledged cache', async () => {
    serverFixture(); const view = renderHook(usePlanner, { wrapper });
    await waitFor(() => expect(view.result.current.saveStatus).toBe('saved'));
    vi.mocked(plannerApi.get).mockResolvedValue({ kind: 'missing' });
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(view.result.current.hasActivePlan).toBe(false));
    expect(plannerApi.put).not.toHaveBeenCalled();
  });
  it('keeps an unsaved draft for explicit recovery after a remote aggregate deletion', async () => {
    serverFixture(); const view = renderHook(usePlanner, { wrapper });
    await waitFor(() => expect(view.result.current.saveStatus).toBe('saved'));
    act(() => window.dispatchEvent(new Event('offline')));
    act(() => view.result.current.updateTask('a', { note: 'offline draft' }));
    vi.mocked(plannerApi.get).mockResolvedValue({ kind: 'missing' });
    vi.mocked(plannerApi.put).mockRejectedValue(new PlannerConflictError(412, null));
    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(view.result.current.syncConflict?.serverMissing).toBe(true));
    expect(view.result.current.tasks[0].note).toBe('offline draft');
    act(() => view.result.current.resolveConflict('server'));
    expect(view.result.current.hasActivePlan).toBe(false);
  });
  it('moves all selected-date blocks atomically and leaves other-date blocks and actual entries alone', async () => {
    const server = serverFixture(); const base = structuredClone(server.read());
    base.timeBlocks = [{ id: 'one', taskId: 'a', title: 'a', date: '2026-10-04', day: 'sun', startMinutes: 1080, durationMinutes: 120 },
      { id: 'two', taskId: 'a', title: 'a', date: '2026-10-04', day: 'sun', startMinutes: 1260, durationMinutes: 30 },
      { id: 'other', taskId: 'a', title: 'a', date: '2026-10-06', day: 'tue', startMinutes: 600, durationMinutes: 30 }];
    base.timeEntries = [{ id: 'actual', taskId: 'a', observedAt: new Date().toISOString(), durationSeconds: 60, source: 'manual' }];
    server.change(base);
    const view = renderHook(usePlanner, { wrapper });
    await waitFor(() => expect(view.result.current.saveStatus).toBe('saved'));
    act(() => expect(view.result.current.rescheduleTask('a', '2026-10-04', '2026-10-05')).toBe(true));
    expect(view.result.current.timeBlocks.filter(block => block.date === '2026-10-05')).toHaveLength(2);
    expect(view.result.current.timeBlocks.find(block => block.id === 'other')?.date).toBe('2026-10-06');
    expect(view.result.current.timeEntries).toEqual(base.timeEntries);
    act(() => expect(view.result.current.rescheduleTask('a', '2026-10-05', null)).toBe(true));
    expect(view.result.current.tasks[0].plannedDate).toBe('later'); expect(view.result.current.timeBlocks).toHaveLength(1);
  });
});
