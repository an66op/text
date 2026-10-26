import { useCallback, useEffect, useRef, useState } from 'react';
import { apiErrorMessage, isAbort } from '@/shared/api/client';

type Resource<T> = { key: string; data: T | null; loading: boolean; error: string };
type Control<T> = {
  key: string;
  refresh: (clear: boolean, strict: boolean) => void;
  commit: (update: (value: T | null) => T | null) => void;
};
export function useNotificationResource<T>(
  key: string,
  enabled: boolean,
  load: (signal: AbortSignal) => Promise<T>,
  { pollMs = 20000, sensitive = true } = {},
) {
  const [state, setState] = useState<Resource<T>>({ key, data: null, loading: enabled, error: '' });
  const loader = useRef(load);
  loader.current = load;
  const control = useRef<Control<T> | null>(null);
  useEffect(() => {
    let active = true,
      dirty = false,
      generation = 0,
      timer = 0;
    let request: AbortController | null = null;
    setState({ key, data: null, loading: enabled, error: '' });
    const run = async () => {
      if (!active || !enabled || request) return;
      window.clearTimeout(timer);
      dirty = false;
      const controller = new AbortController(),
        epoch = generation;
      request = controller;
      try {
        const data = await loader.current(controller.signal);
        if (active && !controller.signal.aborted && epoch === generation)
          setState({ key, data, loading: false, error: '' });
      } catch (error) {
        if (active && !controller.signal.aborted && epoch === generation && !isAbort(error))
          setState((previous) => ({
            key,
            data: sensitive ? null : previous.key === key ? previous.data : null,
            loading: false,
            error: apiErrorMessage(error),
          }));
      } finally {
        if (request === controller) {
          request = null;
          if (active) {
            if (epoch === generation) setState((previous) => ({ ...previous, loading: false }));
            if (dirty) void run();
            else timer = window.setTimeout(poll, pollMs);
          }
        }
      }
    };
    const refresh = (clear: boolean, strict = true) => {
      if (!active || !enabled) return;
      if (strict) generation += 1;
      dirty = true;
      if (clear) setState({ key, data: null, loading: true, error: '' });
      void run();
    };
    const poll = () => {
      if (!active) return;
      if (document.hidden) timer = window.setTimeout(poll, pollMs);
      else void run();
    };
    const visible = () => {
      if (!document.hidden) refresh(sensitive);
    };
    control.current = {
      key,
      refresh,
      commit: (update) => {
        if (!active || !enabled) return;
        generation += 1;
        dirty = true;
        setState((previous) => ({
          key,
          data: update(previous.key === key ? previous.data : null),
          loading: false,
          error: '',
        }));
        void run();
      },
    };
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
      if (control.current?.key === key) control.current = null;
    };
  }, [key, enabled, pollMs, sensitive]);
  const refresh = useCallback(
    (clear = false, strict = true) => {
      if (control.current?.key === key) control.current.refresh(clear, strict);
    },
    [key],
  );
  const commit = useCallback(
    (update: (value: T | null) => T | null) => {
      if (control.current?.key === key) control.current.commit(update);
    },
    [key],
  );
  return {
    ...(state.key === key && enabled ? state : { key, data: null, loading: enabled, error: '' }),
    refresh,
    commit,
  };
}
