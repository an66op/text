import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import {
  advanceAccountEpoch,
  expectedAccount,
  setExpectedAccount,
} from '../../src/shared/api/account-guard';
import type { Session } from './types';
import SessionProvider from './SessionProvider';
import { useSession } from './use-session';
import { API_TIMEOUT_MS } from '../../src/shared/api/request-deadline';

const first: Session = {
  user: {
    id: 'operator-A',
    handle: 'operator_a',
    name: '运营甲',
    email: 'a@example.test',
    avatar: '',
    bio: '',
    role: 'admin',
    status: 'active',
    createdAt: '2026-10-27T08:00:00Z',
  },
  expiresAt: '2099-10-27T08:00:00Z',
};
const second: Session = {
  ...first,
  user: { ...first.user, id: 'operator-B', name: '运营乙', handle: 'operator_b' },
};
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(status >= 400 ? { error: data } : { data }), { status });
const contextResponse = () =>
  response({ generation: 'context-version-1', expiresAt: '2099-12-31T00:00:00Z' });
function Probe() {
  const state = useSession();
  const [operationError, setOperationError] = useState('');
  return (
    <>
      <output>
        {state.status}:{state.session?.user.name ?? 'guest'}
      </output>
      <p>{state.error}</p>
      <p>{state.expired ? '已失效' : ''}</p>
      <p>{operationError}</p>
      <button
        onClick={() =>
          void state
            .login('b@example.test', 'Example2026!')
            .catch((error: Error) => setOperationError(error.message))
        }
      >
        切换账号
      </button>
      <button
        onClick={() =>
          void state.logout().catch((error: Error) => setOperationError(error.message))
        }
      >
        退出账号
      </button>
      <button onClick={() => void state.refresh()}>重新验证</button>
    </>
  );
}
const view = () =>
  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setExpectedAccount('');
});

