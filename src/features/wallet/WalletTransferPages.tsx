import { useRef, useState, type FormEvent } from 'react';
import { Check, ShieldCheck } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { readStorage, writeStorage } from '@/shared/lib/storage';
import PageHeader from '@/shared/ui/PageHeader';
import { useWallet } from './useWallet';
import {
  coinInfo,
  coins,
  demoAddress,
  DRAFT_KEY,
  isCoin,
  isDraft,
  quantity,
  transfer,
  validateTransfer,
  type TransferDraft,
} from './wallet-model';

const emptyDraft: TransferDraft = { coin: 'USDC', amount: '', recipient: '', note: '' };
export function TransferPage() {
  const [searchParams] = useSearchParams();
  const requestedCoin = searchParams.get('coin');
  const [draft, setDraft] = useState(() => ({
    ...readStorage(DRAFT_KEY, emptyDraft, isDraft),
    ...(isCoin(requestedCoin) ? { coin: requestedCoin } : {}),
  }));
  const [error, setError] = useState('');
  const { state } = useWallet();
  const navigate = useNavigate();
  const update = (changes: Partial<TransferDraft>) => {
    const next = { ...draft, ...changes, requestId: undefined };
    setDraft(next);
    setError('');
    writeStorage(DRAFT_KEY, next);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const issue = validateTransfer(draft, state);
    if (issue) {
      setError(issue);
      return;
    }
    const reviewDraft = { ...draft, requestId: draft.requestId || crypto.randomUUID() };
    if (!writeStorage(DRAFT_KEY, reviewDraft)) {
      setError('草稿未能保存，请清理浏览器空间后重试');
      return;
    }
    navigate('/wallet/transfer/review');
  };
  return (
    <div className="wallet-page">
      <PageHeader title="转账" backTo="/wallet" />
      <form className="wallet-content wallet-form" onSubmit={submit} noValidate>
        <div className="wallet-note">
          <ShieldCheck size={18} />
          <span>本地模拟转账，不会发送链上交易</span>
        </div>
        <label className="wallet-field-label">
          转账资产
          <select
            aria-label="转账资产"
            className="field"
            value={draft.coin}
            onChange={(event) =>
              update({ coin: event.target.value as TransferDraft['coin'], amount: '' })
            }
          >
            {coins.map((coin) => (
              <option key={coin}>{coin}</option>
            ))}
          </select>
        </label>
        <label className="wallet-field-label">
          接收方演示地址
          <input
            className="field"
            aria-label="接收方演示地址"
            placeholder="例如 DEMO:alice_wallet"
            value={draft.recipient}
            maxLength={100}
            onChange={(event) => update({ recipient: event.target.value })}
          />
        </label>
        <div className="wallet-recipient-examples">
          <span>测试联系人</span>
          <button type="button" onClick={() => update({ recipient: 'DEMO:alice_wallet' })}>
            阿川
          </button>
          <button type="button" onClick={() => update({ recipient: 'DEMO:lin_wallet' })}>
            林小满
          </button>
        </div>
        <label className="wallet-field-label">
          转账数量
          <div className="wallet-amount-input">
            <input
              aria-label="转账数量"
              inputMode="decimal"
              placeholder="0.00"
              value={draft.amount}
              onChange={(event) => update({ amount: event.target.value })}
            />
            <strong>{draft.coin}</strong>
          </div>
        </label>
        <div className="wallet-balance-hint">
          <span>
            可用 {quantity(state.balances[draft.coin], draft.coin)} {draft.coin}
          </span>
          <button
            type="button"
            onClick={() =>
              update({
                amount: String(
                  Math.floor(state.balances[draft.coin] * 10 ** coinInfo[draft.coin].decimals) /
                    10 ** coinInfo[draft.coin].decimals,
                ),
              })
            }
          >
            全部
          </button>
        </div>
        <label className="wallet-field-label">
          备注 <small>可选</small>
          <textarea
            className="field"
            aria-label="转账备注"
            value={draft.note}
            maxLength={100}
            placeholder="给这次转账写个备注"
            onChange={(event) => update({ note: event.target.value })}
          />
        </label>
        {error && (
          <p role="alert" className="wallet-error">
            {error}
          </p>
        )}
        <button className="primary full wallet-submit">下一步</button>
        <p className="wallet-footnote">网络：{coinInfo[draft.coin].network} · 模拟手续费 0</p>
      </form>
    </div>
  );
}

function loadReviewDraft(): TransferDraft | null {
  const stored = readStorage<TransferDraft | null>(DRAFT_KEY, null, isDraft);
  if (!stored || stored.requestId) return stored;
  const draft = { ...stored, requestId: crypto.randomUUID() };
  return writeStorage(DRAFT_KEY, draft) ? draft : null;
}

export function TransferReviewPage() {
  const [draft] = useState(loadReviewDraft);
  const { state, commit } = useWallet();
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const submitting = useRef(false);
  const issue = draft ? validateTransfer(draft, state) : '转账草稿不存在或已完成';
  const confirm = () => {
    if (!draft || submitting.current) return;
    submitting.current = true;
    try {
      const latestDraft = readStorage<TransferDraft | null>(DRAFT_KEY, null, isDraft);
      if (
        !latestDraft ||
        latestDraft.requestId !== draft.requestId ||
        latestDraft.coin !== draft.coin ||
        latestDraft.amount !== draft.amount ||
        latestDraft.recipient !== draft.recipient ||
        latestDraft.note !== draft.note
      ) {
        throw new Error('转账草稿已完成或已在其他页面修改，请返回重新填写');
      }
      const id = draft.requestId!;
      commit((current) => transfer(current, draft, id));
      localStorage.removeItem(DRAFT_KEY);
      navigate(`/wallet/result/${id}`, { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '转账未完成，请重试');
      submitting.current = false;
    }
  };
  return (
    <div className="wallet-page">
      <PageHeader title="确认转账" backTo="/wallet/transfer" />
      <div className="wallet-content">
        {issue ? (
          <div className="wallet-empty">
            <strong>无法继续转账</strong>
            <p>{issue}</p>
            <Link className="primary full" to="/wallet/transfer">
              返回修改
            </Link>
          </div>
        ) : (
          draft && (
            <>
              <div className="wallet-review-amount">
                <span>转账数量</span>
                <h1>
                  {draft.amount} <small>{draft.coin}</small>
                </h1>
                <p>请核对接收方与数量</p>
              </div>
              <dl className="wallet-detail-card">
                <div>
                  <dt>接收方</dt>
                  <dd className="wallet-address-value">{draft.recipient}</dd>
                </div>
                <div>
                  <dt>发送方</dt>
                  <dd className="wallet-address-value">{demoAddress}</dd>
                </div>
                <div>
                  <dt>网络</dt>
                  <dd>{coinInfo[draft.coin].network}</dd>
                </div>
                <div>
                  <dt>模拟手续费</dt>
                  <dd>0 {draft.coin}</dd>
                </div>
                <div>
                  <dt>备注</dt>
                  <dd>{draft.note || '未填写'}</dd>
                </div>
              </dl>
              <div className="wallet-note">
                <Check size={18} />
                <span>确认后扣除本地模拟余额并生成交易记录</span>
              </div>
              {error && (
                <p className="wallet-error" role="alert">
                  {error}
                </p>
              )}
              <button className="primary full wallet-submit" onClick={confirm}>
                确认模拟转账
              </button>
              <Link className="wallet-secondary-link" to="/wallet/transfer">
                修改转账信息
              </Link>
            </>
          )
        )}
      </div>
    </div>
  );
}
