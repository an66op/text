import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, apiErrorMessage, onUnauthorized } from '@/shared/api/client';
import { platformApi } from '@/shared/api/platformApi';
import {
  advanceAccountEpoch,
  accountEpoch,
  onAccountChanged,
  setExpectedAccount,
} from '@/shared/api/account-guard';
import type { Session } from '@/shared/api/types';
import { AuthContext, type AuthState } from './auth-context';
import {
  isUnconfirmedAuthWrite,
  prepareAuthContext,
  withAuthBrowserLock,
} from '@/shared/api/auth-context';
import { walletIdentityApi } from '@/features/walletidentity/api';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('checking');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const latestSession = useRef<Session | null>(null);
  const mounted = useRef(true);
  const mutation = useRef(false);
  const queuedRefresh = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const lastValidation = useRef(0);
  const contextReady = useRef(false);
  const controllers = useRef(new Set<AbortController>());
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
    if (!mounted.current) return;
    if (mutation.current) {
      queuedRefresh.current = true;
      return;
    }
    const current = ++generation.current;
    lastValidation.current = Date.now();
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      if (!contextReady.current) {
        await withAuthBrowserLock(() => prepareAuthContext(controller.signal), controller.signal);
        if (!mounted.current || current !== generation.current) return;
        contextReady.current = true;
      }
      const next = await platformApi.me(controller.signal);
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
    } finally {
      controllers.current.delete(controller);
    }
  }, [accept]);
  useEffect(() => {
    mounted.current = true;
    const requests = controllers.current;
    void refresh();
    const off = onUnauthorized(() => {
      generation.current += 1;
      accept(null);
      setStatus('guest');
      setError('登录已失效，请重新登录');
      if (mutation.current) queuedRefresh.current = true;
    });
    const reconcile = () => {
      if (mutation.current) generation.current += 1;
      void refresh();
    };
    const changed = onAccountChanged(reconcile);
    const revalidate = () => {
      if (!document.hidden && Date.now() - lastValidation.current > 5000) void refresh();
    };
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    if (typeof BroadcastChannel !== 'undefined') {
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
      requests.forEach((controller) => controller.abort());
      requests.clear();
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
        if (mutation.current) queuedRefresh.current = true;
      }
    };
    checkExpiry();
    return () => window.clearTimeout(timer);
  }, [session, accept]);
  const runMutation = useCallback(
    async (operation: (signal: AbortSignal) => Promise<Session | null>) => {
      if (!mounted.current) throw new Error('账号页面已关闭');
      if (mutation.current) throw new Error('账号操作正在处理中，请稍后再试');
      mutation.current = true;
      advanceAccountEpoch();
      const current = ++generation.current;
      const controller = new AbortController();
      controllers.current.add(controller);
      try {
        const next = await operation(controller.signal);
        if (!mounted.current || current !== generation.current) return false;
        accept(next);
        contextReady.current = true;
        setStatus(next ? 'authenticated' : 'guest');
        setError('');
        broadcast();
        return true;
      } catch (caught) {
        if (!mounted.current) return false;
        // A timed out auth write may already have set a cookie. Read it once;
        // never retry the credential replacement automatically.
        if (isUnconfirmedAuthWrite(caught)) queuedRefresh.current = true;
        throw caught;
      } finally {
        controllers.current.delete(controller);
        mutation.current = false;
        if (queuedRefresh.current) {
          queuedRefresh.current = false;
          if (mounted.current) void refresh();
        }
      }
    },
    [accept, broadcast, refresh],
  );
  const value = useMemo<AuthState>(
    () => ({
      user: session?.user ?? null,
      expiresAt: session?.expiresAt ?? '',
      status,
      error,
      refresh,
      login: async (email, password) => {
        await runMutation((signal) => platformApi.login(email, password, signal));
      },
      register: async (input) => {
        await runMutation((signal) => platformApi.register(input, signal));
      },
      logout: async () => {
        await runMutation(async (signal) => {
          await platformApi.logout(signal);
          return null;
        });
      },
      loginWallet: async (proof, signal) => {
        if (!mounted.current) throw new Error('账号页面已关闭');
        if (proof.expectedEpoch !== accountEpoch() || signal?.aborted)
          throw new Error('账号状态已变化，请重新确认');
        return runMutation(async (requestSignal) => {
          const combined = signal ? AbortSignal.any([signal, requestSignal]) : requestSignal;
          return walletIdentityApi.login(proof, combined);
        });
      },
      updateProfile: async (input) => {
        if (!mounted.current) throw new Error('账号页面已关闭');
        const current = generation.current;
        const user = await platformApi.updateMe(input);
        if (!mounted.current || current !== generation.current) return;
        if (latestSession.current) accept({ ...latestSession.current, user });
        broadcast();
      },
    }),
    [session, status, error, refresh, accept, broadcast, runMutation],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
