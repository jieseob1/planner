import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { adminApi, AdminApiError } from './adminApi';

export type AdminAccessStatus = 'loading' | 'allowed' | 'forbidden' | 'error';

/** UI discovery only. Every data endpoint independently enforces the server-side role guard. */
export function useAdminAccess() {
  const { subject } = useAuth();
  const [state, setState] = useState<{ subject: string | null; status: AdminAccessStatus }>({ subject: null, status: 'loading' });
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ subject, status: 'loading' });
    if (!subject) {
      setState({ subject, status: 'forbidden' });
      return () => controller.abort();
    }
    void adminApi.access(controller.signal).then((result) => {
      if (!controller.signal.aborted) setState({ subject, status: result.allowed === true ? 'allowed' : 'forbidden' });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ subject, status:
        error instanceof AdminApiError && (error.status === 401 || error.status === 403) ? 'forbidden' : 'error' });
    });
    return () => controller.abort();
  }, [subject, version]);

  return { status: state.subject === subject ? state.status : 'loading' as AdminAccessStatus, refresh };
}
