import type { Subtask } from './types';

export const MAX_SUBTASKS = 100;
export const validSubtasks = (items: readonly Subtask[]) => items.length <= MAX_SUBTASKS
  && new Set(items.map(item => item.id)).size === items.length
  && items.every(item => typeof item.id === 'string' && item.id.trim().length > 0 && item.id.length <= 160
    && typeof item.title === 'string' && item.title.trim().length > 0 && item.title.length <= 500 && typeof item.done === 'boolean');
export const cleanSubtasks = (items: readonly Subtask[]) => items.map(item => ({ id: item.id, title: item.title.trim(), done: item.done }));
