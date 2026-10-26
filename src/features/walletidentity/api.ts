import { apiRequest } from '@/shared/api/client';
import { authContextHeaders, browserAuthRequest } from '@/shared/api/auth-context';
import type {
  BindingsResult,
  PreparedChallenge,
  WalletBinding,
  WalletChallenge,
  WalletConfig,
  WalletLoginResult,
  WalletProof,
} from './types';
export const walletIdentityApi = {
  config: (signal?: AbortSignal) => apiRequest<WalletConfig>('/auth/wallet/config', { signal }),
  bindings: (signal?: AbortSignal) => apiRequest<BindingsResult>('/me/wallet-bindings', { signal }),
  challenge: (
    input: { purpose: 'login' | 'bind'; address: string; chainId: string; password?: string },
    signal?: AbortSignal,
    assertActive?: () => void,
  ) =>
    browserAuthRequest(async (context) => {
      assertActive?.();
      return {
        challenge: await apiRequest<WalletChallenge>('/auth/wallet/challenge', {
          method: 'POST',
          body: JSON.stringify(input),
          signal,
          headers: authContextHeaders(context),
        }),
        generation: context.generation,
      } satisfies PreparedChallenge;
    }, signal),
  login: (proof: WalletProof, signal?: AbortSignal) =>
    browserAuthRequest(
      (context) => {
        proof.assertActive?.();
        return apiRequest<WalletLoginResult>('/auth/wallet/verify', {
          method: 'POST',
          body: JSON.stringify({
            id: proof.id,
            message: proof.message,
            signature: proof.signature,
          }),
          headers: authContextHeaders(context),
          signal,
        });
      },
      signal,
      proof.contextGeneration,
    ),
  bind: (proof: WalletProof, signal?: AbortSignal) =>
    browserAuthRequest(
      (context) => {
        proof.assertActive?.();
        return apiRequest<{ binding: WalletBinding }>('/auth/wallet/verify', {
          method: 'POST',
          body: JSON.stringify({
            id: proof.id,
            message: proof.message,
            signature: proof.signature,
          }),
          headers: authContextHeaders(context),
          signal,
        });
      },
      signal,
      proof.contextGeneration,
    ),
  unbind: (id: string, password: string, signal?: AbortSignal) =>
    browserAuthRequest(
      (context) =>
        apiRequest<{ ok: true; revokedSessions: number; currentSessionRevoked: boolean }>(
          `/me/wallet-bindings/${encodeURIComponent(id)}`,
          {
            method: 'DELETE',
            body: JSON.stringify({ password }),
            signal,
            headers: authContextHeaders(context),
          },
        ),
      signal,
    ),
};
