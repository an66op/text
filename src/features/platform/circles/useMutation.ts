import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiErrorMessage, isAbort } from '@/shared/api/client';
export function useMutation(onDenied?: (message: string) => void) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const active = useRef(true),
    request = useRef<AbortController | null>(null);
  const denied = useRef(onDenied);
  denied.current = onDenied;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);
  const run = useCallback(
    async <T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
      if (!active.current || request.current) return;
      const controller = new AbortController();
      request.current = controller;
      setBusy(true);
      setError('');
      try {
        const result = await operation(controller.signal);
        if (active.current && !controller.signal.aborted) return result;
      } catch (caught) {
        if (active.current && !controller.signal.aborted && !isAbort(caught)) {
          const message = apiErrorMessage(caught);
          setError(message);
          if (caught instanceof ApiError && [403, 404].includes(caught.status))
            denied.current?.(message);
        }
      } finally {
        if (request.current === controller) request.current = null;
        if (active.current) setBusy(false);
      }
    },
    [],
  );
  return { run, busy, error, clearError: () => setError('') };
}
