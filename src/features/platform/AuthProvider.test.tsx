import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@/shared/api/client';
import { accountChanged, accountEpoch, expectedAccount } from '@/shared/api/account-guard';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './useAuth';
import { otherMember, session } from './platform-test-fixtures';
import type { AuthState } from './auth-context';
import { walletIdentityApi } from '@/features/walletidentity/api';

function Probe() {
  const auth = useAuth();
  return (
    <>
      <output>
        {auth.status}:{auth.user?.name ?? 'guest'}
      </output>
      <p>{auth.error}</p>
      <button onClick={() => void auth.login('demo@gongming.local', 'Demo2026!')}>登录</button>
      <button onClick={() => void auth.logout()}>退出</button>
      <button onClick={() => void auth.refresh()}>重查</button>
    </>
  );
}
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(status >= 400 ? { error: data } : { data }), { status });
function authFetch(fetcher: (...args: never[]) => unknown) {
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) =>
    path.endsWith('/auth/context')
      ? Promise.resolve(response({ generation: 'test_context', expiresAt: '2099-01-01T00:00:00Z' }))
      : fetcher(path as never, init as never),
  );
}
const secondSession = { ...session, user: otherMember };
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('server authentication lifecycle', () => {
  it.each(['broken', 'missing', 'server-error'] as const)(
    'reconciles a wallet login with an unconfirmed %s receipt without another verify',
    async (kind) => {
      let reads = 0;
      const fetcher = vi
        .fn()
        .mockImplementation((path: string) =>
          Promise.resolve(
            path.endsWith('/auth/me')
              ? response(++reads === 1 ? session : secondSession)
              : kind === 'broken'
                ? new Response('broken', { status: 200 })
                : kind === 'missing'
                  ? new Response(JSON.stringify({ unexpected: true }), { status: 200 })
                  : response({ code: 'internal_error', message: '结果未确认' }, 500),
          ),
        );
      authFetch(fetcher);
      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
      await waitFor(() => expect(result.current.user?.id).toBe(session.user.id));
      await act(async () => {
        await result.current
          .loginWallet({
            id: 'challenge_one',
            message: 'message',
            signature: 'signature',
            contextGeneration: 'test_context',
            expectedEpoch: accountEpoch(),
          })
          .catch(() => {});
      });
      await waitFor(() => expect(result.current.user?.id).toBe(secondSession.user.id));
      expect(reads).toBe(2);
      expect(
        fetcher.mock.calls.filter(([path]) => path.endsWith('/auth/wallet/verify')),
      ).toHaveLength(1);
    },
  );
  it('prepares browser context before checking a legacy cookie and does not read identity on context failure', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({ generation: 'first_context', expiresAt: session.expiresAt }),
      )
      .mockResolvedValueOnce(response(session));
    vi.stubGlobal('fetch', fetcher);
    const view = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(view.result.current.user?.id).toBe(session.user.id));
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      '/api/v1/auth/context',
      '/api/v1/auth/me',
    ]);
    expect((fetcher.mock.calls[0][1].headers as Headers).get('X-Gongming-Browser')).toBe('1');
    view.unmount();
    fetcher.mockReset().mockRejectedValue(new TypeError('offline'));
    const retry = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(retry.result.current.status).toBe('unavailable'));
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/auth/context');
  });

  it('single-flights final wallet verification with password authentication', async () => {
    authFetch(vi.fn().mockResolvedValue(response(session)));
    let finish!: (value: typeof session) => void;
    const verify = vi.spyOn(walletIdentityApi, 'login').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.user?.id).toBe(session.user.id));
    let pending!: Promise<boolean>;
    act(() => {
      pending = result.current.loginWallet({
        id: 'challenge_one',
        message: 'message',
        signature: 'signature',
        contextGeneration: 'test_context',
        expectedEpoch: accountEpoch(),
      });
    });
    await expect(result.current.login('second@example.test', 'Example2026!')).rejects.toThrow(
      '账号操作正在处理中',
    );
    await act(async () => {
      finish(secondSession);
      expect(await pending).toBe(true);
    });
    expect(verify).toHaveBeenCalledOnce();
    expect(result.current.user?.id).toBe(secondSession.user.id);
  });

  it('does not accept a late wallet login receipt after an external account change signal', async () => {
    let reads = 0;
    authFetch(
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(response(++reads === 1 ? session : secondSession)),
        ),
    );
    let finish!: (value: typeof session) => void;
    vi.spyOn(walletIdentityApi, 'login').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.user?.id).toBe(session.user.id));
    let pending!: Promise<boolean>;
    act(() => {
      pending = result.current.loginWallet({
        id: 'challenge_one',
        message: 'message',
        signature: 'signature',
        contextGeneration: 'test_context',
        expectedEpoch: accountEpoch(),
      });
      accountChanged();
    });
    await act(async () => {
      finish(session);
      expect(await pending).toBe(false);
    });
    await waitFor(() => expect(result.current.user?.id).toBe(secondSession.user.id));
    expect(reads).toBe(2);
  });

  it('keeps a valid account after a failed wallet login returns 401', async () => {
    authFetch(
      vi
        .fn()
        .mockImplementation((path: string) =>
          Promise.resolve(
            path.endsWith('/auth/me')
              ? response(session)
              : response({ code: 'unauthorized', message: '钱包登录未完成' }, 401),
          ),
        ),
    );
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.user?.id).toBe(session.user.id));
    await act(async () => {
      await expect(
        result.current.loginWallet({
          id: 'challenge_one',
          message: 'message',
          signature: 'signature',
          contextGeneration: 'test_context',
          expectedEpoch: accountEpoch(),
        }),
      ).rejects.toMatchObject({ status: 401 });
    });
    expect(result.current.user?.id).toBe(session.user.id);
    expect(result.current.status).toBe('authenticated');
  });

  it('rechecks an aborted final wallet verification once without repeating the write', async () => {
    let reads = 0;
    const fetcher = vi
      .fn()
      .mockImplementation((path: string) =>
        path.endsWith('/auth/me')
          ? Promise.resolve(response(++reads === 1 ? session : secondSession))
          : new Promise(() => {}),
      );
    authFetch(fetcher);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.user?.id).toBe(session.user.id));
    const controller = new AbortController();
    let pending!: Promise<boolean>;
    act(() => {
      pending = result.current.loginWallet(
        {
          id: 'challenge_one',
          message: 'message',
          signature: 'signature',
          contextGeneration: 'test_context',
          expectedEpoch: accountEpoch(),
        },
        controller.signal,
      );
    });
    const caught = pending.catch((error) => error);
    await waitFor(() =>
      expect(
        fetcher.mock.calls.filter(([path]) => path.endsWith('/auth/wallet/verify')),
      ).toHaveLength(1),
    );
    await act(async () => {
      controller.abort();
      await caught;
    });
    await waitFor(() => expect(result.current.user?.id).toBe(secondSession.user.id));
    expect(reads).toBe(2);
    expect(
      fetcher.mock.calls.filter(([path]) => path.endsWith('/auth/wallet/verify')),
    ).toHaveLength(1);
  });
  it.each<{ name: string; invoke: (auth: AuthState) => Promise<void> }>([
    { name: 'login', invoke: (auth) => auth.login('old@example.test', 'Example2026!') },
    {
      name: 'register',
      invoke: (auth) =>
        auth.register({
          email: 'old@example.test',
          password: 'Example2026!',
          name: '旧账号',
          handle: 'old_account',
        }),
    },
    { name: 'logout', invoke: (auth) => auth.logout() },
    {
      name: 'loginWallet',
      invoke: async (auth) => {
        await auth.loginWallet({
          id: 'challenge_one',
          message: 'message',
          signature: 'signature',
          contextGeneration: 'test_context',
          expectedEpoch: accountEpoch(),
        });
      },
    },
    { name: 'updateProfile', invoke: (auth) => auth.updateProfile({ name: '旧页面的编辑' }) },
  ])(
    'rejects retained $name after provider A unmounts without sending requests as account B',
    async ({ invoke }) => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response(secondSession));
      authFetch(fetcher);
      const first = renderHook(() => useAuth(), { wrapper: AuthProvider });
      await waitFor(() => expect(first.result.current.user?.id).toBe(session.user.id));
      const oldAuth = first.result.current;
      first.unmount();
      const second = renderHook(() => useAuth(), { wrapper: AuthProvider });
      await waitFor(() => expect(second.result.current.user?.id).toBe(secondSession.user.id));
      await expect(invoke(oldAuth)).rejects.toThrow('账号页面已关闭');
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(expectedAccount()).toBe(secondSession.user.id);
      expect(second.result.current.user?.id).toBe(secondSession.user.id);
    },
  );

  it('never dispatches a queued refresh after its pending mutation provider unmounts', async () => {
    let finish!: (value: Response) => void;
    let reads = 0;
    const fetcher = vi.fn().mockImplementation((path: string) =>
      path.endsWith('/auth/me')
        ? Promise.resolve(response(++reads === 1 ? session : secondSession))
        : new Promise<Response>((resolve) => {
            finish = resolve;
          }),
    );
    authFetch(fetcher);
    const first = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(first.result.current.user?.id).toBe(session.user.id));
    let mutation!: Promise<void>;
    act(() => {
      mutation = first.result.current.login('old@example.test', 'Example2026!');
    });
    await act(async () => first.result.current.refresh());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    first.unmount();
    const second = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(second.result.current.user?.id).toBe(secondSession.user.id));
    await act(async () => {
      finish(response(session));
      await mutation;
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(expectedAccount()).toBe(secondSession.user.id);
    expect(second.result.current.user?.id).toBe(secondSession.user.id);
  });

  it('rechecks the successful login cookie when a protected 401 invalidates the pending auth mutation', async () => {
    let finishLogin!: (value: Response) => void;
    let reads = 0;
    const fetcher = vi.fn().mockImplementation((path: string) => {
      if (path.endsWith('/auth/me'))
        return Promise.resolve(response(++reads === 1 ? session : secondSession));
      if (path.endsWith('/auth/login'))
        return new Promise<Response>((resolve) => {
          finishLogin = resolve;
        });
      return Promise.resolve(response({ code: 'unauthorized', message: '原会话已撤销' }, 401));
    });
    authFetch(fetcher);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.user?.id).toBe(session.user.id));
    let login!: Promise<void>;
    act(() => {
      login = result.current.login('new@example.test', 'Example2026!');
    });
    await waitFor(() => expect(finishLogin).toBeTypeOf('function'));
    await act(async () => {
      await apiRequest('/posts/one/like', { method: 'POST' }).catch(() => {});
    });
    expect(result.current.status).toBe('guest');
    await act(async () => {
      finishLogin(response(secondSession));
      await login;
    });
    await waitFor(() => expect(result.current.user?.id).toBe(secondSession.user.id));
    expect(result.current.status).toBe('authenticated');
    expect(expectedAccount()).toBe(secondSession.user.id);
    expect(reads).toBe(2);
    expect(
      fetcher.mock.calls.filter(([path]) => String(path).endsWith('/auth/login')),
    ).toHaveLength(1);
  });

  it('rechecks the new login cookie after the previous session expires while login is pending', async () => {
    vi.useFakeTimers();
    const expiring = { ...session, expiresAt: new Date(Date.now() + 1000).toISOString() };
    let finishLogin!: (value: Response) => void;
    let reads = 0;
    const fetcher = vi.fn().mockImplementation((path: string) =>
      path.endsWith('/auth/me')
        ? Promise.resolve(response(++reads === 1 ? expiring : secondSession))
        : new Promise<Response>((resolve) => {
            finishLogin = resolve;
          }),
    );
    authFetch(fetcher);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await act(async () => {});
    expect(result.current.user?.id).toBe(session.user.id);
    let login!: Promise<void>;
    act(() => {
      login = result.current.login('new@example.test', 'Example2026!');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.status).toBe('guest');
    expect(result.current.error).toBe('登录已到期，请重新登录');
    await act(async () => {
      finishLogin(response(secondSession));
      await login;
    });
    expect(result.current.status).toBe('authenticated');
    expect(result.current.user?.id).toBe(secondSession.user.id);
    expect(result.current.error).toBe('');
    expect(expectedAccount()).toBe(secondSession.user.id);
    expect(reads).toBe(2);
    expect(
      fetcher.mock.calls.filter(([path]) => String(path).endsWith('/auth/login')),
    ).toHaveLength(1);
  });

  it('keeps an authenticated account during a temporary validation network failure', async () => {
    authFetch(
      vi.fn().mockResolvedValueOnce(response(session)).mockRejectedValue(new TypeError('offline')),
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('authenticated:示例成员');
    fireEvent.click(screen.getByRole('button', { name: '重查' }));
    await screen.findByText(/无法连接服务/);
    expect(screen.getByText('authenticated:示例成员')).toBeInTheDocument();
  });
  it('checks cookie session and stays guest without automatically using demo credentials', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response({ code: 'unauthorized', message: '请登录' }, 401));
    authFetch(fetchMock);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('guest:guest');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/auth/me');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include' });
  });

  it('marks API unavailable without fabricating a member identity', async () => {
    authFetch(vi.fn().mockRejectedValue(new TypeError('offline')));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('unavailable:guest');
    expect(screen.getByText(/无法连接服务/)).toBeInTheDocument();
  });

  it('does not let an older session check overwrite a new successful login', async () => {
    let finishMe!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementation((path: string) =>
      path.endsWith('/auth/me')
        ? new Promise<Response>((resolve) => {
            finishMe = resolve;
          })
        : Promise.resolve(response(session)),
    );
    authFetch(fetchMock);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await screen.findByText('authenticated:示例成员');
    await act(async () => {
      finishMe?.(response({ code: 'unauthorized', message: '旧检查' }, 401));
    });
    expect(screen.getByText('authenticated:示例成员')).toBeInTheDocument();
  });

  it('clears private account state when a protected request returns 401', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((path: string) =>
        Promise.resolve(
          path.endsWith('/auth/me')
            ? response(session)
            : response({ code: 'unauthorized', message: 'expired' }, 401),
        ),
      );
    authFetch(fetchMock);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('authenticated:示例成员');
    await act(async () => {
      await apiRequest('/posts/one/like', { method: 'POST' }).catch(() => {});
    });
    expect(screen.getByText('guest:guest')).toBeInTheDocument();
    expect(screen.getByText('登录已失效，请重新登录')).toBeInTheDocument();
  });

  it('expires cookie-backed UI sessions at the server expiry time', async () => {
    const expiresAt = new Date(Date.now() + 1000).toISOString();
    authFetch(vi.fn().mockResolvedValue(response({ ...session, expiresAt })));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('authenticated:示例成员')).toBeInTheDocument());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 1100));
    });
    expect(screen.getByText('guest:guest')).toBeInTheDocument();
    expect(screen.getByText('登录已到期，请重新登录')).toBeInTheDocument();
  });
});
