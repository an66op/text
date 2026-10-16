import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import WalletEarnPage from './WalletEarnPage';
import WalletPage from './WalletPage';
import {
  DAY_MS,
  WALLET_KEY,
  loadWallet,
  persistWallet,
  subscribeEarn,
  walletTotal,
} from './wallet-model';
function App({ entry = '/wallet/earn' }: { entry?: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/wallet/earn" element={<WalletEarnPage kind="catalog" />} />
        <Route
          path="/wallet/earn/products/:productId"
          element={<WalletEarnPage kind="product" />}
        />
        <Route path="/wallet/earn/positions" element={<WalletEarnPage kind="positions" />} />
        <Route path="/wallet" element={<WalletPage />} />
      </Routes>
    </MemoryRouter>
  );
}
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const accept = () => fireEvent.click(screen.getByRole('checkbox'));

describe('earn product and redemption flows', () => {
  it('filters products, subscribes to flexible earn and redeems principal with a durable history and unchanged total', () => {
    const before = walletTotal(loadWallet());
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '定期' }));
    expect(screen.queryByRole('link', { name: /USDC 活期/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '活期' }));
    fireEvent.click(screen.getByRole('link', { name: /USDC 活期/ }));
    fireEvent.change(screen.getByLabelText('申购数量'), { target: { value: '100' } });
    expect(screen.getByRole('button', { name: '确认模拟申购' })).toBeDisabled();
    accept();
    fireEvent.click(screen.getByRole('button', { name: '确认模拟申购' }));
    expect(screen.getByRole('heading', { name: '我的持仓' })).toBeInTheDocument();
    expect(loadWallet().balances.USDC).toBe(2375.5);
    expect(walletTotal(loadWallet())).toBeCloseTo(before, 8);
    fireEvent.click(screen.getByRole('button', { name: '赎回本金' }));
    fireEvent.click(screen.getByRole('button', { name: '确认模拟赎回' }));
    expect(screen.getByRole('status')).toHaveTextContent('已赎回 100 USDC');
    expect(loadWallet().balances.USDC).toBe(2475.5);
    expect(walletTotal(loadWallet())).toBeCloseTo(before, 8);
    fireEvent.click(screen.getByRole('button', { name: '已赎回' }));
    expect(screen.getByText('已返还本金')).toBeInTheDocument();
    expect(
      loadWallet().transactions.filter((transaction) => transaction.kind === 'earn-redeem'),
    ).toHaveLength(1);
  });

  it('shows invalid amounts and keeps a failed durable subscription on its input page without spending funds', () => {
    render(<App entry="/wallet/earn/products/usdc-flexible" />);
    accept();
    fireEvent.change(screen.getByLabelText('申购数量'), { target: { value: '10.001' } });
    fireEvent.click(screen.getByRole('button', { name: '确认模拟申购' }));
    expect(screen.getByRole('alert')).toHaveTextContent('2 位小数');
    fireEvent.change(screen.getByLabelText('申购数量'), { target: { value: '99999' } });
    fireEvent.click(screen.getByRole('button', { name: '确认模拟申购' }));
    expect(screen.getByRole('alert')).toHaveTextContent('余额不足');
    fireEvent.change(screen.getByLabelText('申购数量'), { target: { value: '100' } });
    const setter = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    fireEvent.click(screen.getByRole('button', { name: '确认模拟申购' }));
    expect(screen.getByRole('alert')).toHaveTextContent('未保存');
    expect(screen.getByLabelText('申购数量')).toHaveValue('100');
    expect(loadWallet().balances.USDC).toBe(2475.5);
    expect(loadWallet().earnPositions).toBeUndefined();
    setter.mockRestore();
  });

  it('restores fixed-term holdings, blocks early redemption and prevents a failed flexible redemption from changing either balance', () => {
    const now = Date.now();
    const flexible = subscribeEarn(loadWallet(), 'usdc-flexible', '100', 'flexible', now);
    const state = subscribeEarn(flexible, 'eth-7d', '0.1', 'locked', now);
    persistWallet(state);
    const first = render(<App entry="/wallet/earn/positions" />);
    expect(screen.getByRole('button', { name: '到期后可赎回' })).toBeDisabled();
    first.unmount();
    render(<App entry="/wallet/earn/positions" />);
    expect(screen.getByRole('button', { name: '到期后可赎回' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '赎回本金' }));
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === WALLET_KEY) throw new DOMException('Full', 'QuotaExceededError');
      original.call(this, key, value);
    });
    fireEvent.click(screen.getByRole('button', { name: '确认模拟赎回' }));
    expect(
      within(screen.getByRole('region', { name: '赎回确认' })).getByRole('alert'),
    ).toHaveTextContent('未保存');
    expect(loadWallet()).toEqual(state);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('unlocks a fixed-term position while its page stays open and allows redemption without a reload', () => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 9, 17, 10);
    vi.setSystemTime(now);
    persistWallet(
      subscribeEarn(loadWallet(), 'eth-7d', '0.1', 'near-maturity', now - 7 * DAY_MS + 1_000),
    );
    render(<App entry="/wallet/earn/positions" />);
    expect(screen.getByRole('button', { name: '到期后可赎回' })).toBeDisabled();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.queryByRole('button', { name: '到期后可赎回' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '赎回本金' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '赎回本金' }));
    fireEvent.click(screen.getByRole('button', { name: '确认模拟赎回' }));
    expect(screen.getByRole('status')).toHaveTextContent('已赎回 0.1 ETH');
    expect(loadWallet().balances.ETH).toBe(0.85);
  });

  it('schedules long fixed-term maturities in bounded waits and cleans up its timer on unmount', () => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 9, 17, 10);
    vi.setSystemTime(now);
    persistWallet(subscribeEarn(loadWallet(), 'btc-30d', '0.01', 'long-maturity', now));
    const mounted = render(<App entry="/wallet/earn/positions" />);
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(1_000));
    expect(vi.getTimerCount()).toBe(1);
    expect(screen.getByRole('button', { name: '到期后可赎回' })).toBeDisabled();
    act(() => vi.advanceTimersByTime(DAY_MS));
    expect(vi.getTimerCount()).toBe(1);
    expect(screen.getByRole('button', { name: '到期后可赎回' })).toBeDisabled();
    mounted.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles an invalid product and links the wallet to products while including invested principal once', () => {
    const invalid = render(<App entry="/wallet/earn/products/missing" />);
    expect(screen.getByText('未找到这款理财产品')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: '浏览理财产品' }));
    expect(screen.getByRole('link', { name: /USDC 活期/ })).toBeInTheDocument();
    invalid.unmount();
    persistWallet(subscribeEarn(loadWallet(), 'usdc-flexible', '100', 'wallet-principal'));
    render(<App entry="/wallet" />);
    expect(screen.getByRole('heading', { name: '$12,480.50' })).toBeInTheDocument();
    expect(screen.getByText('理财中 100 USDC')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: /理财 · EARN/ }));
    expect(screen.getByRole('heading', { name: '理财产品' })).toBeInTheDocument();
  });
});
