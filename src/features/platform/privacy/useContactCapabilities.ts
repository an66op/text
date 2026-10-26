import { useCallback, useEffect, useRef, useState } from 'react';
import { apiErrorMessage, isAbort } from '@/shared/api/client';
import { useContactScope } from './contact-scope';
import { privacyApi } from './privacy-api';
import { privacyReadEpoch } from './operation-registry';
import { usePrivacyOperation } from './usePrivacyOperation';
import type { ContactCapabilities } from './types';
import { usePlatformStream } from '../messages/usePlatformStream';
import { useAuth } from '../useAuth';

export function useContactCapabilities(userId: string) {
  const { scope, valid } = useContactScope();
  usePrivacyOperation(scope);
  const [data, setData] = useState<ContactCapabilities | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const reload = useRef<() => void>(() => {});
  const { user } = useAuth();
  usePlatformStream(user?.id ?? '', (event) => {
    if (event.type === 'resync') reload.current();
  });
  useEffect(() => {
    let active = true,
      generation = 0,
      dirty = false,
      timer = 0,
      request: AbortController | null = null;
    setData(null);
    setError('');
    setLoading(!!scope && !!userId);
    const load = async () => {
      if (!active || !scope || !userId || !valid() || request) return;
      window.clearTimeout(timer);
      dirty = false;
      const controller = new AbortController(),
        epoch = generation,
        privateEpoch = privacyReadEpoch(scope);
      request = controller;
      setLoading(true);
      try {
        const result = await privacyApi.capabilities(userId, controller.signal);
        if (
          active &&
          !controller.signal.aborted &&
          valid() &&
          epoch === generation &&
          privateEpoch === privacyReadEpoch(scope)
        ) {
          setData(result);
          setError('');
        }
      } catch (caught) {
        if (
          active &&
          !controller.signal.aborted &&
          valid() &&
          epoch === generation &&
          !isAbort(caught)
        ) {
          setData(null);
          setError(apiErrorMessage(caught));
        }
      } finally {
        if (request === controller) request = null;
        if (active) {
          setLoading(false);
          if (dirty) void load();
          else
            timer = window.setTimeout(() => {
              if (!document.hidden) void load();
              else timer = window.setTimeout(refresh, 10000);
            }, 15000);
        }
      }
    };
    const refresh = () => {
      generation++;
      dirty = true;
      void load();
    };
    const visible = () => {
      if (!document.hidden) refresh();
    };
    reload.current = refresh;
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('gongming:privacy-changed', refresh);
    window.addEventListener('gongming:friendships-changed', refresh);
    void load();
    return () => {
      active = false;
      generation++;
      request?.abort();
      window.clearTimeout(timer);
      reload.current = () => {};
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('gongming:privacy-changed', refresh);
      window.removeEventListener('gongming:friendships-changed', refresh);
    };
    // The immutable scope contains the account and authentication epoch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, userId]);
  const refresh = useCallback(() => reload.current(), []);
  return { data, capabilities: data, loading, error, refresh };
}
