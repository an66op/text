import { useCallback, useEffect, useRef, useState } from 'react';
import { accountEpoch } from '@/shared/api/account-guard';
import { isAbort } from '@/shared/api/client';
import { walletIdentityApi } from './api';
import { walletFailure } from './model';
import type { BindingsResult } from './types';
export function useWalletBindings() {
  const [value, setValue] = useState<BindingsResult | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const live = useRef(false),
    generation = useRef(0),
    running = useRef<Promise<boolean> | null>(null),
    dirty = useRef(false),
    controller = useRef<AbortController | null>(null);
  const invalidate = useCallback(() => {
    generation.current++;
    controller.current?.abort();
  }, []);
  const refresh = useCallback((): Promise<boolean> => {
    if (!live.current) return Promise.resolve(false);
    dirty.current = true;
    if (running.current) {
      const expected = generation.current;
      return running.current.then((confirmed) => {
        if (!live.current) return false;
        if (dirty.current) return refresh();
        return confirmed && expected === generation.current;
      });
    }
    const operation = async () => {
      let confirmed: boolean;
      do {
        dirty.current = false;
        confirmed = false;
        const version = generation.current,
          epoch = accountEpoch(),
          request = new AbortController();
        controller.current = request;
        setLoading(true);
        try {
          const next = await walletIdentityApi.bindings(request.signal);
          if (
            live.current &&
            !request.signal.aborted &&
            version === generation.current &&
            epoch === accountEpoch()
          ) {
            setValue(next);
            setError('');
            confirmed = true;
          }
        } catch (caught) {
          if (
            live.current &&
            !request.signal.aborted &&
            version === generation.current &&
            epoch === accountEpoch() &&
            !isAbort(caught)
          )
            setError(walletFailure(caught));
        } finally {
          if (live.current && version === generation.current) setLoading(false);
        }
      } while (live.current && dirty.current);
      return confirmed;
    };
    const task = operation().finally(() => {
      running.current = null;
    });
    running.current = task;
    const expected = generation.current;
    return task.then((confirmed) => confirmed && live.current && expected === generation.current);
  }, []);
  useEffect(() => {
    live.current = true;
    void refresh();
    const update = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    const timer = window.setInterval(update, 30_000);
    return () => {
      live.current = false;
      invalidate();
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [refresh, invalidate]);
  return { value, error, loading, invalidate, refresh };
}
