import { vi } from 'vitest';
import type { WalletProvider } from '@/features/web3/useBrowserWallet';
import type { PreparedChallenge, WalletConfig } from './types';
export const testAddress = `0x${'12'.repeat(20)}`;
export const otherAddress = `0x${'34'.repeat(20)}`;
export const walletConfig: WalletConfig = {
  enabled: true,
  origins: [window.location.origin],
  chains: ['1', '11155111'],
  maxBindings: 5,
  challengeTTLSeconds: 300,
  contractWallets: false,
};
export function prepared(
  purpose: 'login' | 'bind' = 'login',
  user = 'user-member',
  address = testAddress,
): PreparedChallenge {
  const origin = window.location.origin,
    issuedAt = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace('.000Z', 'Z'),
    expiresAt = new Date(Date.parse(issuedAt) + 300000).toISOString().replace('.000Z', 'Z');
  const id = 'challenge_one',
    uri = origin + (purpose === 'login' ? '/login/wallet' : '/account/wallets');
  const statement =
    purpose === 'login'
      ? 'Sign in to your existing Gongming account. This request does not authorize transactions.'
      : `Bind this wallet to Gongming account ${user}. This request does not authorize transactions.`;
  const message = `${origin} wants you to sign in with your Ethereum account:\n${address}\n\n${statement}\n\nURI: ${uri}\nVersion: 1\nChain ID: 1\nNonce: ABC123nonce123\nIssued At: ${issuedAt}\nExpiration Time: ${expiresAt}\nNot Before: ${issuedAt}\nRequest ID: ${id}`;
  return {
    generation: 'test_context',
    challenge: { id, purpose, message, address, chainId: '1', origin, uri, issuedAt, expiresAt },
  };
}
export function testWallet() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  let account = testAddress,
    chain = '0x1';
  const request = vi.fn<WalletProvider['request']>(async ({ method }) =>
    method === 'eth_chainId'
      ? chain
      : method === 'personal_sign'
        ? `0x${'11'.repeat(65)}`
        : [account],
  );
  const wallet = {
    request,
    on: (name: string, fn: (...args: unknown[]) => void) => {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name)!.add(fn);
    },
    removeListener: (name: string, fn: (...args: unknown[]) => void) => {
      handlers.get(name)?.delete(fn);
    },
    emit: (name: string, value: unknown) => {
      if (name === 'accountsChanged' && Array.isArray(value)) account = value[0];
      if (name === 'chainChanged' && typeof value === 'string') chain = value;
      handlers.get(name)?.forEach((fn) => fn(value));
    },
  };
  (window as Window & { ethereum?: unknown }).ethereum = wallet;
  return wallet;
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
