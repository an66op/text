import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, ChevronRight, Wallet } from 'lucide-react';
import { accountEpoch } from '@/shared/api/account-guard';
import { ApiError, isAbort } from '@/shared/api/client';
import { isUnconfirmedAuthWrite } from '@/shared/api/auth-context';
import { useAuth } from '@/features/platform/useAuth';
import { PlatformError } from '@/features/platform/PlatformUi';
import { useBrowserWallet, type WalletSnapshot } from '@/features/web3/useBrowserWallet';
import { walletIdentityApi } from './api';
import { validateChallenge, walletAvailable, walletFailure } from './model';
import type { PreparedChallenge, WalletConfig } from './types';

type Preview = { value: PreparedChallenge; snapshot: WalletSnapshot; epoch: number };
export default function WalletIdentityFlow({
  purpose,
  config,
  disabled = false,
  onComplete,
  onUnknown,
}: {
  purpose: 'login' | 'bind';
  config: WalletConfig;
  disabled?: boolean;
  onComplete: () => void;
  onUnknown?: () => Promise<boolean> | boolean | void;
}) {
  const auth = useAuth(),
    browser = useBrowserWallet();
  const [password, setPassword] = useState(''),
    [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const active = useRef(true),
    attempt = useRef(0),
    locked = useRef(false),
    request = useRef<AbortController | null>(null),
    ownLogin = useRef(false),
    uncertainRef = useRef(false),
    submission = useRef<{ epoch: number; reported: boolean } | null>(null),
    reconciliation = useRef({ onUnknown, refresh: auth.refresh });
  reconciliation.current = { onUnknown, refresh: auth.refresh };
  const reportUnknown = useCallback((pending: { epoch: number; reported: boolean }) => {
    if (!active.current || pending.epoch !== accountEpoch() || pending.reported) return;
    pending.reported = true;
    uncertainRef.current = true;
    setUncertain(true);
    setError('结果尚未确认，请刷新当前身份或绑定记录后再操作');
    void Promise.resolve(reconciliation.current.onUnknown?.()).catch(() => {});
    void reconciliation.current.refresh();
  }, []);
  const invalidate = useCallback(() => {
    if (submission.current) reportUnknown(submission.current);
    attempt.current++;
    request.current?.abort();
    request.current = null;
    locked.current = false;
    setBusy(false);
    setPreview(null);
    setPassword('');
  }, [reportUnknown]);
  const dispose = useCallback(() => {
    active.current = false;
    attempt.current++;
    request.current?.abort();
  }, []);
  useEffect(() => {
    active.current = true;
    return dispose;
  }, [dispose]);
  useEffect(() => {
    invalidate();
  }, [browser.address, browser.chainId, browser.version, invalidate]);
  useEffect(() => {
    if (!ownLogin.current) invalidate();
  }, [auth.user?.id, auth.expiresAt, invalidate]);
  useEffect(() => {
    if (!preview) return;
    const timer = window.setTimeout(
      () => {
        invalidate();
        if (!submission.current) setError('签名请求已过期，请重新获取');
      },
      Math.max(0, Date.parse(preview.value.challenge.expiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [preview, invalidate]);
  const valid = (version: number, epoch: number, controller: AbortController) =>
    active.current &&
    version === attempt.current &&
    !controller.signal.aborted &&
    epoch === accountEpoch();
  const challenge = async (event: FormEvent) => {
    event.preventDefault();
    if (
      locked.current ||
      uncertainRef.current ||
      disabled ||
      !walletAvailable(config, window.location.origin)
    )
      return;
    locked.current = true;
    setBusy(true);
    setError('');
    setSuccess(false);
    setPreview(null);
    const version = ++attempt.current,
      epoch = accountEpoch(),
      controller = new AbortController();
    request.current = controller;
    const proofPassword = password;
    setPassword('');
    try {
      const snapshot = browser.snapshot();
      if (!config.chains.includes(snapshot.chainId))
        throw new Error('当前钱包网络不支持身份验证，请在钱包中切换网络');
      await browser.ensureSnapshot(snapshot);
      if (!valid(version, epoch, controller)) return;
      const assertActive = () => {
        if (!valid(version, epoch, controller)) throw new Error('钱包或账号状态已变化，请重新确认');
        browser.checkSnapshot(snapshot);
      };
      assertActive();
      const value = await walletIdentityApi.challenge(
        {
          purpose,
          address: snapshot.address,
          chainId: snapshot.chainId,
          ...(purpose === 'bind' ? { password: proofPassword } : {}),
        },
        controller.signal,
        assertActive,
      );
      if (!valid(version, epoch, controller)) return;
      await browser.ensureSnapshot(snapshot);
      browser.checkSnapshot(snapshot);
      if (valid(version, epoch, controller))
        setPreview({
          value: validateChallenge(value, snapshot, purpose, window.location.origin, auth.user?.id),
          snapshot,
          epoch,
        });
    } catch (caught) {
      if (valid(version, epoch, controller) && !isAbort(caught)) {
        setError(walletFailure(caught));
        if (caught instanceof ApiError && caught.status === 401) void auth.refresh();
      }
    } finally {
      if (active.current && version === attempt.current) {
        locked.current = false;
        setBusy(false);
        request.current = null;
      }
    }
  };
  const sign = async () => {
    if (!preview || disabled || locked.current || uncertainRef.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    const version = ++attempt.current,
      controller = new AbortController();
    request.current = controller;
    let submitted = false;
    let pendingBind: { epoch: number; reported: boolean } | null = null;
    try {
      if (preview.epoch !== accountEpoch()) throw new Error('账号状态已更新，请重新获取签名请求');
      validateChallenge(
        preview.value,
        preview.snapshot,
        purpose,
        window.location.origin,
        auth.user?.id,
      );
      const signature = await browser.signMessage(
        preview.snapshot,
        preview.value.challenge.message,
      );
      if (!valid(version, preview.epoch, controller)) return;
      await browser.ensureSnapshot(preview.snapshot);
      if (!valid(version, preview.epoch, controller)) return;
      browser.checkSnapshot(preview.snapshot);
      const proof = {
        id: preview.value.challenge.id,
        message: preview.value.challenge.message,
        signature,
        contextGeneration: preview.value.generation,
        assertActive: () => {
          if (
            !active.current ||
            version !== attempt.current ||
            controller.signal.aborted ||
            (purpose === 'bind' && preview.epoch !== accountEpoch())
          )
            throw new Error('钱包或账号状态已变化，请重新确认');
          browser.checkSnapshot(preview.snapshot);
        },
      };
      submitted = true;
      if (purpose === 'login') {
        ownLogin.current = true;
        const accepted = await auth.loginWallet(
          { ...proof, expectedEpoch: preview.epoch },
          controller.signal,
        );
        if (accepted) browser.checkSnapshot(preview.snapshot);
        if (active.current && version === attempt.current && accepted) {
          setPreview(null);
          setSuccess(true);
          onComplete();
        } else if (active.current && version === attempt.current) {
          setError('登录结果已变化，请刷新当前身份后重新确认');
          setPreview(null);
        }
      } else {
        pendingBind = { epoch: preview.epoch, reported: false };
        submission.current = pendingBind;
        await walletIdentityApi.bind(proof, controller.signal);
        browser.checkSnapshot(preview.snapshot);
        if (valid(version, preview.epoch, controller)) {
          setPreview(null);
          setSuccess(true);
          onComplete();
        }
      }
    } catch (caught) {
      if (active.current && version === attempt.current && !controller.signal.aborted) {
        setPreview(null);
        const unknown = submitted && isUnconfirmedAuthWrite(caught);
        setError(
          unknown ? '结果尚未确认，请刷新当前身份或绑定记录后再操作' : walletFailure(caught),
        );
        if (unknown) {
          if (pendingBind) reportUnknown(pendingBind);
          else void auth.refresh();
        } else if (caught instanceof ApiError && caught.status === 401) void auth.refresh();
      }
    } finally {
      if (pendingBind && submission.current === pendingBind) submission.current = null;
      ownLogin.current = false;
      if (active.current && version === attempt.current) {
        locked.current = false;
        setBusy(false);
        request.current = null;
      }
    }
  };
  const confirmUnknown = async () => {
    if (locked.current || !uncertainRef.current || !active.current) return;
    locked.current = true;
    setBusy(true);
    const epoch = accountEpoch();
    try {
      const [confirmed] = await Promise.all([
        reconciliation.current.onUnknown?.(),
        reconciliation.current.refresh(),
      ]);
      if (!active.current || epoch !== accountEpoch()) return;
      if (confirmed === true) {
        uncertainRef.current = false;
        setUncertain(false);
        setError('');
      } else setError('仍未确认绑定结果，请检查连接后再次刷新');
    } catch (caught) {
      if (active.current && epoch === accountEpoch()) setError(walletFailure(caught));
    } finally {
      if (active.current && epoch === accountEpoch()) {
        locked.current = false;
        setBusy(false);
      }
    }
  };
  if (!walletAvailable(config, window.location.origin))
    return <p className="wallet-id-note">当前网站尚未启用钱包身份，请使用邮箱和密码登录。</p>;
  return (
    <section
      className="wallet-id-flow"
      aria-label={purpose === 'login' ? '钱包登录步骤' : '绑定钱包步骤'}
    >
      <div className="wallet-id-step">
        <span>01</span>
        <h2>选择钱包</h2>
      </div>
      {browser.address ? (
        <div className="wallet-id-connected">
          <span>
            <i />
            {browser.name}
          </span>
          <code>{browser.address}</code>
          <small>
            网络 {browser.chainId} ·{' '}
            {config.chains.includes(browser.chainId) ? '支持身份验证' : '请切换支持的网络'}
          </small>
          <button
            type="button"
            onClick={() => {
              invalidate();
              browser.disconnect();
            }}
            disabled={submittedLogin(busy, ownLogin.current)}
          >
            断开本站连接
          </button>
        </div>
      ) : browser.wallets.length ? (
        <div className="wallet-id-options">
          {browser.wallets.map((wallet) => (
            <button
              key={wallet.id}
              type="button"
              disabled={disabled || busy || browser.busy}
              onClick={() => {
                invalidate();
                void browser.connect(wallet.id);
              }}
            >
              <Wallet size={20} />
              <span>{wallet.name}</span>
              <ChevronRight size={17} />
            </button>
          ))}
        </div>
      ) : (
        <p className="wallet-id-note">未检测到钱包扩展，请在安装钱包的浏览器中打开。</p>
      )}
      <PlatformError message={browser.error} />
      {browser.address && !uncertain && (
        <form onSubmit={(event) => void challenge(event)} className="wallet-id-challenge">
          <div className="wallet-id-step">
            <span>02</span>
            <h2>核对签名请求</h2>
          </div>
          {purpose === 'bind' && !preview && (
            <label>
              当前账号密码
              <input
                aria-label="当前账号密码"
                required
                type="password"
                autoComplete="current-password"
                maxLength={72}
                value={password}
                disabled={busy || disabled}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          )}
          {!preview && (
            <button
              type="submit"
              className="platform-primary"
              disabled={
                busy || browser.busy || disabled || !config.chains.includes(browser.chainId)
              }
            >
              {busy ? '正在获取…' : '获取签名请求'}
            </button>
          )}
        </form>
      )}
      {preview && (
        <section className="wallet-id-preview" aria-label="完整签名内容">
          <p>
            请核对网站、地址、网络和用途。此签名仅用于
            {purpose === 'login' ? '登录已有账号' : '绑定当前账号'}，不授权交易。
          </p>
          <pre tabIndex={0}>{preview.value.challenge.message}</pre>
          <small>
            有效期至 {new Date(preview.value.challenge.expiresAt).toLocaleTimeString('zh-CN')} ·
            不支持合约钱包
          </small>
          <button
            type="button"
            className="platform-primary"
            disabled={busy || disabled}
            onClick={() => void sign()}
          >
            {busy ? '等待钱包与服务器确认…' : purpose === 'login' ? '签名并登录' : '签名并绑定'}
          </button>
          <button className="wallet-id-text" type="button" disabled={busy} onClick={invalidate}>
            取消此请求
          </button>
        </section>
      )}
      <PlatformError message={error} />
      {uncertain && (
        <button
          type="button"
          className="platform-secondary"
          disabled={busy}
          onClick={() => void confirmUnknown()}
        >
          {busy ? '正在确认…' : '刷新确认结果'}
        </button>
      )}
      {success && (
        <p className="wallet-id-success" role="status">
          <Check size={17} />
          {purpose === 'login' ? '服务器已确认登录' : '钱包已绑定当前账号'}
        </p>
      )}
    </section>
  );
}
function submittedLogin(busy: boolean, ownLogin: boolean) {
  return busy && ownLogin;
}
