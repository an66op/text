import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, errorMessage, SESSION_EXPIRED_EVENT } from './api';
import { SessionContext, type SessionContextValue } from './session-context';
import type { Session } from './types';

export default function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionContextValue['status']>('checking');
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);

  const refresh = useCallback(async () => {
    setStatus('checking');
    setError('');
    try {
      setSession(await api<Session>('/auth/me'));
      setStatus('authenticated');
    } catch (error) {
      setSession(null);
      if (error instanceof ApiError && error.status === 401) {
        setStatus('anonymous');
      } else {
        setStatus('unavailable');
        setError(errorMessage(error));
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const expire = () => {
      setSession(null);
      setStatus('anonymous');
      setExpired(true);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expire);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expire);
  }, [refresh]);

  // A server-confirmed session still expires when the user leaves the console idle.
  useEffect(() => {
    if (!session) return;
    const remaining = new Date(session.expiresAt).getTime() - Date.now();
    if (!Number.isFinite(remaining)) return;
    const timer = window.setTimeout(
      () => {
        setSession(null);
        setStatus('anonymous');
        setExpired(true);
      },
      Math.max(0, Math.min(remaining, 2_147_483_647)),
    );
    return () => window.clearTimeout(timer);
  }, [session]);

  const login = async (email: string, password: string) => {
    const result = await api<Session>('/auth/login', { method: 'POST', body: { email, password } });
    setSession(result);
    setStatus('authenticated');
    setError('');
    setExpired(false);
  };
  const logout = async () => {
    await api<{ ok: true }>('/auth/logout', { method: 'POST' });
    setSession(null);
    setStatus('anonymous');
    setExpired(false);
  };

  return (
    <SessionContext value={{ session, status, error, expired, refresh, login, logout }}>
      {children}
    </SessionContext>
  );
}
