import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectedAccount, setExpectedAccount } from '../../src/shared/api/account-guard';
import type { Session } from './types';
import SessionProvider from './SessionProvider';
import { useSession } from './use-session';

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
function Probe() {
  const state = useSession();
  return (
    <>
      <output>
        {state.status}:{state.session?.user.name ?? 'guest'}
      </output>
      <p>{state.error}</p>
      <p>{state.expired ? '已失效' : ''}</p>
      <button onClick={() => void state.login('b@example.test', 'Example2026!').catch(() => {})}>
        切换账号
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
  it('keeps a successful login when the original session read arrives later', async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((path: string) =>
        path.endsWith('/auth/me')
          ? new Promise<Response>((resolve) => {
              finish = resolve;
            })
          : Promise.resolve(response(second)),
      ),
    );
    view();
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
      vi.fn().mockResolvedValueOnce(response(first)).mockRejectedValue(new TypeError('offline')),
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
      path.endsWith('/auth/me')
        ? Promise.resolve(response(first))
        : new Promise<Response>((resolve) => {
            finish = resolve;
          }),
    );
    vi.stubGlobal('fetch', fetch);
    const page = view();
    await screen.findByText('authenticated:运营甲');
    fireEvent.click(screen.getByRole('button', { name: '切换账号' }));
    fireEvent.click(screen.getByRole('button', { name: '重新验证' }));
    page.unmount();
    setExpectedAccount('next-provider-account');
    await act(async () => {
      finish(response(second));
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(expectedAccount()).toBe('next-provider-account');
  });

  it('revalidates the new login cookie after the original session expires during a pending login', async () => {
    vi.useFakeTimers();
    const expiring = { ...first, expiresAt: new Date(Date.now() + 1000).toISOString() };
    let finishLogin!: (value: Response) => void;
    let reads = 0;
    const fetcher = vi.fn().mockImplementation((path: string) =>
      path.endsWith('/auth/me')
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
