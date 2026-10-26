import { useCallback, useEffect, useRef, useState } from 'react';
import { validAddress, validChain } from './wallet-model';

export type WalletProvider = {
  request: (input: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};
type WalletOption = { id: string; name: string; provider: WalletProvider };
export type WalletSnapshot = {
  provider: WalletProvider;
  address: string;
  chainId: string;
  version: number;
};
function isProvider(value: unknown): value is WalletProvider {
  return (
    !!value &&
    typeof value === 'object' &&
    'request' in value &&
    typeof value.request === 'function'
  );
}
const changed = () => new Error('钱包状态已变化，请重新连接并确认签名内容');
const addressOf = (value: unknown) =>
  Array.isArray(value) && validAddress(value[0]) ? value[0] : '';
const chainOf = (value: unknown) =>
  validChain(value) && BigInt(value) > 0n ? BigInt(value).toString() : '';

export function useBrowserWallet() {
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [connection, setConnection] = useState<{
    wallet: WalletOption;
    address: string;
    chainId: string;
    version: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const live = useRef(true);
  const selected = useRef<WalletOption | null>(null);
  const token = useRef(0);
  const version = useRef(0);
  const pending = useRef(false);
  const listeners = useRef<() => void>(() => {});
  const identity = useRef<WalletSnapshot | null>(null);
  const retire = useCallback(() => {
    live.current = false;
    token.current++;
    version.current++;
    identity.current = null;
    selected.current = null;
    listeners.current();
  }, []);
  useEffect(() => {
    live.current = true;
    const announce = (event: Event) => {
      const detail: unknown = (event as CustomEvent<unknown>).detail;
      if (
        !detail ||
        typeof detail !== 'object' ||
        !('provider' in detail) ||
        !isProvider(detail.provider) ||
        !('info' in detail)
      )
        return;
      const info = detail.info;
      if (
        !info ||
        typeof info !== 'object' ||
        !('uuid' in info) ||
        typeof info.uuid !== 'string' ||
        !('name' in info) ||
        typeof info.name !== 'string'
      )
        return;
      const option = {
        id: info.uuid.slice(0, 100),
        name: info.name.slice(0, 60),
        provider: detail.provider,
      };
      setWallets((previous) =>
        previous.some((entry) => entry.id === option.id)
          ? previous
          : [...previous.filter((entry) => entry.id !== 'injected'), option].slice(0, 16),
      );
    };
    window.addEventListener('eip6963:announceProvider', announce);
    const injected = (window as Window & { ethereum?: unknown }).ethereum;
    if (isProvider(injected))
      setWallets([{ id: 'injected', name: '浏览器钱包', provider: injected }]);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    return () => {
      retire();
      window.removeEventListener('eip6963:announceProvider', announce);
    };
  }, [retire]);
  const disconnect = () => {
    token.current++;
    version.current++;
    identity.current = null;
    selected.current = null;
    listeners.current();
    listeners.current = () => {};
    // A provider prompt cannot be cancelled. Its eventual response is discarded.
    pending.current = false;
    if (live.current) {
      setConnection(null);
      setError('');
      setBusy(false);
    }
  };
  const check = (snapshot: WalletSnapshot) => {
    const current = identity.current;
    if (
      !live.current ||
      !current ||
      current.provider !== snapshot.provider ||
      current.version !== snapshot.version ||
      current.address.toLowerCase() !== snapshot.address.toLowerCase() ||
      current.chainId !== snapshot.chainId
    )
      throw changed();
  };
  const ensureSnapshot = async (snapshot: WalletSnapshot) => {
    check(snapshot);
    const accounts = await snapshot.provider.request({ method: 'eth_accounts' });
    check(snapshot);
    const chain = await snapshot.provider.request({ method: 'eth_chainId' });
    check(snapshot);
    if (
      addressOf(accounts).toLowerCase() !== snapshot.address.toLowerCase() ||
      chainOf(chain) !== snapshot.chainId
    )
      throw changed();
    return snapshot;
  };
  const connect = async (id: string) => {
    const wallet = wallets.find((entry) => entry.id === id);
    if (!wallet || pending.current || !live.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    const current = ++token.current;
    listeners.current();
    selected.current = wallet;
    identity.current = null;
    version.current++;
    setConnection(null);
    const update = (kind: 'accounts' | 'chain', value: unknown) => {
      if (!live.current || selected.current !== wallet || token.current !== current) return;
      version.current++;
      const old = identity.current;
      if (!old) return;
      const address = kind === 'accounts' ? addressOf(value) : old.address;
      const chainId = kind === 'chain' ? chainOf(value) : old.chainId;
      if (!address || !chainId) {
        identity.current = null;
        setConnection(null);
        return;
      }
      identity.current = { provider: wallet.provider, address, chainId, version: version.current };
      setConnection({ wallet, address, chainId, version: version.current });
    };
    const accounts = (...args: unknown[]) => update('accounts', args[0]);
    const chain = (...args: unknown[]) => update('chain', args[0]);
    const lost = () => {
      if (selected.current === wallet && token.current === current) disconnect();
    };
    wallet.provider.on?.('accountsChanged', accounts);
    wallet.provider.on?.('chainChanged', chain);
    wallet.provider.on?.('disconnect', lost);
    listeners.current = () => {
      wallet.provider.removeListener?.('accountsChanged', accounts);
      wallet.provider.removeListener?.('chainChanged', chain);
      wallet.provider.removeListener?.('disconnect', lost);
    };
    try {
      await wallet.provider.request({ method: 'eth_requestAccounts' });
      if (!live.current || current !== token.current) throw changed();
      const v = version.current;
      const addresses = await wallet.provider.request({ method: 'eth_accounts' });
      const chainId = chainOf(await wallet.provider.request({ method: 'eth_chainId' }));
      if (!live.current || current !== token.current || v !== version.current) throw changed();
      const address = addressOf(addresses);
      if (!address || !chainId) throw new Error('钱包没有返回有效的地址与网络');
      identity.current = { provider: wallet.provider, address, chainId, version: v };
      setConnection({ wallet, address, chainId, version: v });
    } catch (caught) {
      if (live.current && current === token.current) {
        identity.current = null;
        setConnection(null);
        setError(caught instanceof Error ? caught.message : '连接未完成，请在钱包中确认后重试');
      }
    } finally {
      if (live.current && current === token.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  const signMessage = async (snapshot: WalletSnapshot, message: string) => {
    if (pending.current) throw new Error('钱包操作正在处理中');
    pending.current = true;
    const current = token.current;
    if (live.current) setBusy(true);
    try {
      await ensureSnapshot(snapshot);
      check(snapshot);
      const hex = `0x${Array.from(new TextEncoder().encode(message), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
      const signature = await snapshot.provider.request({
        method: 'personal_sign',
        params: [hex, snapshot.address],
      });
      await ensureSnapshot(snapshot);
      if (typeof signature !== 'string' || !/^0x[\da-fA-F]{130}$/.test(signature))
        throw new Error('钱包没有返回有效的个人签名');
      return signature;
    } finally {
      if (live.current && current === token.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  return {
    wallets,
    address: connection?.address ?? '',
    chain: connection ? `0x${BigInt(connection.chainId).toString(16)}` : '',
    chainId: connection?.chainId ?? '',
    version: connection?.version ?? version.current,
    name: connection?.wallet.name ?? '',
    busy,
    error,
    connect,
    disconnect,
    snapshot: () => {
      if (!identity.current) throw changed();
      return { ...identity.current };
    },
    ensureSnapshot,
    checkSnapshot: check,
    signMessage,
  };
}
