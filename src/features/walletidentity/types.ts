import type { Session } from '@/shared/api/types';
export type WalletConfig = {
  enabled: boolean;
  origins: string[];
  chains: string[];
  maxBindings: number;
  challengeTTLSeconds: number;
  contractWallets: false;
};
export type WalletBinding = { id: string; address: string; boundAt: string };
export type BindingsResult = { items: WalletBinding[]; maxBindings: number; hasPassword: true };
export type WalletChallenge = {
  id: string;
  purpose: 'login' | 'bind';
  message: string;
  address: string;
  chainId: string;
  origin: string;
  uri: string;
  issuedAt: string;
  expiresAt: string;
};
export type PreparedChallenge = { challenge: WalletChallenge; generation: string };
export type WalletProof = {
  id: string;
  message: string;
  signature: string;
  contextGeneration: string;
  assertActive?: () => void;
};
export type WalletLoginProof = WalletProof & { expectedEpoch: number };
export type WalletLoginResult = Session & { authGeneration?: string };
