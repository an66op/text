import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, apiErrorMessage, onUnauthorized } from '@/shared/api/client';
import { platformApi } from '@/shared/api/platformApi';
import {
  advanceAccountEpoch,
  onAccountChanged,
  setExpectedAccount,
} from '@/shared/api/account-guard';
import type { Session } from '@/shared/api/types';
import { AuthContext, type AuthState } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('checking');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const latestSession = useRef<Session | null>(null);
  const mutation = useRef(false);
  const queuedRefresh = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const lastValidation = useRef(0);
  const broadcast = useCallback(() => {
    try {
      channel.current?.postMessage('session.changed');
    } catch {
      /* Cross-tab signals are optional; focus still revalidates the cookie. */
    }
  }, []);
  const accept = useCallback((next: Session | null) => {
    const changed =
      latestSession.current?.user.id !== next?.user.id ||
      latestSession.current?.expiresAt !== next?.expiresAt;
    latestSession.current = next;
    setExpectedAccount(next?.user.id ?? '', changed);
    setSession(next);
  }, []);
  const refresh = useCallback(async () => {
    if (mutation.current) {
      queuedRefresh.current = true;
      return;
    }
    const current = ++generation.current;
    lastValidation.current = Date.now();
    try {
      const next = await platformApi.me();
      if (current !== generation.current) return;
      accept(next);
      setStatus('authenticated');
      setError('');
    } catch (caught) {
      if (current !== generation.current) return;
      const guest = caught instanceof ApiError && caught.status === 401;
      if (guest || !latestSession.current) accept(null);
      setStatus(guest ? 'guest' : latestSession.current ? 'authenticated' : 'unavailable');
      setError(guest ? '' : apiErrorMessage(caught));
    }
  }, [accept]);
  useEffect(() => {
    void refresh();
    const off = onUnauthorized(() => {
      generation.current += 1;
      accept(null);
      setStatus('guest');
      setError('登录已失效，请重新登录');
    });
    const changed = onAccountChanged(() => void refresh());
    const revalidate = () => {
      if (!document.hidden && Date.now() - lastValidation.current > 5000) void refresh();
    };
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel.current = new BroadcastChannel('gongming-session');
        channel.current.onmessage = () => void refresh();
      } catch {
        channel.current = null;
      }
    }
    return () => {
      generation.current += 1;
      off();
      changed();
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
      channel.current?.close();
      channel.current = null;
      setExpectedAccount('');
    };
  }, [refresh, accept]);
  useEffect(() => {
    if (!session?.expiresAt) return;
    let timer = 0;
    const checkExpiry = () => {
      const remaining = new Date(session.expiresAt).getTime() - Date.now();
      if (remaining > 0) {
        timer = window.setTimeout(checkExpiry, Math.min(remaining, 2_147_000_000));
      } else {
        generation.current += 1;
        accept(null);
        setStatus('guest');
        setError('登录已到期，请重新登录');
      }
    };
    checkExpiry();
    return () => window.clearTimeout(timer);
  }, [session, accept]);
  const value = useMemo<AuthState>(
    () => ({
      user: session?.user ?? null,
      expiresAt: session?.expiresAt ?? '',
      status,
      error,
      refresh,
      login: async (email, password) => {
        if (mutation.current) throw new Error('账号操作正在处理中，请稍后再试');
        mutation.current = true;
        advanceAccountEpoch();
        const current = ++generation.current;
        try {
          const next = await platformApi.login(email, password);
          if (current !== generation.current) return;
          accept(next);
          setStatus('authenticated');
          setError('');
          broadcast();
        } finally {
          mutation.current = false;
          if (queuedRefresh.current) {
            queuedRefresh.current = false;
            void refresh();
          }
        }
      },
      register: async (input) => {
        if (mutation.current) throw new Error('账号操作正在处理中，请稍后再试');
        mutation.current = true;
        advanceAccountEpoch();
        const current = ++generation.current;
        try {
          const next = await platformApi.register(input);
          if (current !== generation.current) return;
          accept(next);
          setStatus('authenticated');
          setError('');
          broadcast();
        } finally {
          mutation.current = false;
          if (queuedRefresh.current) {
            queuedRefresh.current = false;
            void refresh();
          }
        }
      },
      logout: async () => {
        if (mutation.current) throw new Error('账号操作正在处理中，请稍后再试');
        mutation.current = true;
        advanceAccountEpoch();
        const current = ++generation.current;
        try {
          await platformApi.logout();
          if (current !== generation.current) return;
          accept(null);
          setStatus('guest');
          setError('');
          broadcast();
        } finally {
          mutation.current = false;
          if (queuedRefresh.current) {
            queuedRefresh.current = false;
            void refresh();
          }
        }
      },
      updateProfile: async (input) => {
        const current = generation.current;
        const user = await platformApi.updateMe(input);
        if (current !== generation.current) return;
        if (latestSession.current) accept({ ...latestSession.current, user });
        broadcast();
      },
    }),
    [session, status, error, refresh, accept, broadcast],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
