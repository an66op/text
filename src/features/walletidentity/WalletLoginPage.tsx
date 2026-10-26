import { Link, useNavigate, useSearchParams } from 'react-router';
import { Wallet } from 'lucide-react';
import PageHeader from '@/shared/ui/PageHeader';
import { safeReturnTo } from '@/features/platform/auth-paths';
import { PlatformError } from '@/features/platform/PlatformUi';
import { useAuth } from '@/features/platform/useAuth';
import WalletIdentityFlow from './WalletIdentityFlow';
import { useWalletConfig } from './useWalletConfig';
import '@/features/platform/platform.css';
import './walletidentity.css';
export default function WalletLoginPage() {
  const [params] = useSearchParams(),
    navigate = useNavigate(),
    auth = useAuth(),
    config = useWalletConfig();
  const destination = safeReturnTo(params.get('returnTo'));
  return (
    <section className="wallet-id-page">
      <PageHeader title="钱包登录" backTo="/login" />
      <div className="wallet-id-content">
        <div className="wallet-id-heading">
          <Wallet size={28} />
          <h1>用钱包回到共鸣</h1>
          <p>仅登录已绑定的账号，首次使用请先用邮箱注册。</p>
        </div>
        {auth.status === 'checking' ? (
          <p role="status">正在确认当前账号…</p>
        ) : auth.status === 'unavailable' ? (
          <PlatformError
            message={auth.error || '暂时无法确认当前账号'}
            retry={() => void auth.refresh()}
          />
        ) : (
          <>
            {auth.user && (
              <p className="wallet-id-note">
                当前登录：{auth.user.name}。确认后将切换为此钱包绑定的账号。
              </p>
            )}
            {config.loading ? (
              <p role="status">正在读取钱包身份设置…</p>
            ) : config.error ? (
              <PlatformError message={config.error} retry={config.retry} />
            ) : (
              config.value && (
                <WalletIdentityFlow
                  purpose="login"
                  config={config.value}
                  onComplete={() => navigate(destination, { replace: true })}
                />
              )
            )}
          </>
        )}
        <Link className="wallet-id-text" to={`/login?returnTo=${encodeURIComponent(destination)}`}>
          使用邮箱和密码
        </Link>
        <p className="wallet-id-note">
          公开连接不代表登录。签名内容不会用于转账，测试积分账本独立管理。
        </p>
      </div>
    </section>
  );
}
