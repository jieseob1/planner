import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { accountApi } from '../api/accountApi';
import { useAuth } from '../auth/AuthProvider';
import { getDeviceTimeZone, isValidTimeZone } from '../lib/calendarDate';

export type TimeZoneSource = 'account' | 'device';

export interface TimeZoneContextValue {
  timeZone: string;
  source: TimeZoneSource;
  loading: boolean;
  error: string | null;
  refreshTimeZone: () => Promise<void>;
  setAccountTimeZone: (timeZone: string) => void;
}

const TimeZoneContext = createContext<TimeZoneContextValue | null>(null);

const preferenceError = (reason: unknown) => (
  reason instanceof Error ? reason.message : '계정 시간대를 불러오지 못했습니다.'
);

export function TimeZoneProvider({ children }: PropsWithChildren) {
  const { status, subject } = useAuth();
  const [deviceTimeZone] = useState(getDeviceTimeZone);
  const [timeZone, setTimeZone] = useState(deviceTimeZone);
  const [source, setSource] = useState<TimeZoneSource>('device');
  const [loadedSubject, setLoadedSubject] = useState<string | null>(null);
  const [resolvedSubject, setResolvedSubject] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const useDeviceFallback = useCallback((message: string | null = null, subjectForFallback: string | null = null) => {
    setTimeZone(deviceTimeZone);
    setSource('device');
    setLoadedSubject(null);
    setResolvedSubject(subjectForFallback);
    setError(message);
  }, [deviceTimeZone]);

  const setAccountTimeZone = useCallback((nextTimeZone: string) => {
    requestSequence.current += 1;
    setLoading(false);
    if (!subject || !isValidTimeZone(nextTimeZone)) {
      useDeviceFallback('계정에 저장된 시간대가 올바르지 않아 기기 시간대를 사용합니다.', subject);
      return;
    }
    setTimeZone(nextTimeZone);
    setSource('account');
    setLoadedSubject(subject);
    setResolvedSubject(subject);
    setError(null);
  }, [subject, useDeviceFallback]);

  const refreshTimeZone = useCallback(async () => {
    const sequence = ++requestSequence.current;
    if (status !== 'authenticated' || !subject) {
      setLoading(false);
      useDeviceFallback();
      return;
    }

    // Keep an already-resolved account mounted during an explicit refresh.
    // A first load or an account switch still clears the previous subject and
    // remains behind the route-level loading gate below.
    setLoadedSubject((current) => current === subject ? current : null);
    setResolvedSubject((current) => current === subject ? current : null);
    setLoading(true);
    setError(null);
    try {
      const preferences = await accountApi.preferences();
      if (sequence !== requestSequence.current) return;
      if (!isValidTimeZone(preferences.timezone)) {
        useDeviceFallback('계정에 저장된 시간대가 올바르지 않아 기기 시간대를 사용합니다.', subject);
        return;
      }
      setTimeZone(preferences.timezone);
      setSource('account');
      setLoadedSubject(subject);
      setResolvedSubject(subject);
      setError(null);
    } catch (reason) {
      if (sequence !== requestSequence.current) return;
      useDeviceFallback(`${preferenceError(reason)} 기기 시간대를 임시로 사용합니다.`, subject);
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [status, subject, useDeviceFallback]);

  useEffect(() => {
    void refreshTimeZone();
    return () => {
      requestSequence.current += 1;
    };
  }, [refreshTimeZone]);

  const accountZoneBelongsToCurrentSubject = status === 'authenticated'
    && Boolean(subject)
    && source === 'account'
    && loadedSubject === subject;
  const subjectChangedBeforeEffect = status === 'authenticated'
    && Boolean(subject)
    && resolvedSubject !== subject;

  const value = useMemo<TimeZoneContextValue>(() => ({
    timeZone: accountZoneBelongsToCurrentSubject ? timeZone : deviceTimeZone,
    source: accountZoneBelongsToCurrentSubject ? 'account' : 'device',
    loading: loading || subjectChangedBeforeEffect,
    error: resolvedSubject === subject ? error : null,
    refreshTimeZone,
    setAccountTimeZone
  }), [
    accountZoneBelongsToCurrentSubject,
    deviceTimeZone,
    error,
    loadedSubject,
    loading,
    refreshTimeZone,
    resolvedSubject,
    setAccountTimeZone,
    subject,
    subjectChangedBeforeEffect,
    timeZone
  ]);

  const resolvingAuthenticatedSubject = status === 'authenticated'
    && Boolean(subject)
    && subjectChangedBeforeEffect;

  return (
    <TimeZoneContext.Provider value={value}>
      {resolvingAuthenticatedSubject
        ? <main className="route-loading" role="status">계정 시간대를 불러오고 있습니다…</main>
        : children}
    </TimeZoneContext.Provider>
  );
}

/** Isolated component tests keep device-zone behavior when no app provider is mounted. */
export const useTimeZone = (): TimeZoneContextValue => {
  const context = useContext(TimeZoneContext);
  if (context) return context;
  const timeZone = getDeviceTimeZone();
  return {
    timeZone,
    source: 'device',
    loading: false,
    error: null,
    refreshTimeZone: async () => undefined,
    setAccountTimeZone: () => undefined
  };
};
