import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@/shared/api/client';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './useAuth';
import { session } from './platform-test-fixtures';

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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('server authentication lifecycle', () => {
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
