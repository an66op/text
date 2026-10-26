import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthState } from '@/features/platform/auth-context';
import { member, otherMember, signedIn } from '@/features/platform/platform-test-fixtures';
import { advanceAccountEpoch } from '@/shared/api/account-guard';
import { ApiError } from '@/shared/api/client';
import WalletBindingsPage from './WalletBindingsPage';
import { walletIdentityApi } from './api';
import {
  deferred,
  otherAddress,
  prepared,
  testAddress,
  testWallet,
  walletConfig,
} from './test-helpers';
import type { BindingsResult } from './types';
const binding = { id: 'binding_one', address: testAddress, boundAt: '2026-10-27T08:00:00Z' };
const list: BindingsResult = { items: [binding], maxBindings: 5, hasPassword: true };
function scene(auth = signedIn()) {
  return (
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <WalletBindingsPage />
      </AuthContext.Provider>
    </MemoryRouter>
  );
}
async function confirm() {
  fireEvent.click(await screen.findByRole('button', { name: '解绑' }));
  fireEvent.change(screen.getByLabelText('解绑密码'), { target: { value: 'Example2026!' } });
  fireEvent.click(screen.getByRole('button', { name: '确认解绑' }));
}
beforeEach(() => {
  vi.spyOn(walletIdentityApi, 'config').mockResolvedValue(walletConfig);
  vi.spyOn(walletIdentityApi, 'bindings').mockResolvedValue(list);
});
afterEach(() => {
  delete (window as Window & { ethereum?: unknown }).ethereum;
  vi.restoreAllMocks();
});
describe('wallet binding server authority', () => {
  it('treats an invalid HTTP success receipt after unbind as unconfirmed and reads authoritative state', async () => {
    vi.spyOn(walletIdentityApi, 'unbind').mockRejectedValue(
      new ApiError('无法识别的成功响应', 'INVALID_RESPONSE', 200),
    );
    const refresh = vi.fn();
    render(scene({ ...signedIn(), refresh }));
    await confirm();
    await screen.findByText('解绑结果尚未确认，请先刷新绑定记录与当前身份');
    expect(refresh).toHaveBeenCalledOnce();
    expect(walletIdentityApi.bindings).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: '解绑' })).toBeDisabled();
  });
  it('blocks all credential writes after an unknown unbind until a successful explicit read', async () => {
    const old = deferred<BindingsResult>(),
      refresh = vi.fn();
    const unbind = vi
      .spyOn(walletIdentityApi, 'unbind')
      .mockRejectedValue(new ApiError('超时', 'TIMEOUT', 0));
    render(scene({ ...signedIn(), refresh }));
    await screen.findByText(testAddress);
    vi.mocked(walletIdentityApi.bindings).mockReturnValue(old.promise);
    await confirm();
    await screen.findByText('解绑结果尚未确认，请先刷新绑定记录与当前身份');
    expect(screen.getByRole('button', { name: '解绑' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '解绑' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(unbind).toHaveBeenCalledOnce();
    vi.mocked(walletIdentityApi.bindings).mockRejectedValue(
      new ApiError('断线', 'NETWORK_ERROR', 0),
    );
    fireEvent.click(screen.getByRole('button', { name: '刷新确认解绑结果' }));
    await act(async () => old.resolve(list));
    await screen.findByText('仍未确认解绑结果，请检查连接后再次刷新');
    expect(screen.getByRole('button', { name: '解绑' })).toBeDisabled();
    vi.mocked(walletIdentityApi.bindings).mockResolvedValue(list);
    fireEvent.click(screen.getByRole('button', { name: '刷新确认解绑结果' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '解绑' })).toBeEnabled());
    expect(unbind).toHaveBeenCalledOnce();
  });
  it('reads actual saved bindings when a submitted bind is cancelled by a wallet event', async () => {
    const wallet = testWallet(),
      pending = deferred<{ binding: typeof binding }>(),
      refresh = vi.fn();
    vi.mocked(walletIdentityApi.bindings).mockResolvedValue({ ...list, items: [] });
    vi.spyOn(walletIdentityApi, 'challenge').mockResolvedValue(prepared('bind'));
    vi.spyOn(walletIdentityApi, 'bind').mockReturnValue(pending.promise);
    render(scene({ ...signedIn(), refresh }));
    await screen.findByText('尚未绑定钱包');
    fireEvent.click(await screen.findByRole('button', { name: '浏览器钱包' }));
    await screen.findByText(testAddress);
    fireEvent.change(screen.getByLabelText('当前账号密码'), { target: { value: 'Example2026!' } });
    fireEvent.click(screen.getByRole('button', { name: '获取签名请求' }));
    fireEvent.click(await screen.findByRole('button', { name: '签名并绑定' }));
    await waitFor(() => expect(walletIdentityApi.bind).toHaveBeenCalledOnce());
    vi.mocked(walletIdentityApi.bindings).mockResolvedValue(list);
    act(() => wallet.emit('accountsChanged', [otherAddress]));
    await screen.findByRole('button', { name: '解绑' });
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '刷新确认结果' })).toBeInTheDocument();
    await act(async () => pending.resolve({ binding }));
    expect(screen.queryByText('钱包已绑定当前账号')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '解绑' })).toBeInTheDocument();
  });
  it('keeps the binding until server confirmation, refreshes identity without logout when current sessions are revoked', async () => {
    const pending = deferred<{
        ok: true;
        revokedSessions: number;
        currentSessionRevoked: boolean;
      }>(),
      refresh = vi.fn(),
      logout = vi.fn();
    const unbind = vi.spyOn(walletIdentityApi, 'unbind').mockReturnValue(pending.promise);
    render(scene({ ...signedIn(), refresh, logout }));
    await confirm();
    expect(screen.getAllByText(testAddress)).toHaveLength(2);
    expect(refresh).not.toHaveBeenCalled();
    vi.mocked(walletIdentityApi.bindings).mockResolvedValue({ ...list, items: [] });
    await act(async () =>
      pending.resolve({ ok: true, revokedSessions: 2, currentSessionRevoked: true }),
    );
    await screen.findByText('尚未绑定钱包');
    expect(refresh).toHaveBeenCalledOnce();
    expect(logout).not.toHaveBeenCalled();
    expect(unbind).toHaveBeenCalledWith('binding_one', 'Example2026!', expect.any(AbortSignal));
  });
  it('keeps a denied binding and offers password correction without fake deletion', async () => {
    vi.spyOn(walletIdentityApi, 'unbind').mockRejectedValue(
      new ApiError('校验失败', 'wallet_proof_failed', 403),
    );
    render(scene());
    await confirm();
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByText('密码或钱包证明未通过，请核实后重试');
    expect(screen.getByRole('button', { name: '解绑' })).toBeInTheDocument();
    expect(screen.getAllByText(testAddress)).toHaveLength(2);
    expect(screen.queryByText('尚未绑定钱包')).not.toBeInTheDocument();
    expect(screen.getByLabelText('解绑密码')).toHaveValue('');
  });
  it('discards old-account unbind completion and cannot send its retained confirmation as account B', async () => {
    const pending = deferred<{
        ok: true;
        revokedSessions: number;
        currentSessionRevoked: boolean;
      }>(),
      refresh = vi.fn();
    const unbind = vi.spyOn(walletIdentityApi, 'unbind').mockReturnValue(pending.promise);
    const view = render(scene({ ...signedIn(member), refresh }));
    await confirm();
    advanceAccountEpoch();
    vi.mocked(walletIdentityApi.bindings).mockResolvedValue({
      ...list,
      items: [{ ...binding, id: 'binding_b', address: otherAddress }],
    });
    view.rerender(scene(signedIn(otherMember)));
    await screen.findByText(otherAddress);
    await act(async () =>
      pending.resolve({ ok: true, revokedSessions: 1, currentSessionRevoked: false }),
    );
    expect(screen.queryByText(/已解绑，已撤销/)).not.toBeInTheDocument();
    expect(screen.queryByText(testAddress)).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(unbind).toHaveBeenCalledOnce();
  });
  it('does not let an older binding read revive a successfully unbound credential', async () => {
    const old = deferred<BindingsResult>();
    let reads = 0;
    vi.mocked(walletIdentityApi.bindings).mockImplementation(() =>
      ++reads === 1
        ? Promise.resolve(list)
        : reads === 2
          ? old.promise
          : Promise.resolve({ ...list, items: [] }),
    );
    vi.spyOn(walletIdentityApi, 'unbind').mockResolvedValue({
      ok: true,
      revokedSessions: 0,
      currentSessionRevoked: false,
    });
    render(scene());
    await screen.findByText(testAddress);
    fireEvent.click(screen.getByRole('button', { name: '刷新钱包绑定' }));
    await waitFor(() => expect(reads).toBe(2));
    await confirm();
    await act(async () => old.resolve(list));
    await screen.findByText('尚未绑定钱包');
    expect(screen.queryByText(testAddress)).not.toBeInTheDocument();
    expect(reads).toBe(3);
  });
  it.each(['checking', 'unavailable', 'guest'] as const)(
    'shows explicit %s state without fetching private bindings',
    (state) => {
      const auth: AuthState = {
        ...signedIn(),
        user: null,
        status: state,
        error: state === 'unavailable' ? '服务不可达' : '',
      };
      render(scene(auth));
      expect(walletIdentityApi.bindings).not.toHaveBeenCalled();
      if (state === 'checking')
        expect(screen.getByRole('status')).toHaveTextContent('正在确认当前账号');
      if (state === 'unavailable')
        expect(screen.getByRole('alert')).toHaveTextContent('服务不可达');
      if (state === 'guest')
        expect(screen.getByRole('link', { name: '登录' })).toHaveAttribute(
          'href',
          '/login?returnTo=%2Faccount%2Fwallets',
        );
    },
  );
});
