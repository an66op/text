import { useLayoutEffect, useSyncExternalStore } from 'react';
import {
  activatePrivacyScope,
  getPrivacyOperation,
  subscribePrivacyOperation,
} from './operation-registry';
export function usePrivacyOperation(scope: string) {
  useLayoutEffect(() => activatePrivacyScope(scope), [scope]);
  return useSyncExternalStore(
    subscribePrivacyOperation,
    () => getPrivacyOperation(scope),
    () => getPrivacyOperation(scope),
  );
}
