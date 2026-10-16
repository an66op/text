import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  Clock3,
  Layers3,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { useWallet } from './useWallet';
import {
  coinInfo,
  DAY_MS,
  earnPreview,
  earnProducts,
  earnTotal,
  findEarnProduct,
  money,
  quantity,
  redeemEarn,
  subscribeEarn,
  validateEarnSubscription,
  type EarnPosition,
  type EarnProduct,
  type WalletState,
} from './wallet-model';

const formatYield = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 8 });
const date = (value: number) =>
  new Date(value).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
function DemoNote() {
  return <p className="wallet-earn-note">固定演示年化与报价；收益仅供模拟展示，赎回仅返还本金。</p>;
}

function EarnNav({ active }: { active: 'catalog' | 'positions' }) {
  return (
    <nav className="wallet-earn-nav" aria-label="理财导航">
      <Link
        className={active === 'catalog' ? 'active' : ''}
        to="/wallet/earn"
        aria-current={active === 'catalog' ? 'page' : undefined}
      >
        产品
      </Link>
      <Link
        className={active === 'positions' ? 'active' : ''}
        to="/wallet/earn/positions"
        aria-current={active === 'positions' ? 'page' : undefined}
      >
        持仓
      </Link>
    </nav>
  );
}
function ProductCard({ product }: { product: EarnProduct }) {
  return (
    <Link className="wallet-earn-product" to={`/wallet/earn/products/${product.id}`}>
      <div className="wallet-earn-product-top">
        <span className={`wallet-coin wallet-coin-${product.coin.toLowerCase()}`}>
          {coinInfo[product.coin].symbol}
        </span>
        <span>
          <strong>{product.name}</strong>
          <small>{coinInfo[product.coin].name}</small>
        </span>
        <span className="wallet-earn-term">
          {product.term === 'flexible' ? '活期' : `${product.days} 天`}
        </span>
      </div>
      <div className="wallet-earn-product-rate">
        <span>
          <small>演示年化</small>
          <strong>
            {product.apr.toFixed(1)}
            <em>%</em>
          </strong>
        </span>
        <ChevronRight size={20} />
      </div>
      <div className="wallet-earn-product-bottom">
        <span>
          {quantity(product.minimum, product.coin)} {product.coin} 起
        </span>
        <span>{product.term === 'flexible' ? '随时赎回' : '到期赎回'}</span>
      </div>
    </Link>
  );
}
function EarnCatalog({ state }: { state: WalletState }) {
  const [term, setTerm] = useState<'all' | 'flexible' | 'locked'>('all');
  const [query, setQuery] = useState('');
  const products = earnProducts.filter(
    (product) =>
      (term === 'all' || product.term === term) &&
      `${product.coin} ${product.name}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <>
      <EarnNav active="catalog" />
      <section className="wallet-earn-hero">
        <div>
          <span className="wallet-earn-eyebrow">
            <Sparkles size={14} /> EARN · 模拟理财
          </span>
          <h1>理财产品</h1>
          <p>
            活期随时赎回，
            <br />
            定期可选 7 天或 30 天。
          </p>
        </div>
        <div className="wallet-earn-hero-art" aria-hidden="true">
          <span>✦</span>
          <Layers3 size={56} strokeWidth={1.2} />
        </div>
        <Link to="/wallet/earn/positions">
          <span>
            我的理财本金<strong>${money(earnTotal(state))}</strong>
          </span>
          <span>
            查看持仓 <ChevronRight size={16} />
          </span>
        </Link>
      </section>
      <div className="wallet-earn-section-title">
        <h2>发现理财产品</h2>
        <span>{earnProducts.length} 款演示产品</span>
      </div>
      <div className="wallet-earn-controls">
        <div className="wallet-earn-tabs" aria-label="产品期限">
          {(
            [
              ['all', '全部'],
              ['flexible', '活期'],
              ['locked', '定期'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={term === value}
              className={term === value ? 'active' : ''}
              onClick={() => setTerm(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          aria-label="搜索理财币种"
          placeholder="搜索币种"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="wallet-earn-products">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
      {!products.length && (
        <div className="wallet-empty">
          <strong>没有找到产品</strong>
          <p>试试 ETH、BTC 或 USDC，或切换期限。</p>
          <button
            className="wallet-outline"
            onClick={() => {
              setQuery('');
              setTerm('all');
            }}
          >
            重置筛选
          </button>
        </div>
      )}
      <section className="wallet-earn-how">
        <h2>先了解，再体验</h2>
        <div>
          <Clock3 size={21} />
          <span>
            <strong>选一个适合的期限</strong>
            <small>活期随时赎回；定期在约定到期时间后手动赎回。</small>
          </span>
        </div>
        <div>
          <TrendingUp size={21} />
          <span>
            <strong>看得见资金的去向</strong>
            <small>申购后可用余额转入持仓，本金仍计入钱包总资产。</small>
          </span>
        </div>
      </section>
      <DemoNote />
    </>
  );
}
function EarnProductForm({
  product,
  state,
  commit,
}: {
  product: EarnProduct;
  state: WalletState;
  commit: ReturnType<typeof useWallet>['commit'];
}) {
  const [amount, setAmount] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const navigate = useNavigate();
  const numeric = Number(amount);
  const preview =
    Number.isFinite(numeric) && numeric > 0
      ? (((numeric * product.apr) / 100) * (product.days || 1)) / 365
      : 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    if (!accepted) {
      setError('请先确认演示规则');
      return;
    }
    submitting.current = true;
    try {
      commit((current) => subscribeEarn(current, product.id, amount, requestId));
      navigate('/wallet/earn/positions', { replace: true });
    } catch (caught) {
      submitting.current = false;
      setError(caught instanceof Error ? caught.message : '申购未完成，请重试');
    }
  };
  return (
    <>
      <section className="wallet-earn-product-hero">
        <span className={`wallet-coin wallet-coin-${product.coin.toLowerCase()}`}>
          {coinInfo[product.coin].symbol}
        </span>
        <h1>{product.name}</h1>
        <p>{product.description}</p>
        <small>固定演示年化</small>
        <strong>
          {product.apr.toFixed(1)}
          <em>%</em>
        </strong>
        <span className="wallet-earn-term">
          {product.days ? `${product.days} 天定期 · 到期赎回` : '活期 · 随时赎回'}
        </span>
      </section>
      <form onSubmit={submit} noValidate className="wallet-earn-subscribe">
        <div className="wallet-earn-section-title">
          <h2>申购数量</h2>
          <small>{product.coin}</small>
        </div>
        <label className="wallet-earn-amount">
          <input
            aria-label="申购数量"
            inputMode="decimal"
            maxLength={30}
            placeholder={`最低 ${product.minimum}`}
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setError('');
            }}
          />
          <strong>{product.coin}</strong>
        </label>
        <div className="wallet-earn-available">
          <span>
            可用 {quantity(state.balances[product.coin], product.coin)} {product.coin}
          </span>
          <button
            type="button"
            onClick={() => {
              const scale = 10 ** coinInfo[product.coin].decimals;
              setAmount(String(Math.floor(state.balances[product.coin] * scale) / scale));
              setError('');
            }}
          >
            全部
          </button>
        </div>
        <dl className="wallet-earn-details">
          <div>
            <dt>{product.days ? '模拟期限收益' : '模拟每日收益'}</dt>
            <dd>
              {formatYield(preview)} {product.coin}
            </dd>
          </div>
          <div>
            <dt>赎回规则</dt>
            <dd>
              {product.days
                ? `申购后锁定 ${product.days} 天，期间不可赎回`
                : '申购成功后可随时赎回'}
            </dd>
          </div>
          <div>
            <dt>到账内容</dt>
            <dd>仅本金 · 展示收益不入余额</dd>
          </div>
          <div>
            <dt>计息演示</dt>
            <dd>本金 × 演示年化 × 天数 ÷ 365</dd>
          </div>
        </dl>
        <label className="wallet-earn-consent">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => {
              setAccepted(event.target.checked);
              setError('');
            }}
          />
          <span>
            我了解这是本地模拟，{product.days ? '定期到期前无法赎回，' : ''}
            演示年化不是实际收益承诺。
          </span>
        </label>
        {error && (
          <p className="wallet-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary full wallet-earn-submit" disabled={!accepted}>
          确认模拟申购
        </button>
        <p className="wallet-earn-form-hint">
          {amount && validateEarnSubscription(state, product, amount)
            ? validateEarnSubscription(state, product, amount)
            : `最低 ${quantity(product.minimum, product.coin)} ${product.coin} · 无模拟手续费`}
        </p>
      </form>
      <DemoNote />
    </>
  );
}
function PositionCard({
  position,
  redeem,
  pending,
  now,
}: {
  position: EarnPosition;
  redeem: (id: string) => void;
  pending: string | null;
  now: number;
}) {
  const product = findEarnProduct(position.productId)!;
  const locked = now < position.unlockAt;
  const active = position.status === 'active';
  return (
    <article className="wallet-earn-position">
      <div className="wallet-earn-product-top">
        <span className={`wallet-coin wallet-coin-${position.coin.toLowerCase()}`}>
          {coinInfo[position.coin].symbol}
        </span>
        <span>
          <strong>{product.name}</strong>
          <small>{date(position.openedAt)} 申购</small>
        </span>
        <span className={`wallet-earn-position-status ${active ? '' : 'redeemed'}`}>
          {!active ? '已赎回' : locked ? '持有中' : '可赎回'}
        </span>
      </div>
      <div className="wallet-earn-position-metrics">
        <span>
          <small>{active ? '持仓本金' : '已返还本金'}</small>
          <strong>
            {quantity(position.principal, position.coin)} <em>{position.coin}</em>
          </strong>
        </span>
        <span>
          <small>演示年化</small>
          <strong>
            {position.apr.toFixed(1)}
            <em>%</em>
          </strong>
        </span>
      </div>
      <dl className="wallet-earn-details">
        <div>
          <dt>累计模拟收益 · 未入余额</dt>
          <dd>
            {formatYield(earnPreview(position, now))} {position.coin}
          </dd>
        </div>
        <div>
          <dt>{active ? '赎回时间' : '赎回完成'}</dt>
          <dd>
            {position.redeemedAt
              ? date(position.redeemedAt)
              : position.days
                ? `${date(position.unlockAt)} 后`
                : '随时可赎回'}
          </dd>
        </div>
      </dl>
      {active && (
        <div className="wallet-earn-position-actions">
          <Link to={`/wallet/earn/products/${product.id}`}>
            继续申购 <ArrowUpRight size={14} />
          </Link>
          <button
            className="wallet-outline"
            disabled={locked || pending === position.id}
            onClick={() => redeem(position.id)}
          >
            {locked ? '到期后可赎回' : pending === position.id ? '正在保存…' : '赎回本金'}
            <ArrowDownLeft size={15} />
          </button>
        </div>
      )}
    </article>
  );
}
function EarnPositions({
  state,
  commit,
}: {
  state: WalletState;
  commit: ReturnType<typeof useWallet>['commit'];
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const nextUnlock = Math.min(
      ...(state.earnPositions ?? [])
        .filter((position) => position.status === 'active' && position.unlockAt > now)
        .map((position) => position.unlockAt),
    );
    if (!Number.isFinite(nextUnlock)) return;
    // Long fixed terms exceed the browser timeout range; re-evaluate at least daily.
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(DAY_MS, Math.max(1, nextUnlock - now)),
    );
    return () => clearTimeout(timer);
  }, [state.earnPositions, now]);
  const [filter, setFilter] = useState<'active' | 'redeemed'>('active');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const submitting = useRef(false);
  const positions = (state.earnPositions ?? []).filter((position) => position.status === filter);
  const selected = state.earnPositions?.find((position) => position.id === confirmId);
  const totalPreview = (state.earnPositions ?? [])
    .filter((position) => position.status === 'active')
    .reduce(
      (total, position) => total + earnPreview(position, now) * coinInfo[position.coin].price,
      0,
    );
  const redeem = () => {
    if (!selected || submitting.current) return;
    submitting.current = true;
    setPending(selected.id);
    try {
      commit((current) => redeemEarn(current, selected.id, `redeem-${selected.id}`));
      setSuccess(
        `已赎回 ${quantity(selected.principal, selected.coin)} ${selected.coin}，本金已返还可用余额`,
      );
      setConfirmId(null);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '赎回未完成，请重试');
    } finally {
      setPending(null);
      submitting.current = false;
    }
  };
  return (
    <>
      <EarnNav active="positions" />
      <section className="wallet-earn-summary">
        <span>理财本金估值 · USD</span>
        <h1>${money(earnTotal(state))}</h1>
        <div>
          <span>
            累计模拟收益 · 未入余额<strong>${money(totalPreview)}</strong>
          </span>
          <Link to="/wallet/earn">
            继续发现 <ChevronRight size={16} />
          </Link>
        </div>
      </section>
      <div className="wallet-earn-section-title">
        <h2>我的持仓</h2>
        <span>
          {(state.earnPositions ?? []).filter((position) => position.status === 'active').length}{' '}
          笔持有中
        </span>
      </div>
      <div className="wallet-earn-tabs wallet-earn-position-tabs" aria-label="持仓状态">
        <button
          aria-pressed={filter === 'active'}
          className={filter === 'active' ? 'active' : ''}
          onClick={() => setFilter('active')}
        >
          持有中
        </button>
        <button
          aria-pressed={filter === 'redeemed'}
          className={filter === 'redeemed' ? 'active' : ''}
          onClick={() => setFilter('redeemed')}
        >
          已赎回
        </button>
      </div>
      {success && (
        <p role="status" className="wallet-earn-success">
          {success}
        </p>
      )}
      {error && !selected && (
        <p role="alert" className="wallet-error">
          {error}
        </p>
      )}
      <div className="wallet-earn-position-list">
        {positions.map((position) => (
          <PositionCard
            key={position.id}
            position={position}
            pending={pending}
            now={now}
            redeem={(id) => {
              setConfirmId(id);
              setError('');
              setSuccess('');
            }}
          />
        ))}
      </div>
      {!positions.length && (
        <div className="wallet-empty">
          <Layers3 size={40} className="wallet-earn-empty-icon" />
          <strong>{filter === 'active' ? '还没有理财持仓' : '还没有赎回记录'}</strong>
          <p>
            {filter === 'active'
              ? '从一笔活期开始，体验申购与赎回。'
              : '赎回本金后，可在这里查看已完成的持仓。'}
          </p>
          <Link className="primary full" to="/wallet/earn">
            浏览理财产品
          </Link>
        </div>
      )}
      {selected && (
        <section className="wallet-earn-confirm" role="region" aria-label="赎回确认">
          <h2>确认赎回本金？</h2>
          <p>
            {quantity(selected.principal, selected.coin)} {selected.coin}{' '}
            将返回可用余额，演示收益不计入到账数量。
          </p>
          {error && (
            <p role="alert" className="wallet-error">
              {error}
            </p>
          )}
          <div>
            <button
              className="wallet-outline"
              onClick={() => {
                setConfirmId(null);
                setError('');
              }}
            >
              取消
            </button>
            <button className="primary" onClick={redeem} disabled={pending !== null}>
              确认模拟赎回
            </button>
          </div>
        </section>
      )}
      <DemoNote />
    </>
  );
}
export default function WalletEarnPage({ kind }: { kind: 'catalog' | 'product' | 'positions' }) {
  const { state, commit } = useWallet();
  const { productId = '' } = useParams();
  const product = findEarnProduct(productId);
  const title = kind === 'product' ? '产品详情' : kind === 'positions' ? '我的理财' : '理财';
  return (
    <div className="wallet-page wallet-earn-page">
      <PageHeader
        title={title}
        backTo={kind === 'catalog' ? '/wallet' : '/wallet/earn'}
        action={
          kind === 'product' ? (
            <Link className="wallet-earn-header-link" to="/wallet/earn/positions">
              持仓
            </Link>
          ) : undefined
        }
      />
      <div className="wallet-content wallet-earn-content">
        {kind === 'catalog' ? (
          <EarnCatalog state={state} />
        ) : kind === 'positions' ? (
          <EarnPositions state={state} commit={commit} />
        ) : product ? (
          <EarnProductForm key={product.id} product={product} state={state} commit={commit} />
        ) : (
          <div className="wallet-empty">
            <strong>未找到这款理财产品</strong>
            <p>产品链接可能已失效，请返回产品。</p>
            <Link className="primary full" to="/wallet/earn">
              浏览理财产品
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
