import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiErrorMessage, isAbort } from '@/shared/api/client';
export function useResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  onDenied?: (message: string) => void,
  enabled = true,
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const loader = useRef(load);
  loader.current = load;
  const denied = useRef(onDenied);
  denied.current = onDenied;
  const reload = useRef<() => void>(() => {});
  const apply = useRef<(source: string, value: T) => void>(() => {});
  useEffect(() => {
    let active = true,
      dirty = false,
      generation = 0,
      timer = 0;
    let request: AbortController | null = null;
    setData(null);
    setError('');
    setLoading(enabled);
    const run = async () => {
      if (!active || !enabled || request) return;
      window.clearTimeout(timer);
      dirty = false;
      const controller = new AbortController();
      request = controller;
      const epoch = generation;
      try {
        const result = await loader.current(controller.signal);
        if (active && !controller.signal.aborted && epoch === generation) {
          setData(result);
          setError('');
        }
      } catch (caught) {
        if (active && !controller.signal.aborted && epoch === generation && !isAbort(caught)) {
          setError(apiErrorMessage(caught));
          if (caught instanceof ApiError && [403, 404].includes(caught.status)) {
            setData(null);
            denied.current?.(apiErrorMessage(caught));
          }
        }
      } finally {
        if (request === controller) {
          request = null;
          if (active) {
            if (epoch === generation) setLoading(false);
            if (dirty) void run();
            else timer = window.setTimeout(poll, 20000);
          }
        }
      }
    };
    const refresh = () => {
      if (!active || !enabled) return;
      generation += 1;
      dirty = true;
      void run();
    };
    const poll = () => {
      if (!active) return;
      if (document.hidden) timer = window.setTimeout(poll, 20000);
      else void run();
    };
    const visible = () => {
      if (!document.hidden) refresh();
    };
    apply.current = (source, value) => {
      if (!active || !enabled || source !== key) return;
      generation += 1;
      dirty = true;
      setData(value);
      setError('');
      setLoading(false);
      void run();
    };
    reload.current = refresh;
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    if (enabled) void run();
    return () => {
      active = false;
      generation += 1;
      request?.abort();
      window.clearTimeout(timer);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
      reload.current = () => {};
      apply.current = () => {};
    };
  }, [key, enabled]);
  const refresh = useCallback(() => reload.current(), []);
  const replace = useCallback((value: T) => apply.current(key, value), [key]);
  return { data, loading, error, refresh, replace };
}
