import { useEffect, useState } from 'react';
import { validAddress, validChain } from './wallet-model';

type Provider = {
  request: (input: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};
type WalletOption = { id: string; name: string; provider: Provider };
function isProvider(value: unknown): value is Provider {
  return (
    !!value &&
    typeof value === 'object' &&
    'request' in value &&
    typeof value.request === 'function'
  );
}

export function useBrowserWallet() {
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [selected, setSelected] = useState<WalletOption | null>(null);
  const [address, setAddress] = useState('');
  const [chain, setChain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
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
        previous.some((wallet) => wallet.id === option.id)
          ? previous
          : [...previous.filter((wallet) => wallet.id !== 'injected'), option].slice(0, 16),
      );
    };
    window.addEventListener('eip6963:announceProvider', announce);
    const injected = (window as Window & { ethereum?: unknown }).ethereum;
    if (isProvider(injected))
      setWallets([{ id: 'injected', name: '浏览器钱包', provider: injected }]);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    return () => window.removeEventListener('eip6963:announceProvider', announce);
  }, []);
  useEffect(() => {
    if (!selected) return;
    const accounts = (...args: unknown[]) => {
      const next = args[0];
      setAddress(Array.isArray(next) && validAddress(next[0]) ? next[0] : '');
    };
    const chains = (...args: unknown[]) => setChain(validChain(args[0]) ? args[0] : '');
    const disconnect = () => {
      setAddress('');
      setChain('');
      setSelected(null);
    };
    selected.provider.on?.('accountsChanged', accounts);
    selected.provider.on?.('chainChanged', chains);
    selected.provider.on?.('disconnect', disconnect);
    return () => {
      selected.provider.removeListener?.('accountsChanged', accounts);
      selected.provider.removeListener?.('chainChanged', chains);
      selected.provider.removeListener?.('disconnect', disconnect);
    };
  }, [selected]);
  const connect = async (id: string) => {
    const wallet = wallets.find((entry) => entry.id === id);
    if (!wallet || busy) return;
    setBusy(true);
    setError('');
    try {
      const accounts = await wallet.provider.request({ method: 'eth_requestAccounts' });
      if (!Array.isArray(accounts) || !validAddress(accounts[0]))
        throw new Error('钱包没有返回有效的公开地址');
      const nextChain = await wallet.provider.request({ method: 'eth_chainId' });
      if (!validChain(nextChain)) throw new Error('钱包没有返回有效的网络编号');
      setSelected(wallet);
      setAddress(accounts[0]);
      setChain(nextChain);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '连接未完成，请在钱包中确认后重试');
    } finally {
      setBusy(false);
    }
  };
  return {
    wallets,
    address,
    chain,
    name: selected?.name ?? '',
    busy,
    error,
    connect,
    disconnect: () => {
      setSelected(null);
      setAddress('');
      setChain('');
      setError('');
    },
  };
}
