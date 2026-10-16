import { useCallback, useEffect, useState } from 'react';
import { loadShop, persistShop, SHOP_KEY, type ShopState } from './shop-model';
export function useShop() {
  const [state, setState] = useState(loadShop);
  useEffect(() => {
    const syncStorage = (event: StorageEvent) => {
      if (event.key === SHOP_KEY || event.key === null) setState(loadShop());
    };
    const syncLocal = () => setState(loadShop());
    window.addEventListener('storage', syncStorage);
    window.addEventListener('app:shop-updated', syncLocal);
    return () => {
      window.removeEventListener('storage', syncStorage);
      window.removeEventListener('app:shop-updated', syncLocal);
    };
  }, []);
  const commit = useCallback((update: (current: ShopState) => ShopState) => {
    const next = update(loadShop());
    if (!persistShop(next)) throw new Error('本地存储空间不足，操作未保存，请清理空间后重试');
    setState(next);
    window.dispatchEvent(new CustomEvent('app:shop-updated'));
    return next;
  }, []);
  return { state, commit };
}
