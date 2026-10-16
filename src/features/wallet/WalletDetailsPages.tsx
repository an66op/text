import { useState } from 'react';
import { ArrowLeftRight, CheckCircle2, Send } from 'lucide-react';
import { Link, useParams } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { useWallet } from './useWallet';
import TransactionList from './WalletTransactionList';
import {
  coinInfo,
  coins,
  demoAddress,
  earnPrincipal,
  findEarnProduct,
  isCoin,
  money,
  quantity,
  transactionLabel,
  type TransactionKind,
} from './wallet-model';

function MissingRecord({ title }: { title: string }) {
  return (
    <div className="wallet-empty">
      <strong>{title}</strong>
      <p>这条本地记录可能已被清理，请返回钱包查看现有资产。</p>
      <Link className="primary full" to="/wallet">
        返回钱包
      </Link>
    </div>
  );
}
export function WalletHistoryPage() {
  const { state } = useWallet();
  const [filter, setFilter] = useState<TransactionKind | 'all'>('all');
  const [coin, setCoin] = useState('all');
  const transactions = state.transactions.filter(
    (transaction) =>
      (filter === 'all' || transaction.kind === filter) &&
      (coin === 'all' || transaction.coin === coin || transaction.receiveCoin === coin),
  );
  return (
    <div className="wallet-page">
      <PageHeader title="交易记录" backTo="/wallet" />
      <div className="wallet-content">
        <nav className="wallet-filter-tabs" aria-label="交易类型">
          {(
            [
              ['all', '全部'],
              ['transfer', '转账'],
              ['receive', '收款'],
              ['exchange', '兑换'],
              ['earn-subscribe', '申购'],
              ['earn-redeem', '赎回'],
              ['legacy', '旧记录'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={filter === value}
              className={filter === value ? 'active' : ''}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="wallet-history-filter">
          <span>{transactions.length} 笔记录</span>
          <select
            aria-label="筛选资产"
            value={coin}
            onChange={(event) => setCoin(event.target.value)}
          >
            <option value="all">全部资产</option>
            {coins.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        <TransactionList transactions={transactions} />
      </div>
    </div>
  );
}
export function WalletAssetPage() {
  const { assetId } = useParams();
  const { state } = useWallet();
  if (!isCoin(assetId))
    return (
      <div className="wallet-page">
        <PageHeader title="资产详情" backTo="/wallet" />
        <MissingRecord title="未找到这项资产" />
      </div>
    );
  const info = coinInfo[assetId];
  const transactions = state.transactions.filter(
    (transaction) => transaction.coin === assetId || transaction.receiveCoin === assetId,
  );
  return (
    <div className="wallet-page">
      <PageHeader title={info.name} backTo="/wallet" />
      <div className="wallet-content">
        <section className="wallet-asset-summary">
          <b className={`wallet-coin wallet-coin-${assetId.toLowerCase()}`}>{info.symbol}</b>
          <h1>
            {quantity(state.balances[assetId] + earnPrincipal(state, assetId), assetId)}{' '}
            <small>{assetId}</small>
          </h1>
          <p>
            ≈ ${money((state.balances[assetId] + earnPrincipal(state, assetId)) * info.price)} USD
          </p>
          <span>固定演示价格 ${money(info.price)}</span>
        </section>
        <div className="wallet-asset-buttons">
          <Link className="primary" to={`/wallet/transfer?coin=${assetId}`}>
            <Send size={17} />
            转账
          </Link>
          <Link className="wallet-outline" to={`/wallet/exchange?coin=${assetId}`}>
            <ArrowLeftRight size={18} />
            兑换
          </Link>
          <Link className="wallet-outline" to={`/wallet/receive?coin=${assetId}`}>
            收款
          </Link>
        </div>
        <dl className="wallet-detail-card">
          <div>
            <dt>可用余额</dt>
            <dd>
              {quantity(state.balances[assetId], assetId)} {assetId}
            </dd>
          </div>
          <div>
            <dt>理财本金</dt>
            <dd>
              <Link to="/wallet/earn/positions">
                {quantity(earnPrincipal(state, assetId), assetId)} {assetId} · 查看持仓
              </Link>
            </dd>
          </div>
          <div>
            <dt>资产网络</dt>
            <dd>{info.network}</dd>
          </div>
          <div>
            <dt>账户类型</dt>
            <dd>本地演示账户</dd>
          </div>
          <div>
            <dt>资产精度</dt>
            <dd>{info.decimals} 位小数</dd>
          </div>
        </dl>
        <div className="wallet-section-heading">
          <h2>{assetId} 交易记录</h2>
          <span>{transactions.length} 笔</span>
        </div>
        <TransactionList transactions={transactions} />
      </div>
    </div>
  );
}
export function WalletTransactionPage({ result = false }: { result?: boolean }) {
  const { transactionId } = useParams();
  const { state } = useWallet();
  const transaction = state.transactions.find((item) => item.id === transactionId);
  return (
    <div className="wallet-page">
      <PageHeader title={result ? '交易结果' : '交易详情'} backTo="/wallet/history" />
      <div className="wallet-content">
        {!transaction ? (
          <MissingRecord title="未找到这笔交易" />
        ) : (
          <>
            <section className="wallet-transaction-summary">
              <CheckCircle2 size={52} />
              <h1>
                {transaction.kind === 'exchange'
                  ? '兑换完成'
                  : transaction.kind === 'receive'
                    ? '收款成功'
                    : transaction.kind === 'earn-subscribe'
                      ? '理财申购完成'
                      : transaction.kind === 'earn-redeem'
                        ? '理财赎回完成'
                        : transaction.kind === 'legacy'
                          ? '历史交易'
                          : '转账完成'}
              </h1>
              <p>{transactionLabel(transaction)}</p>
              <small>本地模拟交易 · 已完成</small>
            </section>
            <dl className="wallet-detail-card">
              <div>
                <dt>交易编号</dt>
                <dd className="wallet-address-value">{transaction.id}</dd>
              </div>
              <div>
                <dt>交易时间</dt>
                <dd>{new Date(transaction.createdAt).toLocaleString('zh-CN')}</dd>
              </div>
              <div>
                <dt>资产网络</dt>
                <dd>{coinInfo[transaction.coin].network}</dd>
              </div>
              {transaction.kind.startsWith('earn-') ? (
                <>
                  <div>
                    <dt>理财产品</dt>
                    <dd>
                      <Link to={`/wallet/earn/products/${transaction.productId}`}>
                        {findEarnProduct(transaction.productId ?? '')?.name ?? '理财产品'}
                      </Link>
                    </dd>
                  </div>
                  <div>
                    <dt>{transaction.kind === 'earn-subscribe' ? '申购本金' : '返还本金'}</dt>
                    <dd>
                      {quantity(transaction.amount, transaction.coin)} {transaction.coin}
                    </dd>
                  </div>
                  <div>
                    <dt>我的持仓</dt>
                    <dd>
                      <Link to="/wallet/earn/positions">查看理财持仓</Link>
                    </dd>
                  </div>
                </>
              ) : transaction.kind === 'exchange' ? (
                <>
                  <div>
                    <dt>支付数量</dt>
                    <dd>
                      {quantity(transaction.amount, transaction.coin)} {transaction.coin}
                    </dd>
                  </div>
                  <div>
                    <dt>到账数量</dt>
                    <dd>
                      {quantity(transaction.receiveAmount ?? 0, transaction.receiveCoin ?? 'USDC')}{' '}
                      {transaction.receiveCoin}
                    </dd>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <dt>交易数量</dt>
                    <dd>
                      {quantity(transaction.amount, transaction.coin)} {transaction.coin}
                    </dd>
                  </div>
                  <div>
                    <dt>接收方</dt>
                    <dd className="wallet-address-value">
                      {transaction.recipient ?? '旧版记录未保存接收方'}
                    </dd>
                  </div>
                </>
              )}
              <div>
                <dt>模拟手续费</dt>
                <dd>0</dd>
              </div>
              <div>
                <dt>备注</dt>
                <dd>
                  {transaction.note ||
                    (transaction.kind === 'legacy' ? '从旧版钱包迁移的记录' : '无')}
                </dd>
              </div>
              <div>
                <dt>账户</dt>
                <dd className="wallet-address-value">{demoAddress}</dd>
              </div>
            </dl>
            <p className="wallet-note">该记录保存在本地设备，没有链上交易哈希。</p>
            {result ? (
              <Link className="primary full wallet-submit" to="/wallet">
                完成，返回钱包
              </Link>
            ) : (
              <Link className="wallet-secondary-link" to="/wallet/history">
                查看全部交易
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}
