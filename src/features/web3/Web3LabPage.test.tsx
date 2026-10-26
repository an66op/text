import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '@/shared/api/client';
import { AuthContext } from '@/features/platform/auth-context';
import { member, otherMember, signedIn } from '@/features/platform/platform-test-fixtures';
import type { PlatformUser } from '@/shared/api/types';
import Web3LabPage from './Web3LabPage';
import { pendingKey, readPending } from './pending-operation';
import type { TestWallet } from './wallet-model';

const wallet = (balance = '100000'): TestWallet => ({
  network: 'Gongming Testnet',
  assets: [{ symbol: 'GEM', name: '测试积分', balance, decimals: 2 }],
  address: 'gm_test_example',
  transactions: [],
});
const scene = (user: PlatformUser = member) => (
  <MemoryRouter>
    <AuthContext.Provider value={signedIn(user)}>
      <Web3LabPage />
    </AuthContext.Provider>
  </MemoryRouter>
);
beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('test ledger UI', () => {
  it('does not fetch private balances without an authenticated account', () => {
    const request = vi.spyOn(client, 'apiRequest');
    render(
      <MemoryRouter>
        <Web3LabPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: '登录' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fweb3',
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('recovers a lost faucet response after remount using exactly the same request ID', async () => {
    let balance = '0';
    let attempted = false;
    const request = vi.spyOn(client, 'apiRequest').mockImplementation(async (path, init) => {
      if (path === '/wallet') return wallet(balance) as never;
      if (!attempted) {
        attempted = true;
        throw new client.ApiError('响应丢失', 'NETWORK_ERROR', 0);
      }
      expect(JSON.parse(String(init?.body)).requestId).toBe(savedId);
      balance = '100000';
      return wallet(balance) as never;
    });
    const first = render(scene());
    await screen.findByRole('heading', { name: /^0\.00\s*GEM$/ });
    fireEvent.click(screen.getByRole('button', { name: '领取' }));
    await screen.findByText(/响应丢失/);
    const savedId = readPending(member.id)!.requestId;
    expect(savedId).toBeTruthy();
    first.unmount();
    render(scene());
    await screen.findByRole('button', { name: '确认 / 重试这笔请求' });
    expect(request.mock.calls.filter(([path]) => path === '/wallet/faucet')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '确认 / 重试这笔请求' }));
    await screen.findByText('1,000.00 测试 GEM 已到账');
    const writes = request.mock.calls.filter(([path]) => path === '/wallet/faucet');
    expect(writes).toHaveLength(2);
    expect(writes.map(([, init]) => JSON.parse(String(init?.body)).requestId)).toEqual([
      savedId,
      savedId,
    ]);
    expect(sessionStorage.getItem(pendingKey(member.id))).toBeNull();
  });

  it('does not display a previous account balance when its cancelled read resolves late', async () => {
    let finishOld!: (value: TestWallet) => void;
    let reads = 0;
    vi.spyOn(client, 'apiRequest').mockImplementation(
      () =>
        (++reads === 1
          ? new Promise<TestWallet>((resolve) => {
              finishOld = resolve;
            })
          : Promise.resolve(wallet('2500'))) as never,
    );
    const view = render(scene());
    view.rerender(scene(otherMember));
    await screen.findByRole('heading', { name: /^25\.00\s*GEM$/ });
    await act(async () => {
      finishOld(wallet('999999'));
    });
    expect(screen.getByRole('heading', { name: /^25\.00\s*GEM$/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^9,999\.99\s*GEM$/ })).not.toBeInTheDocument();
  });

  it('ignores a previous account transfer response after the account changes', async () => {
    let finishTransfer!: (value: TestWallet) => void;
    vi.spyOn(client, 'apiRequest').mockImplementation(
      (path) =>
        (path === '/wallet/transfer'
          ? new Promise<TestWallet>((resolve) => {
              finishTransfer = resolve;
            })
          : Promise.resolve(wallet('100000'))) as never,
    );
    const view = render(scene());
    await screen.findByRole('heading', { name: /^1,000\.00\s*GEM$/ });
    fireEvent.change(screen.getByRole('textbox', { name: '收款用户名' }), {
      target: { value: 'other' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /^测试 GEM 数量/ }), {
      target: { value: '1.29' },
    });
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认 / 重试这笔请求' }));
    view.rerender(scene(otherMember));
    await screen.findByRole('button', { name: '领取' });
    await act(async () => {
      finishTransfer(wallet('99871'));
    });
    expect(screen.queryByText(/已向 @other/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^1,000\.00\s*GEM$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '领取' })).toBeEnabled();
  });

  it('does not dispatch a write if the recovery identifier cannot be persisted', async () => {
    const request = vi.spyOn(client, 'apiRequest').mockResolvedValue(wallet());
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    render(scene());
    await screen.findByRole('heading', { name: /^1,000\.00\s*GEM$/ });
    fireEvent.click(screen.getByRole('button', { name: '领取' }));
    await screen.findByRole('alert');
    expect(request.mock.calls.filter(([path]) => path !== '/wallet')).toHaveLength(0);
    expect(screen.queryByText('1,000.00 测试 GEM 已到账')).not.toBeInTheDocument();
  });

  it('does not let a balance read started before transfer overwrite the newer ledger result', async () => {
    let finishOldRead!: (value: TestWallet) => void;
    let reads = 0;
    let balance = '100000';
    vi.spyOn(client, 'apiRequest').mockImplementation((path) => {
      if (path === '/wallet/transfer') {
        balance = '99971';
        return Promise.resolve(wallet(balance)) as never;
      }
      reads += 1;
      if (reads === 2)
        return new Promise<TestWallet>((resolve) => {
          finishOldRead = resolve;
        }) as never;
      return Promise.resolve(wallet(balance)) as never;
    });
    render(scene());
    await screen.findByRole('heading', { name: /^1,000\.00\s*GEM$/ });
    fireEvent.click(screen.getByRole('button', { name: '刷新测试账本' }));
    fireEvent.change(screen.getByRole('textbox', { name: '收款用户名' }), {
      target: { value: 'other' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /^测试 GEM 数量/ }), {
      target: { value: '0.29' },
    });
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认 / 重试这笔请求' }));
    await screen.findByRole('heading', { name: /^999\.71\s*GEM$/ });
    await act(async () => {
      finishOldRead(wallet('100000'));
    });
    expect(screen.getByRole('heading', { name: /^999\.71\s*GEM$/ })).toBeInTheDocument();
  });

  it('requires confirmation and submits exact cents to a valid long member handle', async () => {
    const request = vi.spyOn(client, 'apiRequest').mockResolvedValue(wallet());
    render(scene());
    await screen.findByRole('heading', { name: /^1,000\.00\s*GEM$/ });
    const handle = 'a'.repeat(30);
    fireEvent.change(screen.getByRole('textbox', { name: '收款用户名' }), {
      target: { value: handle },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /^测试 GEM 数量/ }), {
      target: { value: '0.29' },
    });
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    expect(request.mock.calls.filter(([path]) => path === '/wallet/transfer')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '确认 / 重试这笔请求' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/wallet/transfer',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const operation = request.mock.calls.find(([path]) => path === '/wallet/transfer')!;
    expect(JSON.parse(String(operation[1]?.body))).toMatchObject({
      recipientHandle: handle,
      amount: '29',
    });
  });
});
