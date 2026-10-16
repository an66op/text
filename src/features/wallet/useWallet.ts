import { useCallback, useEffect, useState } from 'react';
import { loadWallet, persistWallet, WALLET_KEY, type WalletState } from './wallet-model';

export function useWallet() {
  const [state, setState] = useState(loadWallet);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === WALLET_KEY || event.key === null) setState(loadWallet());
    };
    const localSync = () => setState(loadWallet());
    window.addEventListener('storage', sync);
    window.addEventListener('app:wallet-updated', localSync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('app:wallet-updated', localSync);
    };
  }, []);
  const commit = useCallback((update: (current: WalletState) => WalletState) => {
    const next = update(loadWallet());
    if (!persistWallet(next))
      throw new Error('本地存储空间不足，交易未保存，请清理浏览器空间后重试');
    setState(next);
    window.dispatchEvent(new CustomEvent('app:wallet-updated'));
    return next;
  }, []);
  return { state, commit };
}
