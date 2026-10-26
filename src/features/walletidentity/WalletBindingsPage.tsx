import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import PageHeader from '@/shared/ui/PageHeader';
import ActionDialog from '@/shared/ui/ActionDialog';
import { accountEpoch } from '@/shared/api/account-guard';
import { isAbort } from '@/shared/api/client';
import { isUnconfirmedAuthWrite } from '@/shared/api/auth-context';
import { useAuth } from '@/features/platform/useAuth';
import { LoginNotice, PlatformError } from '@/features/platform/PlatformUi';
import { walletIdentityApi } from './api';
import { walletFailure } from './model';
import { useWalletConfig } from './useWalletConfig';
import { useWalletBindings } from './useWalletBindings';
import WalletIdentityFlow from './WalletIdentityFlow';
import type { WalletBinding } from './types';
import '@/features/platform/platform.css';
import './walletidentity.css';
export default function WalletBindingsPage() {
  const auth = useAuth();
  return (
    <section className="wallet-id-page">
      <PageHeader title="钱包身份" backTo="/account" />
      {auth.status === 'checking' ? (
        <p className="wallet-id-content" role="status">
          正在确认当前账号…
        </p>
      ) : !auth.user ? (
        <div className="wallet-id-content">
          {auth.status === 'unavailable' ? (
            <PlatformError
              message={auth.error || '账号服务暂时不可用'}
              retry={() => void auth.refresh()}
            />
          ) : (
            <LoginNotice returnTo="/account/wallets" text="登录后管理钱包身份" />
          )}
        </div>
      ) : (
        <BindingsAccount key={`${auth.user.id}:${auth.expiresAt}`} />
      )}
    </section>
  );
}
function BindingsAccount() {
  const auth = useAuth(),
    resource = useWalletBindings(),
    config = useWalletConfig();
  const [target, setTarget] = useState<WalletBinding | null>(null),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [uncertain, setUncertain] = useState(false);
  const live = useRef(true),
    lock = useRef(false),
    uncertainRef = useRef(false),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      controller.current?.abort();
    };
  }, []);
  const unbind = async () => {
    if (!target || !password || lock.current || uncertainRef.current || !live.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const epoch = accountEpoch(),
      request = new AbortController();
    controller.current = request;
    const secret = password;
    setPassword('');
    resource.invalidate();
    try {
      const result = await walletIdentityApi.unbind(target.id, secret, request.signal);
      if (!live.current || request.signal.aborted || epoch !== accountEpoch()) return;
      if (!result.ok) throw new Error('服务器尚未确认解绑，请刷新后核实');
      setTarget(null);
      setNotice(`已解绑，已撤销 ${result.revokedSessions} 个由此钱包登录的会话`);
      resource.invalidate();
      void resource.refresh();
      await auth.refresh();
    } catch (caught) {
      if (live.current && !request.signal.aborted && epoch === accountEpoch() && !isAbort(caught)) {
        const unknown = isUnconfirmedAuthWrite(caught);
        setError(unknown ? '解绑结果尚未确认，请先刷新绑定记录与当前身份' : walletFailure(caught));
        if (unknown) {
          uncertainRef.current = true;
          setUncertain(true);
          setTarget(null);
          resource.invalidate();
          void resource.refresh();
          void auth.refresh();
        }
      }
    } finally {
      if (live.current) {
        lock.current = false;
        setBusy(false);
        controller.current = null;
      }
    }
  };
  const confirmUnknown = async () => {
    if (!live.current || lock.current || !uncertainRef.current) return;
    lock.current = true;
    setBusy(true);
    const epoch = accountEpoch();
    resource.invalidate();
    try {
      const [confirmed] = await Promise.all([resource.refresh(), auth.refresh()]);
      if (!live.current || epoch !== accountEpoch()) return;
      if (confirmed) {
        uncertainRef.current = false;
        setUncertain(false);
        setError('');
        setNotice('绑定记录已更新，请核实下方钱包列表');
      } else setError('仍未确认解绑结果，请检查连接后再次刷新');
    } finally {
      if (live.current && epoch === accountEpoch()) {
        lock.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <div className="wallet-id-content">
      <div className="wallet-id-heading">
        <ShieldCheck size={28} />
        <h1>你的登录凭证</h1>
        <p>钱包可用于重新登录此账号，邮箱密码继续可用。</p>
      </div>
      <div className="wallet-id-section-heading">
        <h2>
          已绑定钱包{' '}
          <small>
            {resource.value ? `${resource.value.items.length} / ${resource.value.maxBindings}` : ''}
          </small>
        </h2>
        <button
          aria-label="刷新钱包绑定"
          type="button"
          disabled={resource.loading || busy}
          onClick={() => {
            resource.invalidate();
            void resource.refresh();
          }}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      <PlatformError message={resource.error} retry={() => void resource.refresh()} />
      {resource.loading && !resource.value ? (
        <p role="status">正在读取绑定记录…</p>
      ) : (
        resource.value &&
        (resource.value.items.length ? (
          <div className="wallet-id-bindings">
            {resource.value.items.map((binding) => (
              <article key={binding.id}>
                <Wallet size={22} />
                <div>
                  <code>{binding.address}</code>
                  <small>绑定于 {new Date(binding.boundAt).toLocaleString('zh-CN')}</small>
                </div>
                <button
                  type="button"
                  disabled={busy || uncertain}
                  onClick={() => {
                    setTarget(binding);
                    setPassword('');
                    setError('');
                  }}
                >
                  解绑
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p className="wallet-id-empty">尚未绑定钱包</p>
        ))
      )}
      <PlatformError message={error} />
      {uncertain && (
        <button
          type="button"
          className="platform-secondary"
          disabled={busy}
          onClick={() => void confirmUnknown()}
        >
          {busy ? '正在确认…' : '刷新确认解绑结果'}
        </button>
      )}
      {notice && (
        <p role="status" className="wallet-id-success">
          {notice}
        </p>
      )}
      {config.loading ? (
        <p role="status">正在读取钱包设置…</p>
      ) : config.error ? (
        <PlatformError message={config.error} retry={config.retry} />
      ) : (
        config.value && (
          <section className="wallet-id-add">
            <h2>添加钱包身份</h2>
            {resource.value && resource.value.items.length >= resource.value.maxBindings ? (
              <p className="wallet-id-note">已达到绑定上限，请先解绑不再使用的钱包。</p>
            ) : (
              <WalletIdentityFlow
                purpose="bind"
                config={config.value}
                disabled={busy || uncertain || !resource.value}
                onComplete={() => {
                  resource.invalidate();
                  void resource.refresh();
                }}
                onUnknown={() => {
                  resource.invalidate();
                  return resource.refresh();
                }}
              />
            )}
          </section>
        )
      )}
      <p className="wallet-id-note">
        解绑会撤销由此钱包登录的设备，密码与其他钱包登录保留。撤销登录设备不会解绑钱包。尚不支持合约钱包或密码重设，请保管好密码和钱包。
      </p>
      <Link className="wallet-id-text" to="/settings/devices">
        查看登录设备
      </Link>
      {target && (
        <ActionDialog
          title="解绑此钱包？"
          confirmLabel="确认解绑"
          danger
          busy={busy}
          onClose={() => {
            setTarget(null);
            setPassword('');
            setError('');
          }}
          onConfirm={() => void unbind()}
        >
          <code className="wallet-id-dialog-address">{target.address}</code>
          <p>将撤销所有由此钱包登录的会话，当前会话也可能失效。此钱包将不能再登录此账号。</p>
          <label className="wallet-id-password">
            当前账号密码
            <input
              aria-label="解绑密码"
              type="password"
              autoComplete="current-password"
              maxLength={72}
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {!password && <small>请输入密码后确认。</small>}
          <PlatformError message={error} />
        </ActionDialog>
      )}
    </div>
  );
}
