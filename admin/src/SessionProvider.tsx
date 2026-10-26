import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  advanceAccountEpoch,
  accountEpoch,
  onAccountChanged,
  setExpectedAccount,
} from '../../src/shared/api/account-guard';
import { api, ApiError, errorMessage, SESSION_EXPIRED_EVENT } from './api';
import { authContextHeaders, prepareAuthContext } from './auth-context';
import { SessionContext, type SessionContextValue } from './session-context';
import type { Session } from './types';

export default function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionContextValue['status']>('checking');
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const latest = useRef<Session | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const mutation = useRef(false);
  const mutationController = useRef<AbortController | null>(null);
  const queued = useRef(false);
  const validatedAt = useRef(0);
  const contextReady = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const accept = useCallback((next: Session | null) => {
    const changed =
      latest.current?.user.id !== next?.user.id || latest.current?.expiresAt !== next?.expiresAt;
    latest.current = next;
    setExpectedAccount(next?.user.id ?? '', changed);
    setSession(next);
  }, []);

  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    if (mutation.current) {
      queued.current = true;
      return;
    }
    const current = ++generation.current;
    validatedAt.current = Date.now();
    if (!latest.current) setStatus('checking');
    try {
      if (!contextReady.current) {
        await prepareAuthContext();
        if (current !== generation.current) return;
        contextReady.current = true;
      }
      const next = await api<Session>('/auth/me');
      if (current !== generation.current) return;
      accept(next);
      setStatus('authenticated');
      setError('');
      setExpired(false);
    } catch (caught) {
      if (current !== generation.current) return;
      if (caught instanceof ApiError && caught.status === 401) {
        setExpired(!!latest.current);
        accept(null);
        setStatus('anonymous');
        setError('');
      } else {
        setStatus(latest.current ? 'authenticated' : 'unavailable');
        setError(errorMessage(caught));
      }
    }
  }, [accept]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const expire = () => {
      generation.current += 1;
      accept(null);
      setStatus('anonymous');
      setExpired(true);
      if (mutation.current) queued.current = true;
    };
    const revalidate = () => {
      if (!document.hidden && Date.now() - validatedAt.current >= 5000) void refresh();
    };
    const reconcile = () => {
      if (mutation.current) generation.current += 1;
      void refresh();
    };
    const changed = onAccountChanged(reconcile);
    window.addEventListener(SESSION_EXPIRED_EVENT, expire);
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    const interval = window.setInterval(revalidate, 30000);
    if (typeof BroadcastChannel === 'function') {
      try {
        channel.current = new BroadcastChannel('gongming-session');
        channel.current.onmessage = reconcile;
      } catch {
        channel.current = null;
      }
    }
    return () => {
      mounted.current = false;
      generation.current += 1;
      mutationController.current?.abort();
      changed();
      window.removeEventListener(SESSION_EXPIRED_EVENT, expire);
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
      window.clearInterval(interval);
      channel.current?.close();
      channel.current = null;
      setExpectedAccount('');
    };
  }, [accept, refresh]);

  // A server-confirmed session still expires when the user leaves the console idle.
  useEffect(() => {
    if (!session) return;
    let timer = 0;
    const checkExpiry = () => {
      const remaining = new Date(session.expiresAt).getTime() - Date.now();
      if (!Number.isFinite(remaining)) return;
      if (remaining > 0) timer = window.setTimeout(checkExpiry, Math.min(remaining, 2_147_000_000));
      else {
        generation.current += 1;
        accept(null);
        setStatus('anonymous');
        setExpired(true);
        if (mutation.current) queued.current = true;
      }
    };
    checkExpiry();
    return () => window.clearTimeout(timer);
  }, [session, accept]);

  const broadcast = useCallback(() => {
    try {
      channel.current?.postMessage('session.changed');
    } catch {
      /* Focus and timed validation remain available. */
    }
  }, []);
  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      status,
      error,
      expired,
      refresh,
      login: async (email, password) => {
        if (!mounted.current) throw new Error('账号页面已关闭');
        if (mutation.current) throw new Error('账号操作正在处理中，请稍后再试');
        mutation.current = true;
        advanceAccountEpoch();
        const current = ++generation.current;
        const epoch = accountEpoch();
        const controller = new AbortController();
        mutationController.current = controller;
        const assertCurrent = () => {
          if (!mounted.current || current !== generation.current || epoch !== accountEpoch())
            throw new ApiError('账号状态已变化，请重新确认后操作。', 409, 'account_changed');
        };
        let submitted = false;
        try {
          const context = await prepareAuthContext(controller.signal);
          assertCurrent();
          submitted = true;
          const next = await api<Session>('/auth/login', {
            method: 'POST',
            body: { email, password },
            headers: authContextHeaders(context),
            signal: controller.signal,
          });
          assertCurrent();
          accept(next);
          setStatus('authenticated');
          setError('');
          setExpired(false);
          broadcast();
        } catch (caught) {
          if (
            mounted.current &&
            current === generation.current &&
            caught instanceof ApiError &&
            (caught.code === 'auth_context_changed' ||
              caught.code === 'account_changed' ||
              (submitted &&
                (caught.status === 0 ||
                  caught.status >= 500 ||
                  caught.code === 'invalid_response')))
          ) {
            accept(null);
            setStatus('checking');
            queued.current = true;
          }
          throw caught;
        } finally {
          if (mutationController.current === controller) mutationController.current = null;
          mutation.current = false;
          if (queued.current) {
            queued.current = false;
            void refresh();
          }
        }
      },
      logout: async () => {
        if (!mounted.current) throw new Error('账号页面已关闭');
        if (mutation.current) throw new Error('账号操作正在处理中，请稍后再试');
        mutation.current = true;
        advanceAccountEpoch();
        const current = ++generation.current;
        const epoch = accountEpoch();
        const controller = new AbortController();
        mutationController.current = controller;
        const assertCurrent = () => {
          if (!mounted.current || current !== generation.current || epoch !== accountEpoch())
            throw new ApiError('账号状态已变化，请重新确认后操作。', 409, 'account_changed');
        };
        let submitted = false;
        try {
          const context = await prepareAuthContext(controller.signal);
          assertCurrent();
          submitted = true;
          const result = await api<{ ok: true }>('/auth/logout', {
            method: 'POST',
            headers: authContextHeaders(context),
            signal: controller.signal,
          });
          assertCurrent();
          if (result?.ok !== true)
            throw new ApiError('服务尚未确认退出，请先重新验证账号。', 0, 'invalid_response');
          accept(null);
          setStatus('anonymous');
          setError('');
          setExpired(false);
          broadcast();
        } catch (caught) {
          if (
            mounted.current &&
            current === generation.current &&
            caught instanceof ApiError &&
            (caught.code === 'auth_context_changed' ||
              caught.code === 'account_changed' ||
              (submitted &&
                (caught.status === 0 ||
                  caught.status >= 500 ||
                  caught.code === 'invalid_response')))
          ) {
            accept(null);
            setStatus('checking');
            queued.current = true;
          }
          throw caught;
        } finally {
          if (mutationController.current === controller) mutationController.current = null;
          mutation.current = false;
          if (queued.current) {
            queued.current = false;
            void refresh();
          }
        }
      },
    }),
    [session, status, error, expired, refresh, accept, broadcast],
  );
  return <SessionContext value={value}>{children}</SessionContext>;
}
