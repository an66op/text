import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, apiErrorMessage, onUnauthorized } from '@/shared/api/client';
import { platformApi } from '@/shared/api/platformApi';
import type { Session } from '@/shared/api/types';
import { AuthContext, type AuthState } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('checking');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const next = await platformApi.me();
      if (current !== generation.current) return;
      setSession(next);
      setStatus('authenticated');
      setError('');
    } catch (caught) {
      if (current !== generation.current) return;
      setSession(null);
      const guest = caught instanceof ApiError && caught.status === 401;
      setStatus(guest ? 'guest' : 'unavailable');
      setError(guest ? '' : apiErrorMessage(caught));
    }
  }, []);
  useEffect(() => {
    void refresh();
    const off = onUnauthorized(() => {
      generation.current += 1;
      setSession(null);
      setStatus('guest');
      setError('登录已失效，请重新登录');
    });
    return () => {
      generation.current += 1;
      off();
    };
  }, [refresh]);
  useEffect(() => {
    if (!session?.expiresAt) return;
    let timer = 0;
    const checkExpiry = () => {
      const remaining = new Date(session.expiresAt).getTime() - Date.now();
      if (remaining > 0) {
        timer = window.setTimeout(checkExpiry, Math.min(remaining, 2_147_000_000));
      } else {
        generation.current += 1;
        setSession(null);
        setStatus('guest');
        setError('登录已到期，请重新登录');
      }
    };
    checkExpiry();
    return () => window.clearTimeout(timer);
  }, [session]);
  const value = useMemo<AuthState>(
    () => ({
      user: session?.user ?? null,
      expiresAt: session?.expiresAt ?? '',
      status,
      error,
      refresh,
      login: async (email, password) => {
        const current = ++generation.current;
        const next = await platformApi.login(email, password);
        if (current !== generation.current) return;
        setSession(next);
        setStatus('authenticated');
        setError('');
      },
      register: async (input) => {
        const current = ++generation.current;
        const next = await platformApi.register(input);
        if (current !== generation.current) return;
        setSession(next);
        setStatus('authenticated');
        setError('');
      },
      logout: async () => {
        await platformApi.logout();
        generation.current += 1;
        setSession(null);
        setStatus('guest');
        setError('');
      },
      updateProfile: async (input) => {
        const current = generation.current;
        const user = await platformApi.updateMe(input);
        if (current !== generation.current) return;
        setSession((previous) => (previous ? { ...previous, user } : null));
      },
    }),
    [session, status, error, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
