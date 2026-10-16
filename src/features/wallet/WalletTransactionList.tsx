import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { transactionLabel, type WalletTransaction } from './wallet-model';

export default function WalletTransactionList({
  transactions,
}: {
  transactions: WalletTransaction[];
}) {
  if (!transactions.length)
    return (
      <div className="wallet-empty">
        <strong>暂无交易记录</strong>
        <p>转账、收款、兑换或理财申赎后，记录会显示在这里。</p>
      </div>
    );
  return (
    <div className="wallet-list-card">
      {transactions.map((transaction) => (
        <Link
          className="wallet-transaction-row"
          key={transaction.id}
          to={`/wallet/transactions/${encodeURIComponent(transaction.id)}`}
        >
          <span className={`wallet-transaction-icon ${transaction.kind}`}>
            {transaction.kind === 'exchange' ? (
              <ArrowLeftRight size={20} />
            ) : transaction.kind === 'receive' ||
              transaction.kind === 'earn-redeem' ||
              transaction.legacyLabel?.startsWith('收到') ? (
              <ArrowDownLeft size={21} />
            ) : (
              <ArrowUpRight size={21} />
            )}
          </span>
          <span className="wallet-row-copy">
            <strong>{transactionLabel(transaction)}</strong>
            <small>
              {new Date(transaction.createdAt).toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </small>
          </span>
          <span className="wallet-transaction-status">已完成</span>
          <ChevronRight size={15} />
        </Link>
      ))}
    </div>
  );
}
