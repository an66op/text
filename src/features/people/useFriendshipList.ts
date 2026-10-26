import { useCallback, useEffect, useRef, useState } from 'react';
import { apiErrorMessage, isAbort } from '@/shared/api/client';
import type { ListResult } from '@/shared/api/types';

export function useFriendshipList<T>(
  load: (offset: number, signal: AbortSignal) => Promise<ListResult<T>>,
  keyFor: (item: T) => string,
  pollInterval = 0,
) {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const refresh = useCallback(() => {
    setOffset(0);
    setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    const visible = () => {
      if (!document.hidden) refresh();
    };
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('gongming:friendships-changed', refresh);
    return () => {
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('gongming:friendships-changed', refresh);
    };
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    let timer = 0;
    const current = ++generation.current;
    const poll = () => {
      if (controller.signal.aborted) return;
      if (document.hidden) timer = window.setTimeout(poll, pollInterval);
      else refresh();
    };
    setLoading(true);
    setError('');
    void load(offset, controller.signal)
      .then((result) => {
        if (controller.signal.aborted || current !== generation.current) return;
        setItems((previous) =>
          offset
            ? [
                ...previous.filter(
                  (item) => !result.items.some((next) => keyFor(item) === keyFor(next)),
                ),
                ...result.items,
              ]
            : result.items,
        );
        setTotal(result.total);
      })
      .catch((caught) => {
        if (!controller.signal.aborted && current === generation.current && !isAbort(caught)) {
          setError(apiErrorMessage(caught));
          if (!offset) setItems([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && current === generation.current) {
          setLoading(false);
          if (pollInterval > 0) timer = window.setTimeout(poll, pollInterval);
        }
      });
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      generation.current += 1;
    };
  }, [load, keyFor, offset, revision, pollInterval, refresh]);
  const more = () => {
    if (!loading && items.length < total) setOffset(items.length);
  };
  return { items, total, loading, error, refresh, more };
}
