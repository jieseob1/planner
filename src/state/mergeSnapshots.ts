import type { PlannerSnapshot } from '../domain/types';

export interface MergeConflict { path: string; local: unknown; server: unknown }
export interface SnapshotMerge { snapshot: PlannerSnapshot; conflicts: MergeConflict[] }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!record(value)) return value ?? null;
  return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined && value[key] !== null).map(key => [key, canonical(value[key])]));
};
export const sameSyncValue = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** Three-way, ID/field-level merge. Absence is a deletion, never a request to resurrect. */
export function mergeSnapshots(base: PlannerSnapshot, local: PlannerSnapshot, server: PlannerSnapshot, choices: Record<string, 'local' | 'server'> = {}): SnapshotMerge {
  const conflicts: MergeConflict[] = [];
  const choose = (path: string, a: unknown, b: unknown) => {
    if (!choices[path]) conflicts.push({ path, local: a, server: b });
    return choices[path] === 'local' ? a : b;
  };
  const merge = (before: unknown, a: unknown, b: unknown, path: string): unknown => {
    if (choices[path]) return choices[path] === 'local' ? a : b;
    if (sameSyncValue(a, b)) return b;
    if (sameSyncValue(a, before)) return b;
    if (sameSyncValue(b, before)) return a;
    // Missing entity vs changed entity, timer sessions, and time ranges are indivisible.
    if (a === undefined || b === undefined || path === 'timer' || path.endsWith('.slot') || path.endsWith('.completion') || path.endsWith('.metricHistory')) return choose(path, a, b);
    if (Array.isArray(a) && Array.isArray(b) && [...a, ...b].every(item => record(item) && typeof item.id === 'string')) {
      const old = new Map((Array.isArray(before) ? before : []).map(item => [item.id, item]));
      const left = new Map(a.map(item => [item.id, item]));
      const right = new Map(b.map(item => [item.id, item]));
      const common = new Set([...old.keys()].filter(id => left.has(id) && right.has(id)));
      const order = (items: Array<{id: string}>) => items.map(item => item.id).filter(id => common.has(id));
      const beforeOrder = order(Array.isArray(before) ? before : []);
      const localOrder = order(a), serverOrder = order(b);
      let localFirst = !sameSyncValue(localOrder, beforeOrder) && sameSyncValue(serverOrder, beforeOrder);
      if (!sameSyncValue(localOrder, beforeOrder) && !sameSyncValue(serverOrder, beforeOrder) && !sameSyncValue(localOrder, serverOrder)) {
        choose(`${path}.order`, localOrder, serverOrder);
        localFirst = choices[`${path}.order`] === 'local';
      }
      const ids = [...new Set((localFirst ? [...a, ...b] : [...b, ...a]).map(item => item.id))];
      return ids.flatMap(id => {
        const value = merge(old.get(id), left.get(id), right.get(id), `${path}.${id}`);
        return value === undefined ? [] : [value];
      });
    }
    if (record(a) && record(b)) {
      const old = record(before) ? before : {};
      const result: Record<string, unknown> = {};
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      // Compatibility/derived values must not manufacture conflicts.
      if (path.startsWith('outcomes.')) for (const key of ['actualHours', 'lastUpdatedDays', 'attention']) {
        result[key] = b[key]; keys.delete(key);
      }
      const group = (name: string, fields: string[]) => {
        const pick = (obj: Record<string, unknown>) => Object.fromEntries(fields.map(key => [key, obj[key]]));
        Object.assign(result, merge(pick(old), pick(a), pick(b), `${path}.${name}`));
        fields.forEach(key => keys.delete(key));
      };
      if (path.startsWith('timeBlocks.') && keys.has('startMinutes')) {
        group('slot', ['date', 'startMinutes', 'durationMinutes']);
        for (const key of ['day', 'weekOffset']) { result[key] = b[key]; keys.delete(key); }
        if (a.taskId && a.taskId === b.taskId && !a.external && !b.external) {
          result.title = b.title; keys.delete('title'); // Linked task owns its title; one conflict, not two.
        }
      }
      if (path.startsWith('tasks.') && keys.has('status')) group('completion', ['status', 'completedAt']);
      for (const key of keys) {
        const value = merge(old[key], a[key], b[key], path ? `${path}.${key}` : key);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    return choose(path, a, b);
  };
  const snapshot = merge(base, local, server, '') as PlannerSnapshot;
  const tasks = new Map(snapshot.tasks.map(task => [task.id, task]));
  snapshot.timeBlocks = snapshot.timeBlocks.map(block => block.taskId && !block.external && tasks.has(block.taskId)
    ? { ...block, title: tasks.get(block.taskId)!.title } : block);
  const taskIds = new Set(snapshot.tasks.map(task => task.id));
  const outcomeIds = new Set(snapshot.outcomes.map(outcome => outcome.id));
  const invalidReferences = snapshot.tasks.some(task => task.outcomeId && !outcomeIds.has(task.outcomeId))
    || snapshot.timeBlocks.some(block => block.taskId && !taskIds.has(block.taskId))
    || snapshot.timeEntries.some(entry => !taskIds.has(entry.taskId))
    || Boolean(snapshot.timer && !taskIds.has(snapshot.timer.taskId))
    || snapshot.review.selectedTopTaskIds.some(id => !taskIds.has(id));
  if (invalidReferences) conflicts.push({ path: 'references', local, server });
  // Two independently valid schedules can overlap when combined; never silently drop either.
  const blocks = snapshot.timeBlocks.filter(block => !block.external);
  if (blocks.some((a, index) => blocks.slice(index + 1).some(b => a.date === b.date
    && a.startMinutes < b.startMinutes + b.durationMinutes && b.startMinutes < a.startMinutes + a.durationMinutes))) {
    conflicts.push({ path: 'timeBlocks.overlap', local: local.timeBlocks, server: server.timeBlocks });
  }
  return { snapshot, conflicts };
}
