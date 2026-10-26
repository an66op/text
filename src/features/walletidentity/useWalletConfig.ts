import { useEffect, useState } from 'react';
import { isAbort } from '@/shared/api/client';
import { walletIdentityApi } from './api';
import { walletFailure } from './model';
import type { WalletConfig } from './types';
export function useWalletConfig() {
  const [value, setValue] = useState<WalletConfig | null>(null),
    [error, setError] = useState(''),
    [revision, retry] = useState(0),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void walletIdentityApi
      .config(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setValue(next);
      })
      .catch((caught) => {
        if (!controller.signal.aborted && !isAbort(caught)) setError(walletFailure(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);
  return { value, error, loading, retry: () => retry((v) => v + 1) };
}
