import { useRef, useState, type FormEvent } from 'react';
import { ArrowDownUp } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { useWallet } from './useWallet';
import { coinInfo, coins, exchange, isCoin, quantity, roundCoin, type Coin } from './wallet-model';

export default function WalletExchangePage() {
  const [searchParams] = useSearchParams();
  const requestedCoin = searchParams.get('coin');
  const [from, setFrom] = useState<Coin>(isCoin(requestedCoin) ? requestedCoin : 'USDC');
  const [to, setTo] = useState<Coin>(requestedCoin === 'ETH' ? 'USDC' : 'ETH');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const { state, commit } = useWallet();
  const navigate = useNavigate();
  const submitting = useRef(false);
  const value = Number(amount);
  const quote =
    Number.isFinite(value) && value > 0
      ? roundCoin((value * coinInfo[from].price) / coinInfo[to].price, to)
      : 0;
  const valid =
    from !== to &&
    value > 0 &&
    Number.isFinite(value) &&
    value <= state.balances[from] &&
    roundCoin(value, from) === value &&
    quote > 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    try {
      const id = crypto.randomUUID();
      commit((current) => exchange(current, from, to, value, id));
      navigate(`/wallet/result/${id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '兑换未完成，请重试');
      submitting.current = false;
    }
  };
  return (
    <div className="wallet-page">
      <PageHeader title="兑换" backTo="/wallet" />
      <form className="wallet-content wallet-form" onSubmit={submit} noValidate>
        <p className="wallet-note">固定演示汇率，无实时行情与链上交易</p>
        <section className="wallet-exchange-box">
          <div className="wallet-section-heading">
            <h2>支付</h2>
            <select
              aria-label="支付币种"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value as Coin);
                setError('');
                setAmount('');
              }}
            >
              {coins.map((coin) => (
                <option key={coin}>{coin}</option>
              ))}
            </select>
          </div>
          <input
            className="wallet-exchange-amount"
            aria-label="兑换数量"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setError('');
            }}
          />
          <div className="wallet-balance-hint">
            <span>
              可用 {quantity(state.balances[from], from)} {from}
            </span>
            <button
              type="button"
              onClick={() =>
                setAmount(
                  String(
                    Math.floor(state.balances[from] * 10 ** coinInfo[from].decimals) /
                      10 ** coinInfo[from].decimals,
                  ),
                )
              }
            >
              全部
            </button>
          </div>
        </section>
        <button
          type="button"
          className="wallet-swap-button"
          aria-label="切换兑换方向"
          onClick={() => {
            setFrom(to);
            setTo(from);
            setAmount('');
            setError('');
          }}
        >
          <ArrowDownUp size={21} />
        </button>
        <section className="wallet-exchange-box">
          <div className="wallet-section-heading">
            <h2>预计收到</h2>
            <select
              aria-label="收到币种"
              value={to}
              onChange={(event) => {
                setTo(event.target.value as Coin);
                setError('');
              }}
            >
              {coins.map((coin) => (
                <option key={coin}>{coin}</option>
              ))}
            </select>
          </div>
          <strong className="wallet-exchange-quote">{quantity(quote, to)}</strong>
          <small>{coinInfo[to].name}</small>
        </section>
        <dl className="wallet-detail-card">
          <div>
            <dt>演示汇率</dt>
            <dd>
              1 {from} = {quantity(coinInfo[from].price / coinInfo[to].price, to)} {to}
            </dd>
          </div>
          <div>
            <dt>模拟手续费</dt>
            <dd>0</dd>
          </div>
          <div>
            <dt>到账方式</dt>
            <dd>即时更新本地余额</dd>
          </div>
        </dl>
        {from === to && (
          <p className="wallet-error" role="alert">
            请选择两种不同的资产
          </p>
        )}
        {value > state.balances[from] && (
          <p className="wallet-error" role="alert">
            {from} 可用余额不足
          </p>
        )}
        {error && (
          <p className="wallet-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary full wallet-submit" disabled={!valid}>
          确认模拟兑换
        </button>
        <p className="wallet-footnote">报价采用固定测试数据，成交数量按目标资产精度取整。</p>
      </form>
    </div>
  );
}
