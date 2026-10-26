import type { WalletSnapshot } from '@/features/web3/useBrowserWallet';
import type { PreparedChallenge, WalletConfig } from './types';

export function walletAvailable(config: WalletConfig, origin: string) {
  return config.enabled && config.contractWallets === false && config.origins.includes(origin);
}
export function validateChallenge(
  value: PreparedChallenge,
  snapshot: WalletSnapshot,
  purpose: 'login' | 'bind',
  origin: string,
  userId = '',
) {
  const { challenge: c, generation } = value;
  const invalid = () => new Error('签名内容与当前网站、账号或钱包不一致，请重新获取');
  if (
    !c ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(c.id) ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(generation) ||
    c.purpose !== purpose ||
    c.address.toLowerCase() !== snapshot.address.toLowerCase() ||
    c.chainId !== snapshot.chainId ||
    c.origin !== origin ||
    c.uri !== `${origin}${purpose === 'login' ? '/login/wallet' : '/account/wallets'}` ||
    typeof c.message !== 'string' ||
    c.message.length > 5000
  )
    throw invalid();
  const issued = Date.parse(c.issuedAt),
    expires = Date.parse(c.expiresAt);
  if (
    !Number.isFinite(issued) ||
    !Number.isFinite(expires) ||
    expires <= Date.now() ||
    expires <= issued ||
    expires - issued > 300_000 ||
    issued > Date.now() + 60_000
  )
    throw new Error('签名请求已过期或本机时间异常，请重新获取');
  const lines = c.message.split('\n');
  const authority = new URL(origin).host;
  if (
    ![
      `${origin} wants you to sign in with your Ethereum account:`,
      `${authority} wants you to sign in with your Ethereum account:`,
    ].includes(lines[0]) ||
    lines[1] !== c.address ||
    lines[2] !== '' ||
    lines[4] !== '' ||
    lines[5] !== `URI: ${c.uri}` ||
    lines[6] !== 'Version: 1' ||
    lines[7] !== `Chain ID: ${c.chainId}` ||
    !/^Nonce: [A-Za-z0-9]{8,}$/.test(lines[8]) ||
    lines[9] !== `Issued At: ${c.issuedAt}` ||
    lines[10] !== `Expiration Time: ${c.expiresAt}` ||
    lines[11] !== `Not Before: ${c.issuedAt}` ||
    lines[12] !== `Request ID: ${c.id}` ||
    lines.length !== 13
  )
    throw invalid();
  const statement =
    purpose === 'login'
      ? 'Sign in to your existing Gongming account. This request does not authorize transactions.'
      : `Bind this wallet to Gongming account ${userId}. This request does not authorize transactions.`;
  if (lines[3] !== statement) throw invalid();
  return value;
}
export function walletFailure(error: unknown) {
  const value = error as { code?: unknown; message?: unknown };
  if (value?.code === 4001 || value?.code === 'ACTION_REJECTED')
    return '已取消钱包签名，可重新获取请求后再试';
  if (value?.code === 'wallet_proof_failed') return '密码或钱包证明未通过，请核实后重试';
  if (value?.code === 'wallet_challenge_invalid') return '签名请求已失效，请重新获取';
  if (value?.code === 'auth_context_changed' || value?.code === 'ACCOUNT_CHANGED')
    return '账号状态已更新，请刷新后重新确认';
  return error instanceof Error ? error.message : '钱包操作未完成，请重试';
}
