import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthState } from '@/features/platform/auth-context';
import { signedIn, member, otherMember } from '@/features/platform/platform-test-fixtures';
import { ApiError } from '@/shared/api/client';
import { advanceAccountEpoch } from '@/shared/api/account-guard';
import { walletIdentityApi } from './api';
import WalletIdentityFlow from './WalletIdentityFlow';
import {
  deferred,
  otherAddress,
  prepared,
  testAddress,
  testWallet,
  walletConfig,
} from './test-helpers';
const onComplete = vi.fn(),
  onUnknown = vi.fn();
function scene(auth: AuthState, purpose: 'login' | 'bind' = 'login') {
  return (
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <WalletIdentityFlow
          purpose={purpose}
          config={walletConfig}
          onComplete={onComplete}
          onUnknown={onUnknown}
        />
      </AuthContext.Provider>
    </MemoryRouter>
  );
}
async function preview(purpose: 'login' | 'bind' = 'login') {
  fireEvent.click(screen.getByRole('button', { name: '浏览器钱包' }));
  await screen.findByText(testAddress);
  if (purpose === 'bind')
    fireEvent.change(screen.getByLabelText('当前账号密码'), { target: { value: 'Example2026!' } });
  fireEvent.click(screen.getByRole('button', { name: '获取签名请求' }));
  await screen.findByRole('region', { name: '完整签名内容' });
}
beforeEach(() => {
  onComplete.mockReset();
  onUnknown.mockReset();
});
afterEach(() => {
  delete (window as Window & { ethereum?: unknown }).ethereum;
  vi.restoreAllMocks();
});
describe('explicit wallet identity flow', () => {
  it('reconciles a successful bind receipt if the wallet changed before its continuation executes', async () => {
    const wallet = testWallet(),
      pending = deferred<{ binding: { id: string; address: string; boundAt: string } }>(),
      refresh = vi.fn();
    vi.spyOn(walletIdentityApi, 'challenge').mockResolvedValue(prepared('bind'));
    vi.spyOn(walletIdentityApi, 'bind').mockReturnValue(pending.promise);
    render(scene({ ...signedIn(), refresh }, 'bind'));
    await preview('bind');
    fireEvent.click(screen.getByRole('button', { name: '签名并绑定' }));
    await waitFor(() => expect(walletIdentityApi.bind).toHaveBeenCalledOnce());
    await act(async () => {
      pending.resolve({
        binding: { id: 'binding_one', address: testAddress, boundAt: new Date().toISOString() },
      });
      wallet.emit('accountsChanged', [otherAddress]);
    });
    expect(onComplete).not.toHaveBeenCalled();
    expect(onUnknown).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '刷新确认结果' })).toBeInTheDocument();
  });
  it('reconciles an invalid HTTP success receipt after bind instead of allowing another proof', async () => {
    testWallet();
    vi.spyOn(walletIdentityApi, 'challenge').mockResolvedValue(prepared('bind'));
    vi.spyOn(walletIdentityApi, 'bind').mockRejectedValue(
      new ApiError('无法识别的成功响应', 'INVALID_RESPONSE', 200),
    );
    render(scene(signedIn(), 'bind'));
    await preview('bind');
    fireEvent.click(screen.getByRole('button', { name: '签名并绑定' }));
    await screen.findByText('结果尚未确认，请刷新当前身份或绑定记录后再操作');
    expect(onUnknown).toHaveBeenCalledOnce();
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '获取签名请求' })).not.toBeInTheDocument();
  });
  it('rejects wallet changes in the final validation microtask before the actual bind call', async () => {
    const wallet = testWallet(),
      original = wallet.request.getMockImplementation()!;
    let chains = 0;
    wallet.request.mockImplementation((input) => {
      if (input.method === 'eth_chainId' && ++chains === 6)
        queueMicrotask(() => queueMicrotask(() => wallet.emit('accountsChanged', [otherAddress])));
      return original(input);
    });
    vi.spyOn(walletIdentityApi, 'challenge').mockResolvedValue(prepared('bind'));
    const bind = vi.spyOn(walletIdentityApi, 'bind');
    render(scene(signedIn(), 'bind'));
    await preview('bind');
    fireEvent.click(screen.getByRole('button', { name: '签名并绑定' }));
    await waitFor(() => expect(chains).toBe(6));
    await act(async () => {});
    expect(bind).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });
  it('shows the full unchanged server message and signs only after explicit confirmation, once for synchronous clicks', async () => {
    const wallet = testWallet(),
      value = prepared(),
      loginWallet = vi.fn().mockResolvedValue(true);
    vi.spyOn(walletIdentityApi, 'challenge').mockResolvedValue(value);
    render(scene({ ...signedIn(), user: null, status: 'guest', loginWallet }));
    await preview();
    expect(
      screen.getByText(
        (_, node) => node?.tagName === 'PRE' && node.textContent === value.challenge.message,
      ),
    ).toBeInTheDocument();
    expect(wallet.request.mock.calls.some(([arg]) => arg.method === 'personal_sign')).toBe(false);
    const button = screen.getByRole('button', { name: '签名并登录' });
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => expect(loginWallet).toHaveBeenCalledOnce());
    expect(loginWallet.mock.calls[0][0]).toMatchObject({
      id: value.challenge.id,
      message: value.challenge.message,
      signature: `0x${'11'.repeat(65)}`,
      contextGeneration: value.generation,
    });
    expect(onComplete).toHaveBeenCalledOnce();
    expect(
      wallet.request.mock.calls.filter(([arg]) => arg.method === 'personal_sign'),
    ).toHaveLength(1);
  });
  it('does not verify a signature returned after wallet A→B→A', async () => {
    const wallet = testWallet(),
      signature = deferred<unknown>(),
      original = wallet.request.getMockImplementation()!,
      loginWallet = vi.fn();
    wallet.request.mockImplementation((input) =>
      input.method === 'personal_sign' ? signature.promise : original(input),
    );
    vi.spyOn(walletIdentityApi, 'challenge').mockResolvedValue(prepared());
    render(scene({ ...signedIn(), loginWallet }));
    await preview();
    fireEvent.click(screen.getByRole('button', { name: '签名并登录' }));
    await waitFor(() =>
      expect(wallet.request.mock.calls.some(([arg]) => arg.method === 'personal_sign')).toBe(true),
    );
    act(() => {
      wallet.emit('accountsChanged', [otherAddress]);
      wallet.emit('accountsChanged', [testAddress]);
    });
    await act(async () => signature.resolve(`0x${'11'.repeat(65)}`));
    expect(loginWallet).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: '完整签名内容' })).not.toBeInTheDocument();
  });
  it('does not bind after the account changes while a signature is awaiting approval', async () => {
    const wallet = testWallet(),
      signature = deferred<unknown>(),
      original = wallet.request.getMockImplementation()!;
    wallet.request.mockImplementation((input) =>
      input.method === 'personal_sign' ? signature.promise : original(input),
    );
    vi.spyOn(walletIdentityApi, 'challenge').mockResolvedValue(prepared('bind'));
    const bind = vi.spyOn(walletIdentityApi, 'bind');
    const view = render(scene(signedIn(), 'bind'));
    await preview('bind');
    fireEvent.click(screen.getByRole('button', { name: '签名并绑定' }));
    await waitFor(() =>
      expect(wallet.request.mock.calls.some(([arg]) => arg.method === 'personal_sign')).toBe(true),
    );
    advanceAccountEpoch();
    view.rerender(scene(signedIn(otherMember), 'bind'));
    await act(async () => signature.resolve(`0x${'11'.repeat(65)}`));
    expect(bind).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });
  it('rejects mismatched server purpose before opening any signature prompt', async () => {
    const wallet = testWallet();
    vi.spyOn(walletIdentityApi, 'challenge').mockResolvedValue(prepared('bind'));
    render(scene(signedIn()));
    fireEvent.click(screen.getByRole('button', { name: '浏览器钱包' }));
    await screen.findByText(testAddress);
    fireEvent.click(screen.getByRole('button', { name: '获取签名请求' }));
    await screen.findByText(/签名内容与当前网站/);
    expect(wallet.request.mock.calls.some(([arg]) => arg.method === 'personal_sign')).toBe(false);
  });
  it('discards a challenge returned after the flow unmounts', async () => {
    const wallet = testWallet(),
      challenge = deferred<ReturnType<typeof prepared>>();
    vi.spyOn(walletIdentityApi, 'challenge').mockReturnValue(challenge.promise);
    const view = render(scene(signedIn()));
    fireEvent.click(screen.getByRole('button', { name: '浏览器钱包' }));
    await screen.findByText(testAddress);
    fireEvent.click(screen.getByRole('button', { name: '获取签名请求' }));
    await waitFor(() => expect(walletIdentityApi.challenge).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => challenge.resolve(prepared()));
    expect(wallet.request.mock.calls.some(([arg]) => arg.method === 'personal_sign')).toBe(false);
    expect(onComplete).not.toHaveBeenCalled();
  });
  it('reconciles an unknown bind result and requires a new request instead of automatically signing again', async () => {
    const wallet = testWallet(),
      refresh = vi.fn();
    vi.spyOn(walletIdentityApi, 'challenge').mockResolvedValue(prepared('bind'));
    const bind = vi
      .spyOn(walletIdentityApi, 'bind')
      .mockRejectedValue(new ApiError('超时', 'TIMEOUT', 0));
    render(scene({ ...signedIn(), refresh }, 'bind'));
    await preview('bind');
    fireEvent.click(screen.getByRole('button', { name: '签名并绑定' }));
    await screen.findByText('结果尚未确认，请刷新当前身份或绑定记录后再操作');
    expect(bind).toHaveBeenCalledOnce();
    expect(onUnknown).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    expect(onComplete).not.toHaveBeenCalled();
    expect(
      wallet.request.mock.calls.filter(([arg]) => arg.method === 'personal_sign'),
    ).toHaveLength(1);
    expect(screen.queryByRole('region', { name: '完整签名内容' })).not.toBeInTheDocument();
  });
  it('does not turn a rejected wallet prompt into a server request', async () => {
    const wallet = testWallet(),
      original = wallet.request.getMockImplementation()!;
    wallet.request.mockImplementation((input) =>
      input.method === 'personal_sign' ? Promise.reject({ code: 4001 }) : original(input),
    );
    const loginWallet = vi.fn();
    vi.spyOn(walletIdentityApi, 'challenge').mockResolvedValue(prepared());
    render(scene({ ...signedIn(member), loginWallet }));
    await preview();
    fireEvent.click(screen.getByRole('button', { name: '签名并登录' }));
    await screen.findByText('已取消钱包签名，可重新获取请求后再试');
    expect(loginWallet).not.toHaveBeenCalled();
  });
  it('reconciles a submitted bind when the provider changes, blocks new proofs until a successful explicit confirmation, and ignores its late success', async () => {
    const wallet = testWallet(),
      pending = deferred<{ binding: { id: string; address: string; boundAt: string } }>(),
      refresh = vi.fn();
    const challenge = vi.spyOn(walletIdentityApi, 'challenge').mockResolvedValue(prepared('bind'));
    vi.spyOn(walletIdentityApi, 'bind').mockReturnValue(pending.promise);
    onUnknown.mockResolvedValue(false);
    render(scene({ ...signedIn(), refresh }, 'bind'));
    await preview('bind');
    fireEvent.click(screen.getByRole('button', { name: '签名并绑定' }));
    await waitFor(() => expect(walletIdentityApi.bind).toHaveBeenCalledOnce());
    act(() => wallet.emit('accountsChanged', [otherAddress]));
    await screen.findByText('结果尚未确认，请刷新当前身份或绑定记录后再操作');
    expect(onUnknown).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: '获取签名请求' })).not.toBeInTheDocument();
    await act(async () =>
      pending.resolve({
        binding: { id: 'binding_one', address: testAddress, boundAt: new Date().toISOString() },
      }),
    );
    expect(onComplete).not.toHaveBeenCalled();
    expect(challenge).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '刷新确认结果' }));
    await screen.findByText('仍未确认绑定结果，请检查连接后再次刷新');
    expect(screen.queryByRole('button', { name: '获取签名请求' })).not.toBeInTheDocument();
    onUnknown.mockResolvedValue(true);
    fireEvent.click(screen.getByRole('button', { name: '刷新确认结果' }));
    await screen.findByRole('button', { name: '获取签名请求' });
    expect(challenge).toHaveBeenCalledOnce();
    expect(
      wallet.request.mock.calls.filter(([arg]) => arg.method === 'personal_sign'),
    ).toHaveLength(1);
  });
  it.each(['account', 'unmount'] as const)(
    'does not reconcile the old account after submitted bind and %s change',
    async (change) => {
      testWallet();
      const pending = deferred<{ binding: { id: string; address: string; boundAt: string } }>(),
        refresh = vi.fn();
      vi.spyOn(walletIdentityApi, 'challenge').mockResolvedValue(prepared('bind'));
      vi.spyOn(walletIdentityApi, 'bind').mockReturnValue(pending.promise);
      const view = render(scene({ ...signedIn(), refresh }, 'bind'));
      await preview('bind');
      fireEvent.click(screen.getByRole('button', { name: '签名并绑定' }));
      await waitFor(() => expect(walletIdentityApi.bind).toHaveBeenCalledOnce());
      if (change === 'unmount') view.unmount();
      else {
        advanceAccountEpoch();
        view.rerender(scene(signedIn(otherMember), 'bind'));
      }
      await act(async () =>
        pending.resolve({
          binding: { id: 'binding_one', address: testAddress, boundAt: new Date().toISOString() },
        }),
      );
      expect(onUnknown).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
      expect(onComplete).not.toHaveBeenCalled();
    },
  );
});
