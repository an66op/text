import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { TransferPage, TransferReviewPage } from './WalletTransferPages';
import { WalletTransactionPage } from './WalletDetailsPages';
import { loadWallet } from './wallet-model';

function WalletTestApp({ entry = '/wallet/transfer' }: { entry?: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/wallet/transfer" element={<TransferPage />} />
        <Route path="/wallet/transfer/review" element={<TransferReviewPage />} />
        <Route path="/wallet/result/:transactionId" element={<WalletTransactionPage result />} />
        <Route path="/wallet" element={<h1>钱包主页</h1>} />
      </Routes>
    </MemoryRouter>
  );
}
describe('transfer pages', () => {
  beforeEach(() => localStorage.clear());
  it('restores a review after reload, commits once, and shows a persisted result page', () => {
    const first = render(<WalletTestApp />);
    fireEvent.click(screen.getByRole('button', { name: '阿川' }));
    fireEvent.change(screen.getByLabelText('转账数量'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('转账备注'), { target: { value: '测试转账' } });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByRole('button', { name: '确认模拟转账' })).toBeInTheDocument();
    first.unmount();
    render(<WalletTestApp entry="/wallet/transfer/review" />);
    fireEvent.click(screen.getByRole('button', { name: '确认模拟转账' }));
    expect(screen.getByRole('heading', { name: '转账完成' })).toBeInTheDocument();
    expect(screen.getByText('测试转账')).toBeInTheDocument();
    expect(loadWallet().balances.USDC).toBe(2375.5);
    expect(localStorage.getItem('wallet-transfer-draft')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: '完成，返回钱包' }));
    expect(screen.getByRole('heading', { name: '钱包主页' })).toBeInTheDocument();
  });
  it('keeps an insufficient transfer on its input page with a useful error', () => {
    render(<WalletTestApp />);
    fireEvent.click(screen.getByRole('button', { name: '阿川' }));
    fireEvent.change(screen.getByLabelText('转账数量'), { target: { value: '99999' } });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByRole('alert')).toHaveTextContent('余额不足');
    expect(screen.getByLabelText('转账数量')).toHaveValue('99999');
    expect(loadWallet().transactions).toHaveLength(2);
  });
  it('does not show success or deduct funds when durable storage fails', () => {
    localStorage.setItem(
      'wallet-transfer-draft',
      JSON.stringify({ coin: 'USDC', amount: '10', recipient: 'DEMO:test', note: '' }),
    );
    render(<WalletTestApp entry="/wallet/transfer/review" />);
    const setter = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    fireEvent.click(screen.getByRole('button', { name: '确认模拟转账' }));
    expect(screen.getByRole('alert')).toHaveTextContent('未保存');
    expect(screen.queryByRole('heading', { name: '转账完成' })).not.toBeInTheDocument();
    expect(loadWallet().balances.USDC).toBe(2475.5);
    setter.mockRestore();
  });

  it('does not spend a completed draft again from another open confirmation page', () => {
    localStorage.setItem(
      'wallet-transfer-draft',
      JSON.stringify({
        coin: 'USDC',
        amount: '100',
        recipient: 'DEMO:test',
        note: '同一笔转账',
      }),
    );
    const first = render(<WalletTestApp entry="/wallet/transfer/review" />);
    const second = render(<WalletTestApp entry="/wallet/transfer/review" />);
    fireEvent.click(within(first.container).getByRole('button', { name: '确认模拟转账' }));
    fireEvent.click(within(second.container).getByRole('button', { name: '确认模拟转账' }));
    expect(within(second.container).getByRole('alert')).toHaveTextContent('草稿已完成');
    expect(loadWallet().balances.USDC).toBe(2375.5);
    expect(loadWallet().transactions.filter((item) => item.kind === 'transfer')).toHaveLength(1);
  });
});