describe('operator session lifecycle', () => {
  it('reads the actual shared-cookie identity after an uncertain logout result without replaying the write', async () => {
    vi.useFakeTimers();
    let reads = 0;
    const fetcher = vi.fn().mockImplementation((path: string) => {
      if (path.endsWith('/auth/context')) return Promise.resolve(contextResponse());
      if (path.endsWith('/auth/logout')) return new Promise(() => {});
      return Promise.resolve(response(++reads === 1 ? first : second));
    });
    vi.stubGlobal('fetch', fetcher);
    view();
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: '退出账号' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
    });
    expect(screen.getByText('authenticated:运营乙')).toBeInTheDocument();
    expect(screen.getByText(/操作可能已完成/)).toBeInTheDocument();
    expect(
      fetcher.mock.calls.filter(([path]) => String(path).endsWith('/auth/logout')),
    ).toHaveLength(1);
    expect(reads).toBe(2);
  });
  it('bootstraps the browser context before reading identity and uses a new CAS read for every explicit auth operation', async () => {
    let contexts = 0;
    const fetcher = vi.fn().mockImplementation((path: string) => {
      if (path.endsWith('/auth/context'))
        return Promise.resolve(
          response({ generation: `version-${++contexts}`, expiresAt: '2099-12-31T00:00:00Z' }),
        );
      if (path.endsWith('/auth/logout')) return Promise.resolve(response({ ok: true }));
      return Promise.resolve(response(path.endsWith('/auth/login') ? second : first));
    });
    vi.stubGlobal('fetch', fetcher);
    view();
    await screen.findByText('authenticated:运营甲');
    expect(fetcher.mock.calls.slice(0, 2).map(([path]) => path)).toEqual([
      '/api/v1/auth/context',
      '/api/v1/auth/me',
    ]);
    expect(new Headers(fetcher.mock.calls[0][1].headers).get('X-Gongming-Browser')).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: '切换账号' }));
    await screen.findByText('authenticated:运营乙');
    fireEvent.click(screen.getByRole('button', { name: '退出账号' }));
    await screen.findByText('anonymous:guest');
    const writes = fetcher.mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(writes).toHaveLength(2);
    expect(new Headers(writes[0][1].headers).get('X-Gongming-Auth-Generation')).toBe('version-2');
    expect(new Headers(writes[1][1].headers).get('X-Gongming-Auth-Generation')).toBe('version-3');
    for (const [, options] of writes)
      expect(new Headers(options.headers).get('X-Gongming-Browser')).toBe('1');
  });

  it('does not retry a conflicting logout and reads the identity currently held by the shared browser', async () => {
    let reads = 0;
    const fetcher = vi.fn().mockImplementation((path: string) => {
      if (path.endsWith('/auth/context')) return Promise.resolve(contextResponse());
      if (path.endsWith('/auth/logout'))
        return Promise.resolve(
          response({ code: 'auth_context_changed', message: 'conflict' }, 409),
        );
      return Promise.resolve(response(++reads === 1 ? first : second));
    });
    vi.stubGlobal('fetch', fetcher);
    view();
    await screen.findByText('authenticated:运营甲');
    fireEvent.click(screen.getByRole('button', { name: '退出账号' }));
    await screen.findByText('authenticated:运营乙');
    expect(screen.getByText(/浏览器登录状态已变化/)).toBeInTheDocument();
    expect(
      fetcher.mock.calls.filter(([path]) => String(path).endsWith('/auth/logout')),
    ).toHaveLength(1);
    expect(expectedAccount()).toBe(second.user.id);
  });

  it('never sends the auth write when its context preparation completes after account epoch changes', async () => {
    let finish!: (value: Response) => void;
    let contexts = 0;
    const fetcher = vi.fn().mockImplementation((path: string) => {
      if (path.endsWith('/auth/context'))
        return ++contexts === 1
          ? Promise.resolve(contextResponse())
          : new Promise<Response>((resolve) => {
              finish = resolve;
            });
      return Promise.resolve(response(first));
    });
    vi.stubGlobal('fetch', fetcher);
    view();
    await screen.findByText('authenticated:运营甲');
    fireEvent.click(screen.getByRole('button', { name: '切换账号' }));
    advanceAccountEpoch();
    await act(async () => finish(contextResponse()));
    expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    expect(screen.getByText('账号状态已变化，请重新确认后操作。')).toBeInTheDocument();
  });

  it('cancels a pending context read on unmount without sending credentials', async () => {
    let finish!: (value: Response) => void;
    let contexts = 0;
    const fetcher = vi.fn().mockImplementation((path: string) => {
      if (path.endsWith('/auth/context'))
        return ++contexts === 1
          ? Promise.resolve(contextResponse())
          : new Promise<Response>((resolve) => {
              finish = resolve;
            });
      return Promise.resolve(response(first));
    });
    vi.stubGlobal('fetch', fetcher);
    const page = view();
    await screen.findByText('authenticated:运营甲');
    fireEvent.click(screen.getByRole('button', { name: '切换账号' }));
    const signal = fetcher.mock.calls.at(-1)![1].signal as AbortSignal;
    page.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => finish(contextResponse()));
    expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });
  it('keeps a successful login when the original session read arrives later', async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((path: string) =>
        path.endsWith('/auth/context')
          ? Promise.resolve(contextResponse())
          : path.endsWith('/auth/me')
            ? new Promise<Response>((resolve) => {
                finish = resolve;
              })
            : Promise.resolve(response(second)),
      ),
    );
    view();
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path).endsWith('/auth/me'))).toBe(
        true,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '切换账号' }));
    await screen.findByText('authenticated:运营乙');
    await act(async () => {
      finish(response(first));
    });
    expect(screen.getByText('authenticated:运营乙')).toBeInTheDocument();
    expect(expectedAccount()).toBe(second.user.id);
  });

  it('retains the known operator during a temporary network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(contextResponse())
        .mockResolvedValueOnce(response(first))
        .mockRejectedValue(new TypeError('offline')),
    );
    view();
    await screen.findByText('authenticated:运营甲');
    fireEvent.click(screen.getByRole('button', { name: '重新验证' }));
    await screen.findByText(/无法连接服务/);
    expect(screen.getByText('authenticated:运营甲')).toBeInTheDocument();
    expect(expectedAccount()).toBe(first.user.id);
  });

  it('does not run a queued refresh from an unmounted provider or overwrite the next application identity', async () => {
    let finish!: (value: Response) => void;
    const fetch = vi.fn().mockImplementation((path: string) =>
      path.endsWith('/auth/context')
        ? Promise.resolve(contextResponse())
        : path.endsWith('/auth/me')
          ? Promise.resolve(response(first))
          : new Promise<Response>((resolve) => {
              finish = resolve;
            }),
    );
    vi.stubGlobal('fetch', fetch);
    const page = view();
    await screen.findByText('authenticated:运营甲');
    fireEvent.click(screen.getByRole('button', { name: '切换账号' }));
    await waitFor(() =>
      expect(fetch.mock.calls.some(([path]) => String(path).endsWith('/auth/login'))).toBe(true),
    );
    fireEvent.click(screen.getByRole('button', { name: '重新验证' }));
    page.unmount();
    setExpectedAccount('next-provider-account');
    await act(async () => {
      finish(response(second));
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(expectedAccount()).toBe('next-provider-account');
  });

  it('revalidates the new login cookie after the original session expires during a pending login', async () => {
    vi.useFakeTimers();
    const expiring = { ...first, expiresAt: new Date(Date.now() + 1000).toISOString() };
    let finishLogin!: (value: Response) => void;
    let reads = 0;
    const fetcher = vi.fn().mockImplementation((path: string) =>
      path.endsWith('/auth/context')
        ? Promise.resolve(contextResponse())
        : path.endsWith('/auth/me')
          ? Promise.resolve(response(++reads === 1 ? expiring : second))
          : new Promise<Response>((resolve) => {
              finishLogin = resolve;
            }),
    );
    vi.stubGlobal('fetch', fetcher);
    view();
    await act(async () => {});
    expect(screen.getByText('authenticated:运营甲')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '切换账号' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText('anonymous:guest')).toBeInTheDocument();
    expect(screen.getByText('已失效')).toBeInTheDocument();
    await act(async () => {
      finishLogin(response(second));
    });
    expect(screen.getByText('authenticated:运营乙')).toBeInTheDocument();
    expect(screen.queryByText('已失效')).not.toBeInTheDocument();
    expect(expectedAccount()).toBe(second.user.id);
    expect(reads).toBe(2);
    expect(
      fetcher.mock.calls.filter(([path]) => String(path).endsWith('/auth/login')),
    ).toHaveLength(1);
  });

  it('revalidates a visible idle console and clears a revoked session', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(contextResponse())
        .mockResolvedValueOnce(response(first))
        .mockResolvedValue(response({ code: 'unauthorized' }, 401)),
    );
    view();
    await act(async () => {});
    expect(screen.getByText('authenticated:运营甲')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(screen.getByText('anonymous:guest')).toBeInTheDocument();
    expect(screen.getByText('已失效')).toBeInTheDocument();
    expect(expectedAccount()).toBe('');
  });
});
