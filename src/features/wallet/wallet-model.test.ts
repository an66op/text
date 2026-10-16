import { beforeEach, describe, expect, it } from 'vitest';
import {
  addDemoReceipt,
  demoAddress,
  exchange,
  isWalletState,
  loadWallet,
  migrateWallet,
  persistWallet,
  transfer,
  validateTransfer,
  walletTotal,
  type TransferDraft,
} from './wallet-model';

const draft: TransferDraft = {
  coin: 'USDC',
  amount: '100',
  recipient: 'DEMO:alice_wallet',
  note: '周末咖啡',
};
describe('local wallet accounting', () => {
  beforeEach(() => localStorage.clear());
  it('preserves a legacy total and readable records during migration', () => {
    localStorage.setItem('balance', '500');
    localStorage.setItem('transactions', JSON.stringify(['转出 3 USDC · 刚刚']));
    const state = migrateWallet();
    expect(walletTotal(state)).toBeCloseTo(500, 8);
    expect(state.transactions[0]).toMatchObject({
      id: 'legacy-0',
      legacyLabel: '转出 3 USDC · 刚刚',
      amount: 3,
    });
    expect(persistWallet(state)).toBe(true);
    expect(loadWallet()).toEqual(state);
  });
  it('deducts only the selected asset, stores a transaction, and keeps old storage compatible', () => {
    const original = migrateWallet();
    const next = transfer(original, draft, 'transfer-one');
    expect(next.balances).toEqual({ ETH: 0.85, BTC: 0.12, USDC: 2375.5 });
    expect(original.balances.USDC).toBe(2475.5);
    expect(next.transactions[0]).toMatchObject({
      kind: 'transfer',
      amount: 100,
      recipient: draft.recipient,
      note: draft.note,
    });
    persistWallet(next);
    expect(JSON.parse(localStorage.getItem('balance') ?? '0')).toBe(12380.5);
    expect(JSON.parse(localStorage.getItem('transactions') ?? '[]')[0]).toBe('转出 100 USDC');
  });
  it('rejects insufficient funds, invalid quantities, self transfer, and unsupported precision', () => {
    const state = migrateWallet();
    for (const amount of ['0', '-1', 'NaN', '3000', '0.001'])
      expect(validateTransfer({ ...draft, amount }, state)).not.toBeNull();
    expect(validateTransfer({ ...draft, recipient: demoAddress }, state)).not.toBeNull();
    expect(() => transfer(state, { ...draft, amount: '3000' }, 'invalid')).toThrow('余额不足');
    expect(state.transactions).toHaveLength(2);
  });
  it('exchanges both balances at the fixed demo quote without adding fictitious value', () => {
    const state = migrateWallet();
    const next = exchange(state, 'USDC', 'ETH', 330, 'exchange-one');
    expect(next.balances.USDC).toBe(2145.5);
    expect(next.balances.ETH).toBe(0.95);
    expect(walletTotal(next)).toBeCloseTo(walletTotal(state), 6);
    expect(next.transactions[0]).toMatchObject({
      coin: 'USDC',
      amount: 330,
      receiveCoin: 'ETH',
      receiveAmount: 0.1,
    });
    expect(() => exchange(state, 'BTC', 'BTC', 0.01, 'invalid')).toThrow('不同');
    expect(() => exchange(state, 'USDC', 'ETH', 99999, 'invalid')).toThrow('余额不足');
  });
  it('is idempotent even when the original transfer or exchange exhausted the balance', () => {
    const state = migrateWallet();
    const all = { ...draft, amount: String(state.balances.USDC) };
    const transferred = transfer(state, all, 'once');
    expect(transferred.balances.USDC).toBe(0);
    expect(transfer(transferred, all, 'once')).toBe(transferred);
    const exchanged = exchange(state, 'USDC', 'ETH', state.balances.USDC, 'exchange-once');
    expect(exchange(exchanged, 'USDC', 'ETH', state.balances.USDC, 'exchange-once')).toBe(
      exchanged,
    );
    const received = addDemoReceipt(state, 'USDC', 'receive-once');
    expect(addDemoReceipt(received, 'USDC', 'receive-once')).toBe(received);
  });
  it('recovers malformed records without throwing or propagating invalid balances', () => {
    for (const value of [
      null,
      { ...migrateWallet(), transactions: [null] },
      { ...migrateWallet(), balances: { ETH: -1, BTC: 0, USDC: 0 } },
      { ...migrateWallet(), transactions: [{ id: 'broken' }] },
    ])
      expect(isWalletState(value)).toBe(false);
    localStorage.setItem('wallet-v2', JSON.stringify({ ...migrateWallet(), transactions: [null] }));
    expect(loadWallet().balances.USDC).toBe(2475.5);
  });
});
