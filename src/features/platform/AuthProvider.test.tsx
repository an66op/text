import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@/shared/api/client';
import { expectedAccount } from '@/shared/api/account-guard';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './useAuth';
import { otherMember, session } from './platform-test-fixtures';
import type { AuthState } from './auth-context';

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
const secondSession = { ...session, user: otherMember };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('server authentication lifecycle', () => {
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
    { name: 'updateProfile', invoke: (auth) => auth.updateProfile({ name: '旧页面的编辑' }) },
  ])(
    'rejects retained $name after provider A unmounts without sending requests as account B',
    async ({ invoke }) => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response(secondSession));
      vi.stubGlobal('fetch', fetcher);
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
    vi.stubGlobal('fetch', fetcher);
    const first = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(first.result.current.user?.id).toBe(session.user.id));
    let mutation!: Promise<void>;
    act(() => {
      mutation = first.result.current.login('old@example.test', 'Example2026!');
    });
    await act(async () => first.result.current.refresh());
    expect(fetcher).toHaveBeenCalledTimes(2);
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
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.user?.id).toBe(session.user.id));
    let login!: Promise<void>;
    act(() => {
      login = result.current.login('new@example.test', 'Example2026!');
    });
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
    vi.stubGlobal('fetch', fetcher);
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
    vi.stubGlobal(
      'fetch',
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
    vi.stubGlobal('fetch', fetchMock);
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
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
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
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await screen.findByText('authenticated:示例成员');
    await act(async () => {
      finishMe(response({ code: 'unauthorized', message: '旧检查' }, 401));
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
    vi.stubGlobal('fetch', fetchMock);
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...session, expiresAt })));
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
