import { describe, expect, it } from 'vitest';
import { createEmptySnapshot } from '../data/empty';
import type { PlannerSnapshot, Task } from '../domain/types';
import { mergeSnapshots } from './mergeSnapshots';

const task = (id: string): Task => ({ id, title: id, outcomeId: null, estimateMinutes: 30, status: 'todo', pinned: false, carryCount: 0 });
const fixture = () => ({ ...createEmptySnapshot('UTC'), tasks: [task('a'), task('b')] });
const copies = () => { const base = fixture(); return { base, local: structuredClone(base), server: structuredClone(base) }; };
describe('three-way sync', () => {
  it('preserves edits to different tasks and different fields of the same task', () => {
    const { base, local, server } = copies();
    local.tasks[0].title = 'local title'; server.tasks[0].note = 'remote note'; server.tasks[1].status = 'done';
    const result = mergeSnapshots(base, local, server);
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot.tasks[0]).toMatchObject({ title: 'local title', note: 'remote note' });
    expect(result.snapshot.tasks[1].status).toBe('done');
  });
  it('merges concurrent creates and a delete against an unchanged entity', () => {
    const { base, local, server } = copies();
    local.tasks = [task('c'), local.tasks[0]]; server.tasks.push(task('d'));
    const result = mergeSnapshots(base, local, server);
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot.tasks.map(task => task.id).sort()).toEqual(['a', 'c', 'd']);
  });
  it('requires a field-level choice for the same title without dropping unrelated edits', () => {
    const { base, local, server } = copies();
    local.tasks[0].title = 'left'; server.tasks[0].title = 'right'; local.tasks[1].note = 'keep me';
    expect(mergeSnapshots(base, local, server).conflicts.map(item => item.path)).toEqual(['tasks.a.title']);
    const resolved = mergeSnapshots(base, local, server, { 'tasks.a.title': 'server' });
    expect(resolved.conflicts).toEqual([]);
    expect(resolved.snapshot.tasks[0].title).toBe('right'); expect(resolved.snapshot.tasks[1].note).toBe('keep me');
  });
  it('never silently resurrects a deleted task when the other client edits it', () => {
    const { base, local, server } = copies();
    local.tasks[0].note = 'unsaved'; server.tasks.shift();
    const result = mergeSnapshots(base, local, server);
    expect(result.conflicts.map(item => item.path)).toEqual(['tasks.a']);
    expect(result.snapshot.tasks.map(task => task.id)).toEqual(['b']);
    expect(mergeSnapshots(base, local, server, { 'tasks.a': 'server' }).conflicts).toEqual([]);
  });
  it('detects deleting a task while another client adds a linked record', () => {
    const { base, local, server } = copies();
    server.tasks.shift(); local.timeEntries.push({ id: 'entry', taskId: 'a', durationSeconds: 60, source: 'manual', observedAt: new Date().toISOString() });
    expect(mergeSnapshots(base, local, server).conflicts.map(item => item.path)).toContain('references');
  });
  it('merges independent subtask checkoffs', () => {
    const { base, local, server } = copies();
    for (const snapshot of [base, local, server]) snapshot.tasks[0].subtasks = [{ id: 's1', title: 'one', done: false }, { id: 's2', title: 'two', done: false }];
    local.tasks[0].subtasks![0].done = true; server.tasks[0].subtasks![1].done = true;
    const result = mergeSnapshots(base, local, server);
    expect(result.conflicts).toEqual([]); expect(result.snapshot.tasks[0].subtasks?.every(item => item.done)).toBe(true);
  });
  it('preserves a subtask reorder alongside a remote checkoff', () => {
    const { base, local, server } = copies();
    for (const snapshot of [base, local, server]) snapshot.tasks[0].subtasks = [{ id: 's1', title: 'one', done: false }, { id: 's2', title: 'two', done: false }];
    local.tasks[0].subtasks!.reverse(); server.tasks[0].subtasks![0].done = true;
    const result = mergeSnapshots(base, local, server);
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot.tasks[0].subtasks?.map(item => item.id)).toEqual(['s2', 's1']);
    expect(result.snapshot.tasks[0].subtasks?.find(item => item.id === 's1')?.done).toBe(true);
  });
  it('resolves a linked title once and keeps the list and calendar consistent', () => {
    const { base, local, server } = copies();
    for (const snapshot of [base, local, server]) snapshot.timeBlocks = [{ id: 'block', taskId: 'a', title: 'a', date: '2026-10-04', day: 'sun', startMinutes: 600, durationMinutes: 120 }];
    local.tasks[0].title = local.timeBlocks[0].title = 'local';
    server.tasks[0].title = server.timeBlocks[0].title = 'remote'; local.tasks[0].note = 'keep';
    expect(mergeSnapshots(base, local, server).conflicts.map(item => item.path)).toEqual(['tasks.a.title']);
    const resolved = mergeSnapshots(base, local, server, { 'tasks.a.title': 'server' });
    expect(resolved.snapshot.timeBlocks[0].title).toBe('remote'); expect(resolved.snapshot.tasks[0].note).toBe('keep');
  });
  it('does not field-merge timer sessions or separate edits to a time range', () => {
    const { base, local, server } = copies();
    local.timer = { taskId: 'a', startedAt: 1, accumulatedSeconds: 0, paused: false };
    server.timer = { taskId: 'b', startedAt: 2, accumulatedSeconds: 0, paused: false };
    expect(mergeSnapshots(base, local, server).conflicts.map(item => item.path)).toContain('timer');
    for (const snapshot of [base, local, server]) snapshot.timeBlocks = [{ id: 'block', taskId: 'a', title: 'a', date: '2026-10-04', day: 'sun', startMinutes: 600, durationMinutes: 30 }];
    local.timeBlocks[0].startMinutes = 720; server.timeBlocks[0].durationMinutes = 120;
    expect(mergeSnapshots(base, local, server).conflicts.map(item => item.path)).toContain('timeBlocks.block.slot');
  });
  it('detects overlap introduced by two independent schedule additions', () => {
    const { base, local, server } = copies();
    const block: PlannerSnapshot['timeBlocks'][number] = { id: 'l', taskId: 'a', title: 'a', date: '2026-10-04', day: 'sun', startMinutes: 600, durationMinutes: 30 };
    local.timeBlocks.push(block); server.timeBlocks.push({ ...block, id: 'r', taskId: 'b' });
    expect(mergeSnapshots(base, local, server).conflicts.map(item => item.path)).toContain('timeBlocks.overlap');
  });
});
