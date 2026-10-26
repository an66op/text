import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronRight,
  History,
  Send,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { Link } from 'react-router';
import { paths } from '@/shared/config/paths';
import PageHeader from '@/shared/ui/PageHeader';
import { useWallet } from './useWallet';
import {
  coinInfo,
  coins,
  earnPrincipal,
  earnTotal,
  money,
  quantity,
  walletTotal,
} from './wallet-model';
import TransactionList from './WalletTransactionList';
import './wallet.css';

export default function WalletPage() {
  const { state } = useWallet();
  return (
    <div className="wallet-page">
      <PageHeader
        title="钱包"
        backTo={paths.me}
        action={
          <Link aria-label="交易记录" to="/wallet/history">
            <History size={21} />
          </Link>
        }
      />
      <div className="wallet-content">
        <section className="wallet-balance-card">
          <span className="wallet-demo-pill">本地模拟钱包</span>
          <p>总资产估值 · USD</p>
          <h1>
            <small>$</small>
            {money(walletTotal(state))}
          </h1>
          <small>固定演示报价 · 所有操作仅保存在这台设备</small>
          <div className="wallet-actions">
            <Link to="/wallet/transfer">
              <Send size={21} />
              转账
            </Link>
            <Link to="/wallet/receive">
              <ArrowDownLeft size={23} />
              收款
            </Link>
            <Link to="/wallet/exchange">
              <ArrowLeftRight size={23} />
              兑换
            </Link>
          </div>
        </section>
        <Link className="wallet-earn-entry" to={paths.web3}>
          <Sparkles size={23} />
          <span>
            <strong>Web3 实验室</strong>
            <small>服务器测试积分 · 浏览器钱包连接</small>
          </span>
          <ChevronRight size={18} />
        </Link>
        <Link className="wallet-earn-entry" to="/wallet/earn">
          <TrendingUp size={23} />
          <span>
            <strong>理财 · EARN</strong>
            <small>
              {earnTotal(state) > 0
                ? `持仓本金 $${money(earnTotal(state))} · 查看我的理财`
                : '活期与定期，让持有多一种可能'}
            </small>
          </span>
          <ChevronRight size={18} />
        </Link>
        <div className="wallet-section-heading">
          <h2>我的资产</h2>
          <span>{coins.length} 种资产</span>
        </div>
        <div className="wallet-list-card">
          {coins.map((coin) => (
            <Link className="wallet-asset-row" to={`/wallet/assets/${coin}`} key={coin}>
              <b className={`wallet-coin wallet-coin-${coin.toLowerCase()}`}>
                {coinInfo[coin].symbol}
              </b>
              <span className="wallet-row-copy">
                <strong>{coinInfo[coin].name}</strong>
                <small>
                  {quantity(state.balances[coin] + earnPrincipal(state, coin), coin)} {coin}
                </small>
              </span>
              <span className="wallet-row-value">
                <strong>
                  $
                  {money(
                    (state.balances[coin] + earnPrincipal(state, coin)) * coinInfo[coin].price,
                  )}
                </strong>
                <small>
                  {earnPrincipal(state, coin) > 0
                    ? `理财中 ${quantity(earnPrincipal(state, coin), coin)} ${coin}`
                    : '演示估值'}
                </small>
              </span>
              <ChevronRight size={16} />
            </Link>
          ))}
        </div>
        <div className="wallet-section-heading">
          <h2>最近交易</h2>
          <Link to="/wallet/history">
            全部记录 <ChevronRight size={15} />
          </Link>
        </div>
        <TransactionList transactions={state.transactions.slice(0, 4)} />
        <p className="wallet-footnote">
          <ArrowUpRight size={15} />
          体验资产管理流程；这里的地址与资产均为测试数据。
        </p>
      </div>
    </div>
  );
}
