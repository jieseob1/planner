import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { periodApi } from '../api/periodApi';
import { documentId, type PeriodDocument, type PeriodWrite } from '../domain/periods';
import type { PlannerSnapshot } from '../domain/types';

interface PeriodContextValue {
  documents: PeriodDocument[]; history: PlannerSnapshot[]; ready: boolean; error: string;
  subject: string; reload: () => Promise<void>; save: (write: PeriodWrite) => Promise<PeriodDocument>;
}
const PeriodContext = createContext<PeriodContextValue | null>(null);
export function PeriodProvider({ children }: PropsWithChildren) {
  const { subject } = useAuth();
  return <ScopedPeriods key={subject ?? 'unavailable'} subject={subject ?? 'unavailable'}>{children}</ScopedPeriods>;
}
function ScopedPeriods({ subject, children }: PropsWithChildren<{ subject: string }>) {
  const [documents, setDocuments] = useState<PeriodDocument[]>([]);
  const [history, setHistory] = useState<PlannerSnapshot[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const controller = useRef(new AbortController());
  const reload = useCallback(async () => {
    const requestEpoch = ++epoch.current;
    try {
      if (controller.current.signal.aborted) controller.current = new AbortController();
      const [next, archives] = await Promise.all([periodApi.list(controller.current.signal), periodApi.history(controller.current.signal)]);
      if (!Array.isArray(next) || !Array.isArray(archives)) throw new Error('Invalid period response');
      if (epoch.current !== requestEpoch) return;
      setDocuments(next); setHistory(archives); setReady(true); setError('');
    } catch {
      if (epoch.current === requestEpoch) setError('목표·회고를 불러오지 못했습니다. 기존 할 일과 입력 내용은 유지됩니다.');
    }
  }, []);
  useEffect(() => { void reload(); return () => { epoch.current++; controller.current.abort(); }; }, [reload]);
  const save = async (write: PeriodWrite) => {
    const requestEpoch = epoch.current;
    const result = await periodApi.save(write, controller.current.signal);
    if (epoch.current !== requestEpoch) throw new Error('화면 또는 계정이 변경되었습니다. 저장 결과를 다시 확인해 주세요.');
    setDocuments(current => [...current.filter(d => documentId(d) !== documentId(result)), result]);
    return result;
  };
  return <PeriodContext.Provider value={{ documents, history, ready, error, subject, reload, save }}>{children}</PeriodContext.Provider>;
}
export function usePeriods() { return useContext(PeriodContext); }
