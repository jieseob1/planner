import { useEffect, useRef, useState } from 'react';
import { createIdempotencyKey } from '../api/plannerApi';
import type { PeriodGoal, PeriodReview, PeriodWrite } from '../domain/periods';
import { usePeriods } from './PeriodProvider';
import { periodDraftStoragePrefix } from './periodDraftStorage';

type Value = PeriodGoal | PeriodReview;
interface Draft<T> { value: T; revision: number; mutationId: string; deleted?: boolean }
/** Remount the editor for a different document. Draft identity and revision travel together. */
export function usePeriodDraft<T extends Value>(key: string, initial: T, revision: number) {
  const periods = usePeriods();
  const storageKey = `${periodDraftStoragePrefix(periods?.subject ?? 'unavailable')}${key}`;
  const [draft, setDraft] = useState<Draft<T>>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Draft<T> | null;
      if (value?.value?.id && Number.isSafeInteger(value.revision) && typeof value.mutationId === 'string') return value;
    } catch { /* Corrupt drafts are left in storage; they are never uploaded automatically. */ }
    return { value: initial, revision, mutationId: createIdempotencyKey() };
  });
  const [dirty, setDirty] = useState(() => { try { return localStorage.getItem(storageKey) !== null; } catch { return false; } });
  const [stored, setStored] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    try { localStorage.setItem(storageKey, JSON.stringify(draft)); setStored(true); }
    catch { setStored(false); }
  }, [draft, dirty, storageKey]);
  const edit = (value: T) => { setDraft(d => ({ ...d, value, deleted: false, mutationId: createIdempotencyKey() })); setDirty(true); setMessage(''); };
  const save = async (deleted = false) => {
    if (!periods?.ready || inFlight.current) return false;
    inFlight.current = true; setBusy(true); setMessage('');
    const mutationId = Boolean(draft.deleted) === deleted ? draft.mutationId : createIdempotencyKey();
    setDraft(d => ({ ...d, deleted, mutationId })); setDirty(true);
    const write: PeriodWrite = { expectedRevision: draft.revision, mutationId,
      goal: 'measurement' in draft.value ? draft.value : null, review: 'well' in draft.value ? draft.value : null, deleted };
    try {
      const result = await periods.save(write);
      setDraft(d => ({ ...d, revision: result.revision, mutationId: createIdempotencyKey() }));
      setDirty(false); setConflict(false);
      try { localStorage.removeItem(storageKey); } catch { /* The explicit saved state is still visible. */ }
      setMessage(deleted ? '삭제했습니다. 연결된 할 일과 일정은 유지됩니다.' : '서버에 저장했습니다.');
      return true;
    } catch (error) {
      setDirty(true);
      setMessage(error instanceof Error ? error.message : '저장하지 못했습니다. 입력은 유지됩니다.');
      if (error && typeof error === 'object' && 'status' in error && error.status === 412) {
        setConflict(true); await periods.reload();
      }
      return false;
    } finally { inFlight.current = false; setBusy(false); }
  };
  const compare = () => periods?.documents.find(d => (d.goal?.id ?? d.review?.id) === draft.value.id);
  // Revision changes only after the person has compared and explicitly chosen their input.
  const keepDraft = () => {
    const latest = compare(); if (!latest) return;
    setDraft(d => ({ ...d, revision: latest.revision, mutationId: createIdempotencyKey() }));
    setConflict(false); setMessage('내 입력을 선택했습니다. 저장 버튼으로 확정해 주세요.');
  };
  return { value: draft.value, edit, save, busy, message, dirty, stored, conflict, compare, keepDraft, ready: periods?.ready ?? false };
}
