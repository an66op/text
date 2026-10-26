import { useState } from 'react';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import SettingsRoutePage from '@/features/profile/SettingsRoutePage';
import { AuthContext, type AuthState } from '../auth-context';
import { member, otherMember, signedIn } from '../platform-test-fixtures';
import SessionDevicesPage from './SessionDevicesPage';
import { sessionApi } from './session-api';
import type { RevokeSessionResult, SessionDevice, SessionDevices } from './session-types';
import { useSessionDevices } from './useSessionDevices';

const current: SessionDevice = {
  id: 'session-current',
  device: 'Safari · macOS',
  current: true,
  legacy: false,
  createdAt: '2026-10-27T01:00:00Z',
  lastSeenAt: '2026-10-27T01:30:00Z',
  expiresAt: '2026-11-27T01:00:00Z',
};
const remote: SessionDevice = {
  ...current,
  id: 'session-remote',
  device: 'iPhone · Safari',
  current: false,
};
const legacy: SessionDevice = {
  ...remote,
  id: 'session-legacy',
  device: '',
  legacy: true,
  createdAt: null,
  lastSeenAt: null,
};
const page = (auth: AuthState = signedIn(), route = false) => (
  <MemoryRouter initialEntries={['/settings/devices']}>
    <AuthContext.Provider value={auth}>
      {route ? <SettingsRoutePage kind="devices" /> : <SessionDevicesPage />}
    </AuthContext.Provider>
  </MemoryRouter>
);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.spyOn(sessionApi, 'list').mockResolvedValue({ items: [current, remote, legacy], total: 3 });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('real login device management', () => {
  it('requires a concrete confirmation and removes a remote device only after the server confirms', async () => {
    const pending = deferred<RevokeSessionResult>();
    const revoke = vi.spyOn(sessionApi, 'revoke').mockReturnValue(pending.promise);
    render(page());
    await screen.findByRole('heading', { name: remote.device });
    fireEvent.click(screen.getByRole('button', { name: `撤销${remote.device}` }));
    const dialog = screen.getByRole('dialog', { name: `撤销${remote.device}？` });
    expect(dialog).toHaveTextContent('会话 n-remote');
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '确认撤销' }));
    expect(revoke).toHaveBeenCalledWith(remote.id, expect.any(AbortSignal));
    expect(screen.getByRole('heading', { name: remote.device })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '正在处理…' })).toBeDisabled();
    vi.mocked(sessionApi.list).mockResolvedValue({ items: [current, legacy], total: 2 });
    await act(async () => pending.resolve({ ok: true, current: false }));
    expect(screen.queryByRole('heading', { name: remote.device })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('当前设备')).toBeInTheDocument();
  });

  it('preserves the row and offers retry after permission denial instead of faking a deletion', async () => {
    const revoke = vi
      .spyOn(sessionApi, 'revoke')
      .mockRejectedValueOnce(new ApiError('没有撤销权限', 'forbidden', 403));
    render(page());
    await screen.findByRole('heading', { name: remote.device });
    fireEvent.click(screen.getByRole('button', { name: `撤销${remote.device}` }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认撤销' }));
    await screen.findByText('没有撤销权限');
    expect(screen.getByRole('heading', { name: remote.device })).toBeInTheDocument();
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: '确认撤销' }),
    ).toBeEnabled();
    revoke.mockResolvedValueOnce({ ok: true, current: false });
    vi.mocked(sessionApi.list).mockResolvedValue({ items: [current, legacy], total: 2 });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认撤销' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: remote.device })).not.toBeInTheDocument(),
    );
  });

  it('reviews the other-device count and keeps the current device after batch success', async () => {
    const revokeOthers = vi.spyOn(sessionApi, 'revokeOthers').mockResolvedValue({ revoked: 2 });
    render(page());
    await screen.findByRole('button', { name: '撤销其它 2 个设备' });
    fireEvent.click(screen.getByRole('button', { name: '撤销其它 2 个设备' }));
    const dialog = screen.getByRole('dialog', { name: '撤销其它 2 个设备？' });
    expect(dialog).toHaveTextContent('保留当前设备');
    expect(revokeOthers).not.toHaveBeenCalled();
    vi.mocked(sessionApi.list).mockResolvedValue({ items: [current], total: 1 });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认撤销' }));
    await screen.findByText('已撤销 2 个其它登录设备，当前设备已保留');
    expect(screen.getByRole('heading', { name: current.device })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: remote.device })).not.toBeInTheDocument();
  });

  it('revalidates into guest after current-device revocation and never sends logout', async () => {
    const logout = vi.fn();
    const refresh = vi.fn();
    vi.spyOn(sessionApi, 'revoke').mockResolvedValue({ ok: true, current: true });
    function App() {
      const [guest, setGuest] = useState(false);
      refresh.mockImplementation(async () => {
        setGuest(true);
      });
      return page({
        ...signedIn(),
        user: guest ? null : member,
        status: guest ? 'guest' : 'authenticated',
        refresh,
        logout,
      });
    }
    render(<App />);
    await screen.findByRole('button', { name: `撤销${current.device}（当前设备）` });
    fireEvent.click(screen.getByRole('button', { name: `撤销${current.device}（当前设备）` }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '撤销并退出此设备' }),
    );
    await screen.findByRole('link', { name: '登录' });
    expect(refresh).toHaveBeenCalledOnce();
    expect(logout).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: current.device })).not.toBeInTheDocument();
  });

  it('does not invent creation or activity timestamps for a legacy session', async () => {
    render(page());
    const title = await screen.findByRole('heading', { name: '旧会话' });
    const row = title.closest('article')!;
    expect(within(row).getAllByText('未记录')).toHaveLength(2);
    expect(within(row).getByText('最近验证')).toBeInTheDocument();
    expect(row).not.toHaveTextContent('最近活跃');
    expect(screen.getByText('当前设备')).toBeInTheDocument();
  });

  it('ignores an old account list and current-revocation result after switching accounts', async () => {
    const oldList = deferred<SessionDevices>();
    vi.mocked(sessionApi.list)
      .mockReturnValueOnce(oldList.promise)
      .mockResolvedValue({
        items: [{ ...current, id: 'bob-session', device: 'Bob 的设备' }],
        total: 1,
      });
    const view = render(page(signedIn()));
    const oldSignal = vi.mocked(sessionApi.list).mock.calls[0][0]!;
    view.rerender(page(signedIn(otherMember)));
    await screen.findByRole('heading', { name: 'Bob 的设备' });
    await act(async () => oldList.resolve({ items: [remote], total: 1 }));
    expect(oldSignal.aborted).toBe(true);
    expect(screen.queryByRole('heading', { name: remote.device })).not.toBeInTheDocument();
    const oldRevoke = deferred<RevokeSessionResult>();
    vi.spyOn(sessionApi, 'revoke').mockReturnValue(oldRevoke.promise);
    fireEvent.click(screen.getByRole('button', { name: '撤销Bob 的设备（当前设备）' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '撤销并退出此设备' }),
    );
    const refresh = vi.fn();
    vi.mocked(sessionApi.list).mockResolvedValue({ items: [current], total: 1 });
    view.rerender(page({ ...signedIn(), refresh }));
    await screen.findByRole('heading', { name: current.device });
    await act(async () => oldRevoke.resolve({ ok: true, current: true }));
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: current.device })).toBeInTheDocument();
    expect(screen.queryByText('当前设备已撤销，正在重新验证账号…')).not.toBeInTheDocument();
  });

  it('invalidates an old list before mutation so its delayed response cannot restore a revoked device', async () => {
    const { result } = renderHook(() => useSessionDevices(member.id, vi.fn()));
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    const oldList = deferred<SessionDevices>();
    vi.mocked(sessionApi.list).mockReturnValueOnce(oldList.promise);
    act(() => result.current.refresh());
    vi.spyOn(sessionApi, 'revoke').mockResolvedValue({ ok: true, current: false });
    vi.mocked(sessionApi.list).mockResolvedValue({ items: [current, legacy], total: 2 });
    await act(async () => {
      await result.current.revoke({ kind: 'one', device: remote });
    });
    await act(async () => oldList.resolve({ items: [current, remote, legacy], total: 3 }));
    expect(result.current.items.map((item) => item.id)).toEqual([current.id, legacy.id]);
  });

  it('keeps guest demonstration separate and never falls back to it when validation is unavailable', () => {
    const view = render(page({ ...signedIn(), user: null, status: 'guest' }, true));
    expect(screen.getByText('当前浏览器')).toBeInTheDocument();
    expect(
      screen.getByText('设备记录仅用于演示，不读取真实登录位置或远程会话。'),
    ).toBeInTheDocument();
    expect(sessionApi.list).not.toHaveBeenCalled();
    view.rerender(page({ ...signedIn(), user: null, status: 'checking' }, true));
    expect(screen.getByText('正在验证账号…')).toBeInTheDocument();
    expect(screen.queryByText('当前浏览器')).not.toBeInTheDocument();
    view.rerender(
      page({ ...signedIn(), user: null, status: 'unavailable', error: '账号服务不可达' }, true),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('账号服务不可达');
    expect(screen.queryByText('当前浏览器')).not.toBeInTheDocument();
  });
});
