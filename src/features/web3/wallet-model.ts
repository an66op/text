export type LedgerEntry = {
  id: string;
  kind: 'faucet' | 'transfer_in' | 'transfer_out';
  amount: string;
  symbol: string;
  counterparty: string;
  createdAt: string;
  requestId: string;
};
export type TestWallet = {
  network: string;
  assets: { symbol: string; name: string; balance: string; decimals: number }[];
  address: string;
  transactions: LedgerEntry[];
};

export function parseGem(value: string): string | null {
  const normalized = value.trim();
  if (!/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, decimal = ''] = normalized.split('.');
  const units = BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0'));
  return units > 0n && units <= 100000000000n ? units.toString() : null;
}
export function formatGem(value: string): string {
  if (!/^-?\d+$/.test(value)) return '—';
  const units = BigInt(value);
  const positive = units < 0n ? -units : units;
  return `${units < 0n ? '-' : ''}${(positive / 100n).toLocaleString('zh-CN')}.${(positive % 100n).toString().padStart(2, '0')}`;
}
export function validAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[\da-fA-F]{40}$/.test(value);
}
export function validChain(value: unknown): value is string {
  return typeof value === 'string' && /^0x[\da-fA-F]{1,64}$/.test(value);
}
