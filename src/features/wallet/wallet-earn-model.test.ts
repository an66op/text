import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DAY_MS,
  WALLET_KEY,
  earnPreview,
  earnTotal,
  exchange,
  isWalletState,
  loadWallet,
  migrateWallet,
  persistWallet,
  redeemEarn,
  subscribeEarn,
  transfer,
  walletTotal,
} from './wallet-model';
const start = Date.UTC(2026, 9, 17, 10);
const fresh = () => migrateWallet();
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('local earn accounting', () => {
  it('moves only the selected principal out of available balance and preserves total value through subscribe and redeem', () => {
    const original = fresh();
    const subscribed = subscribeEarn(original, 'usdc-flexible', '100', 'subscribe-1', start);
    expect(subscribed.balances).toEqual({ ...original.balances, USDC: 2375.5 });
    expect(subscribed.earnPositions?.[0]).toMatchObject({
      principal: 100,
      coin: 'USDC',
      status: 'active',
    });
    expect(earnTotal(subscribed)).toBe(100);
    expect(walletTotal(subscribed)).toBeCloseTo(walletTotal(original), 8);
    expect(original.earnPositions).toBeUndefined();
    const redeemed = redeemEarn(subscribed, 'position-subscribe-1', 'redeem-1', start + DAY_MS);
    expect(redeemed.balances).toEqual(original.balances);
    expect(earnTotal(redeemed)).toBe(0);
    expect(walletTotal(redeemed)).toBeCloseTo(walletTotal(original), 8);
    expect(redeemed.transactions.slice(0, 2).map((transaction) => transaction.kind)).toEqual([
      'earn-redeem',
      'earn-subscribe',
    ]);
    expect(redeemed.earnPositions?.[0]).toMatchObject({
      status: 'redeemed',
      redeemedAt: start + DAY_MS,
    });
  });

  it('prevents spending subscribed principal and deduplicates exhausted-balance requests and repeated redemption', () => {
    const original = fresh();
    const subscribed = subscribeEarn(original, 'usdc-flexible', '2475.5', 'all', start);
    expect(subscribed.balances.USDC).toBe(0);
    expect(subscribeEarn(subscribed, 'usdc-flexible', '2475.5', 'all', start)).toBe(subscribed);
    expect(() => subscribeEarn(subscribed, 'usdc-flexible', '10', 'another', start)).toThrow(
      '余额不足',
    );
    expect(() => exchange(subscribed, 'USDC', 'ETH', 10, 'exchange')).toThrow('余额不足');
    expect(() =>
      transfer(
        subscribed,
        { coin: 'USDC', amount: '10', recipient: 'DEMO:alice', note: '' },
        'send',
      ),
    ).toThrow('余额不足');
    expect(() => subscribeEarn(subscribed, 'eth-7d', '0.01', 'all', start)).toThrow('请求编号');
    const redeemed = redeemEarn(subscribed, 'position-all', 'redeem', start);
    expect(redeemEarn(redeemed, 'position-all', 'redeem', start)).toBe(redeemed);
    expect(redeemEarn(redeemed, 'position-all', 'new-request', start)).toBe(redeemed);
    expect(redeemed.balances.USDC).toBe(2475.5);
    expect(
      redeemed.transactions.filter((transaction) => transaction.kind === 'earn-redeem'),
    ).toHaveLength(1);
  });

  it('checks minimum, precision, balance, IDs and fixed-term maturity before changing state', () => {
    const original = fresh();
    for (const amount of ['0', '-1', 'NaN', 'Infinity', '1e2', '0.001', '9.99', '3000', '10.001'])
      expect(() =>
        subscribeEarn(original, 'usdc-flexible', amount, `bad-${amount}`, start),
      ).toThrow();
    expect(() => subscribeEarn(original, 'missing', '10', 'missing', start)).toThrow('不存在');
    expect(() => subscribeEarn(original, 'btc-30d', '0.001000001', 'precision', start)).toThrow(
      '8 位小数',
    );
    expect(() => subscribeEarn(original, 'usdc-flexible', '10', '', start)).toThrow('请求无效');
    const locked = subscribeEarn(original, 'eth-7d', '0.1', 'eth', start);
    expect(() => redeemEarn(locked, 'position-eth', 'early', start + 7 * DAY_MS - 1)).toThrow(
      '尚未到期',
    );
    expect(() => redeemEarn(locked, 'missing', 'missing', start)).toThrow('不存在');
    const matured = redeemEarn(locked, 'position-eth', 'matured', start + 7 * DAY_MS);
    expect(matured.balances.ETH).toBe(original.balances.ETH);
    expect(isWalletState(matured)).toBe(true);
    expect(original.balances.ETH).toBe(0.85);
  });

  it('uses snapshotted demo APR, caps fixed-term preview and never credits preview yield into assets', () => {
    const state = subscribeEarn(fresh(), 'btc-30d', '0.01', 'btc', start);
    const position = state.earnPositions![0];
    expect(earnPreview(position, start - DAY_MS)).toBe(0);
    expect(earnPreview(position, start + 30 * DAY_MS)).toBeCloseTo((0.01 * 0.042 * 30) / 365, 12);
    expect(earnPreview(position, start + 60 * DAY_MS)).toBe(
      earnPreview(position, start + 30 * DAY_MS),
    );
    expect(walletTotal(state)).toBeCloseTo(walletTotal(fresh()), 8);
    const redeemed = redeemEarn(state, position.id, 'redeem-btc', start + 60 * DAY_MS);
    expect(redeemed.balances.BTC).toBe(0.12);
    expect(earnPreview(redeemed.earnPositions![0], start + 100 * DAY_MS)).toBe(
      earnPreview(position, start + 30 * DAY_MS),
    );
  });

  it('restores existing v2 wallets without earn fields and saves positions and balances together in one authoritative record', () => {
    const oldWallet = fresh();
    localStorage.setItem(WALLET_KEY, JSON.stringify(oldWallet));
    expect(loadWallet()).toEqual(oldWallet);
    const invested = subscribeEarn(loadWallet(), 'usdc-flexible', '25', 'saved', start);
    expect(persistWallet(invested)).toBe(true);
    expect(loadWallet()).toEqual(invested);
    expect(JSON.parse(localStorage.getItem(WALLET_KEY) ?? '{}')).toMatchObject({
      balances: { USDC: 2450.5 },
      earnPositions: [{ principal: 25 }],
    });
    const setter = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    expect(persistWallet(redeemEarn(invested, 'position-saved', 'failed-redemption', start))).toBe(
      false,
    );
    expect(loadWallet()).toEqual(invested);
    setter.mockRestore();
  });

  it('rejects malformed positions and preserves the authoritative transaction when a legacy mirror cannot be written', () => {
    const state = subscribeEarn(fresh(), 'usdc-flexible', '100', 'valid', start);
    const position = state.earnPositions![0];
    for (const patch of [
      { principal: -1 },
      { principal: 1.001 },
      { coin: 'ETH' },
      { apr: Infinity },
      { status: 'redeemed' },
      { unlockAt: -1 },
      { productId: 'missing' },
    ])
      expect(isWalletState({ ...state, earnPositions: [{ ...position, ...patch }] })).toBe(false);
    expect(isWalletState({ ...state, earnPositions: [position, position] })).toBe(false);
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key !== WALLET_KEY) throw new DOMException('Mirror full', 'QuotaExceededError');
      originalSet.call(this, key, value);
    });
    expect(persistWallet(state)).toBe(true);
    expect(loadWallet()).toEqual(state);
  });
});
