import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBrowserWallet, type WalletProvider } from './useBrowserWallet';
const address = '0x' + '12'.repeat(20),
  other = '0x' + '34'.repeat(20);
function provider() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const request = vi.fn<WalletProvider['request']>(async ({ method }) =>
    method === 'eth_chainId' ? '0x20000000000001' : [address],
  );
  return {
    request,
    on: (name: string, fn: (...args: unknown[]) => void) => {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name)!.add(fn);
    },
    removeListener: (name: string, fn: (...args: unknown[]) => void) => {
      handlers.get(name)?.delete(fn);
    },
    emit: (name: string, value?: unknown) => handlers.get(name)?.forEach((fn) => fn(value)),
  };
}
afterEach(() => {
  delete (window as Window & { ethereum?: unknown }).ethereum;
  vi.restoreAllMocks();
});
describe('browser wallet identity lifetime', () => {
  it('checks synchronous wallet state between a completed async validation and the signing prompt', async () => {
    const wallet = provider(),
      original = wallet.request.getMockImplementation()!;
    let chains = 0;
    wallet.request.mockImplementation((input) => {
      if (input.method === 'eth_chainId' && ++chains === 2)
        queueMicrotask(() => queueMicrotask(() => wallet.emit('accountsChanged', [other])));
      return original(input);
    });
    (window as Window & { ethereum?: unknown }).ethereum = wallet;
    const { result } = renderHook(() => useBrowserWallet());
    await act(async () => result.current.connect('injected'));
    const snapshot = result.current.snapshot();
    await act(async () => {
      await expect(result.current.signMessage(snapshot, 'Old preview')).rejects.toThrow(
        '钱包状态已变化',
      );
    });
    expect(wallet.request.mock.calls.some(([input]) => input.method === 'personal_sign')).toBe(
      false,
    );
  });
  it('single-flights same-tick connect and keeps chain IDs exact above Number.MAX_SAFE_INTEGER', async () => {
    const wallet = provider();
    (window as Window & { ethereum?: unknown }).ethereum = wallet;
    const { result } = renderHook(() => useBrowserWallet());
    await act(async () => {
      await Promise.all([result.current.connect('injected'), result.current.connect('injected')]);
    });
    expect(
      wallet.request.mock.calls.filter(([arg]) => arg.method === 'eth_requestAccounts'),
    ).toHaveLength(1);
    expect(result.current.chainId).toBe('9007199254740993');
  });
  it.each(['disconnect', 'unmount'])(
    'does not revive a delayed connect after %s',
    async (action) => {
      const wallet = provider();
      let finish!: (value: unknown) => void;
      wallet.request.mockImplementation(async ({ method }) =>
        method === 'eth_requestAccounts'
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : method === 'eth_chainId'
            ? '0x1'
            : [address],
      );
      (window as Window & { ethereum?: unknown }).ethereum = wallet;
      const { result, unmount } = renderHook(() => useBrowserWallet());
      let operation!: Promise<void>;
      act(() => {
        operation = result.current.connect('injected');
      });
      if (action === 'unmount') unmount();
      else act(() => result.current.disconnect());
      await act(async () => {
        finish([address]);
        await operation;
      });
      expect(result.current.address).toBe('');
      expect(
        wallet.request.mock.calls.filter(([arg]) => arg.method === 'eth_accounts'),
      ).toHaveLength(0);
    },
  );
  it('rejects a signature when the wallet changes A→B→A while its prompt is pending', async () => {
    const wallet = provider();
    let finish!: (value: unknown) => void;
    const request = wallet.request.getMockImplementation()!;
    wallet.request.mockImplementation((input) =>
      input.method === 'personal_sign'
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : request(input),
    );
    (window as Window & { ethereum?: unknown }).ethereum = wallet;
    const { result } = renderHook(() => useBrowserWallet());
    await act(async () => result.current.connect('injected'));
    const snapshot = result.current.snapshot();
    let signature!: Promise<string>;
    act(() => {
      signature = result.current.signMessage(snapshot, 'Preview exactly this message');
    });
    const caught = signature.catch((error) => error);
    await act(async () => {});
    expect(finish).toBeTypeOf('function');
    act(() => {
      wallet.emit('accountsChanged', [other]);
      wallet.emit('accountsChanged', [address]);
    });
    await act(async () => {
      finish('0x' + '11'.repeat(65));
    });
    expect(await caught).toBeInstanceOf(Error);
    expect(result.current.snapshot().version).not.toBe(snapshot.version);
    await expect(result.current.ensureSnapshot(snapshot)).rejects.toThrow('钱包状态已变化');
  });
  it('invalidates a snapshot even when a chain event returns to the original chain', async () => {
    const wallet = provider();
    (window as Window & { ethereum?: unknown }).ethereum = wallet;
    const { result } = renderHook(() => useBrowserWallet());
    await act(async () => result.current.connect('injected'));
    const snapshot = result.current.snapshot();
    act(() => {
      wallet.emit('chainChanged', '0x1');
      wallet.emit('chainChanged', '0x20000000000001');
    });
    await expect(result.current.ensureSnapshot(snapshot)).rejects.toThrow('钱包状态已变化');
  });
  it('does not revive or clear a new connection when an old disconnected signing prompt returns', async () => {
    const wallet = provider();
    let finish!: (value: unknown) => void;
    const original = wallet.request.getMockImplementation()!;
    wallet.request.mockImplementation((input) =>
      input.method === 'personal_sign'
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : original(input),
    );
    (window as Window & { ethereum?: unknown }).ethereum = wallet;
    const { result } = renderHook(() => useBrowserWallet());
    await act(async () => result.current.connect('injected'));
    let signing!: Promise<string>;
    const old = result.current.snapshot();
    act(() => {
      signing = result.current.signMessage(old, 'Confirm identity');
    });
    const caught = signing.catch((error) => error);
    await act(async () => {});
    act(() => result.current.disconnect());
    await act(async () => result.current.connect('injected'));
    const fresh = result.current.snapshot();
    await act(async () => {
      finish('0x' + '11'.repeat(65));
    });
    expect(await caught).toBeInstanceOf(Error);
    expect(result.current.snapshot()).toEqual(fresh);
    expect(result.current.snapshot().version).not.toBe(old.version);
    expect(result.current.busy).toBe(false);
  });
  it('does not treat public connection as a signing request and encodes only an explicitly supplied message', async () => {
    const wallet = provider();
    const original = wallet.request.getMockImplementation()!;
    wallet.request.mockImplementation((input) =>
      input.method === 'personal_sign' ? Promise.resolve('0x' + '11'.repeat(65)) : original(input),
    );
    (window as Window & { ethereum?: unknown }).ethereum = wallet;
    const { result } = renderHook(() => useBrowserWallet());
    await act(async () => result.current.connect('injected'));
    expect(wallet.request.mock.calls.some(([arg]) => arg.method === 'personal_sign')).toBe(false);
    await act(async () => {
      await result.current.signMessage(result.current.snapshot(), '你好');
    });
    expect(wallet.request).toHaveBeenCalledWith({
      method: 'personal_sign',
      params: ['0xe4bda0e5a5bd', address],
    });
  });
});
export type TestProvider = WalletProvider;
