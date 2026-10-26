import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  Droplets,
  ExternalLink,
  Link2,
  RefreshCw,
  Send,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { Link } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { apiRequest, ApiError, apiErrorMessage, isAbort } from '@/shared/api/client';
import { useAuth } from '@/features/platform/useAuth';
import { LoginNotice, PlatformError } from '@/features/platform/PlatformUi';
import { formatGem, parseGem, type TestWallet } from './wallet-model';
import { useBrowserWallet } from './useBrowserWallet';
import { clearPending, pendingKey, readPending, type Operation } from './pending-operation';
import './web3.css';

export default function Web3LabPage() {
  const { user } = useAuth();
  return <Web3AccountPage key={user?.id ?? 'guest'} />;
}

function Web3AccountPage() {
  const auth = useAuth();
  const userId = auth.user?.id;
  const browser = useBrowserWallet();
  const [wallet, setWallet] = useState<TestWallet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [operation, setOperation] = useState<Operation | null>(() =>
    userId ? readPending(userId) : null,
  );
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const currentUser = useRef(auth.user?.id);
  const dispatching = useRef(false);
  const readGeneration = useRef(0);
  currentUser.current = auth.user?.id;
  useEffect(() => {
    currentUser.current = userId;
    return () => {
      currentUser.current = undefined;
      readGeneration.current += 1;
    };
  }, [userId]);
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    const generation = ++readGeneration.current;
    setLoading(true);
    void apiRequest<TestWallet>('/wallet', { signal: controller.signal })
      .then((value) => {
        if (
          controller.signal.aborted ||
          currentUser.current !== userId ||
          generation !== readGeneration.current
        )
          return;
        setWallet(value);
        setError('');
      })
      .catch((caught) => {
        if (
          !controller.signal.aborted &&
          currentUser.current === userId &&
          generation === readGeneration.current &&
          !isAbort(caught)
        )
          setError(apiErrorMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [userId, refresh]);
  const execute = async (action: Operation) => {
    if (!auth.user || dispatching.current) return;
    const userId = auth.user.id;
    dispatching.current = true;
    // A previously started balance read must not overwrite a more recent ledger response.
    readGeneration.current += 1;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      // Store the id before dispatch, so a lost response or refresh can safely retry.
      sessionStorage.setItem(pendingKey(userId), JSON.stringify(action));
      const value = await apiRequest<TestWallet>(`/wallet/${action.kind}`, {
        method: 'POST',
        body: JSON.stringify({
          requestId: action.requestId,
          ...(action.kind === 'transfer'
            ? { recipientHandle: action.recipientHandle, amount: action.amount }
            : {}),
        }),
      });
      clearPending(userId, action.requestId);
      if (currentUser.current !== userId) return;
      setWallet(value);
      setOperation(null);
      setRefresh((value) => value + 1);
      setSuccess(
        action.kind === 'faucet'
          ? '1,000.00 测试 GEM 已到账'
          : `已向 @${action.recipientHandle} 转入 ${formatGem(action.amount!)} 测试 GEM`,
      );
      setRecipient('');
      setAmount('');
    } catch (caught) {
      if (currentUser.current !== userId) return;
      const knownFailure =
        caught instanceof ApiError && caught.status >= 400 && caught.status < 500;
      if (knownFailure) {
        try {
          clearPending(userId, action.requestId);
        } catch {
          /* Retaining a failed request is safe to retry. */
        }
        setOperation(null);
      }
      setError(
        `${apiErrorMessage(caught)}${knownFailure ? '' : '。请使用下方同一笔请求重试，避免重复记账。'}`,
      );
    } finally {
      dispatching.current = false;
      if (currentUser.current === userId) setBusy(false);
    }
  };
  const prepare = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    const handle = recipient.trim().replace(/^@/, '').toLowerCase();
    const units = parseGem(amount);
    if (!/^[a-z][a-z0-9_]{2,29}$/.test(handle)) {
      setError('收款用户名应为 3–30 位小写字母、数字或下划线，以字母开头');
      return;
    }
    if (!units) {
      setError('请输入大于 0 且最多两位小数的测试 GEM 数量');
      return;
    }
    if (handle === auth.user?.handle) {
      setError('请选择其他成员作为收款人');
      return;
    }
    if (
      BigInt(units) > BigInt(wallet?.assets.find((entry) => entry.symbol === 'GEM')?.balance || '0')
    ) {
      setError('测试 GEM 余额不足，请先领取测试积分');
      return;
    }
    setOperation({
      kind: 'transfer',
      requestId: crypto.randomUUID(),
      recipientHandle: handle,
      amount: units,
    });
  };
  const faucet = () => {
    const action: Operation = { kind: 'faucet', requestId: crypto.randomUUID() };
    setOperation(action);
    void execute(action);
  };
  return (
    <section className="web3-page">
      <PageHeader
        title="Web3"
        backTo="/wallet"
        action={
          <button
            aria-label="刷新测试账本"
            onClick={() => setRefresh((value) => value + 1)}
            disabled={loading || busy}
          >
            <RefreshCw size={19} />
          </button>
        }
      />
      <div className="web3-content">
        <section className="web3-intro">
          <span className="web3-eyebrow">GONGMING LAB</span>
          <h1>连接你的数字世界</h1>
          <p>从一枚测试积分，体验属于社区的价值流动。</p>
        </section>
        <section className="web3-balance">
          <div className="web3-card-top">
            <span>
              <i />
              服务器测试账本
            </span>
            <Wallet size={22} />
          </div>
          <p>可用测试积分</p>
          <h2>
            {wallet
              ? formatGem(wallet.assets.find((entry) => entry.symbol === 'GEM')?.balance || '0')
              : '—'}
            <small>GEM</small>
          </h2>
          <div className="web3-balance-footer">
            <span>无现金价值 · 不可充值或提现</span>
            <ShieldCheck size={17} />
          </div>
        </section>
        <PlatformError
          message={error}
          retry={!operation ? () => setRefresh((value) => value + 1) : undefined}
        />
        {success && (
          <p className="web3-success" role="status">
            <Check size={17} />
            {success}
          </p>
        )}
        {!auth.user ? (
          <LoginNotice returnTo="/web3" text="登录账号，领取并转送社区测试积分" />
        ) : (
          <>
            <section className="web3-faucet">
              <span className="web3-soft-icon">
                <Droplets size={23} />
              </span>
              <div>
                <strong>每日测试补给</strong>
                <p>每 24 小时可领 1,000 GEM</p>
              </div>
              <button disabled={busy || !!operation || loading} onClick={faucet}>
                领取
              </button>
            </section>
            {loading && !wallet && (
              <p role="status" className="web3-note">
                正在读取服务器账本…
              </p>
            )}
            <form className="web3-transfer web3-panel" onSubmit={prepare}>
              <div className="web3-section-title">
                <h2>把共鸣送给朋友</h2>
                <Send size={18} />
              </div>
              <label>
                收款用户名
                <input
                  autoComplete="off"
                  placeholder="例如 demo 或 gongming"
                  value={recipient}
                  disabled={busy || !!operation}
                  onChange={(event) => setRecipient(event.target.value)}
                  maxLength={31}
                />
              </label>
              <label>
                测试 GEM 数量
                <div className="web3-amount-input">
                  <input
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    disabled={busy || !!operation}
                    onChange={(event) => setAmount(event.target.value)}
                    maxLength={12}
                  />
                  <span>GEM</span>
                </div>
              </label>
              <button
                className="web3-primary"
                type="submit"
                disabled={busy || !!operation || !wallet}
              >
                下一步 <ArrowUpRight size={17} />
              </button>
            </form>
            {operation && (
              <section className="web3-review web3-panel" aria-label="确认测试记账">
                <h2>{operation.kind === 'transfer' ? '确认这笔测试转送' : '测试补给请求'}</h2>
                <p>
                  {operation.kind === 'transfer'
                    ? `向 @${operation.recipientHandle} 转送 ${formatGem(operation.amount!)} GEM`
                    : '领取 1,000.00 GEM'}
                </p>
                <small>请求编号 {operation.requestId.slice(0, 12)} · 重试使用同一编号</small>
                <button
                  type="button"
                  className="web3-primary"
                  disabled={busy}
                  onClick={() => void execute(operation)}
                >
                  {busy ? '正在核对账本…' : '确认 / 重试这笔请求'}
                </button>
                {!readPending(auth.user.id) && (
                  <button
                    type="button"
                    className="web3-secondary"
                    disabled={busy}
                    onClick={() => setOperation(null)}
                  >
                    返回修改
                  </button>
                )}
              </section>
            )}
          </>
        )}
        <section className="web3-browser web3-panel">
          <div className="web3-section-title">
            <h2>连接浏览器钱包</h2>
            <Link2 size={20} />
          </div>
          <p className="web3-note">读取公开地址与网络。连接后可展示你的链上身份。</p>
          {browser.address ? (
            <div className="web3-connected">
              <span>
                <i />
                {browser.name} 已连接
              </span>
              <code>{browser.address}</code>
              <small>网络编号 {BigInt(browser.chain || '0x0').toString()} · 公开地址连接</small>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(browser.address)
                      .then(() => setCopied(true))
                      .catch(() => setCopied(false));
                  }}
                >
                  <Copy size={15} />
                  {copied ? '已复制' : '复制地址'}
                </button>
                <button type="button" onClick={browser.disconnect}>
                  断开本站连接
                </button>
              </div>
            </div>
          ) : browser.wallets.length ? (
            <div className="web3-wallet-options">
              {browser.wallets.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  disabled={browser.busy}
                  onClick={() => void browser.connect(entry.id)}
                >
                  <span>
                    <Wallet size={19} />
                    {entry.name}
                  </span>
                  <ChevronRight size={17} />
                </button>
              ))}
            </div>
          ) : (
            <div className="web3-no-wallet">
              <Wallet size={27} />
              <span>当前浏览器未检测到钱包扩展</span>
              <small>在安装了钱包的浏览器中打开此页即可连接</small>
            </div>
          )}
          <PlatformError message={browser.error} />
          <p className="web3-note web3-wallet-disclosure">
            公开地址与上方测试账本分别管理。尚未开放签名登录、真实资产交易和收益产品。
          </p>
        </section>
        <section className="web3-panel">
          <div className="web3-section-title">
            <h2>测试积分记录</h2>
            <span>{wallet?.transactions.length ?? 0} 笔</span>
          </div>
          {wallet?.transactions.length ? (
            <div className="web3-ledger">
              {wallet.transactions.map((entry) => (
                <article key={entry.id}>
                  <span
                    className={`web3-ledger-icon ${entry.kind === 'transfer_out' ? 'out' : ''}`}
                  >
                    {entry.kind === 'transfer_out' ? (
                      <ArrowUpRight size={19} />
                    ) : (
                      <ArrowDownLeft size={19} />
                    )}
                  </span>
                  <div>
                    <strong>
                      {entry.kind === 'faucet'
                        ? '测试补给'
                        : entry.kind === 'transfer_out'
                          ? `转送给 @${entry.counterparty}`
                          : `来自 @${entry.counterparty}`}
                    </strong>
                    <small>
                      {new Date(entry.createdAt).toLocaleString('zh-CN', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </small>
                  </div>
                  <b className={entry.kind === 'transfer_out' ? '' : 'positive'}>
                    {entry.kind === 'transfer_out' ? '' : '+'}
                    {formatGem(entry.amount)}
                  </b>
                </article>
              ))}
            </div>
          ) : (
            <p className="web3-note">还没有测试记账记录，领取每日补给开始体验。</p>
          )}
        </section>
        <Link className="web3-account-link" to="/account">
          管理共鸣账号 <ExternalLink size={14} />
        </Link>
      </div>
    </section>
  );
}
