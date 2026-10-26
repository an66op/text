import { useLayoutEffect, useRef } from 'react';
import { accountEpoch } from '@/shared/api/account-guard';
import { useAuth } from '../useAuth';
export const contactScope = (userId: string, expiresAt: string) =>
  JSON.stringify([userId, expiresAt, accountEpoch()]);
export function isContactScopeCurrent(scope: string) {
  try {
    return JSON.parse(scope)[2] === accountEpoch();
  } catch {
    return false;
  }
}
export function useContactScope() {
  const { user, expiresAt } = useAuth();
  const scope = user ? contactScope(user.id, expiresAt) : '';
  const current = useRef(scope);
  current.current = scope;
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return {
    scope,
    valid: () =>
      mounted.current && !!scope && current.current === scope && isContactScopeCurrent(scope),
  };
}
