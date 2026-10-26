import { Link, useLocation, useNavigate } from 'react-router';
import PlatformMessagesPage from '@/features/platform/PlatformMessagesPage';
import { useAuth } from '@/features/platform/useAuth';
import { PlatformError } from '@/features/platform/PlatformUi';
import AppTopbar from '@/shared/ui/AppTopbar';
import { useProfile } from '@/features/profile/useProfile';
import { pathForModule } from '@/shared/config/paths';
import SocialHub from './SocialHub';
import type { View } from './types';

export default function SocialPage({
  view = '消息',
  demo = false,
}: {
  view?: View;
  demo?: boolean;
}) {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const isPrimaryMessages = !demo && view === '消息' && location.pathname === '/social';
  if (isPrimaryMessages && auth.status === 'checking')
    return (
      <section className="platform-page">
        <AppTopbar title="消息" />
        <p className="platform-empty" role="status">
          正在连接你的账号消息…
        </p>
      </section>
    );
  if (isPrimaryMessages && !auth.user && auth.status === 'unavailable')
    return (
      <section className="platform-page">
        <AppTopbar title="消息" />
        <div className="platform-content">
          <PlatformError
            message={auth.error || '暂时无法连接账号服务'}
            retry={() => void auth.refresh()}
          />
          <Link className="platform-text-link" to="/social/demo">
            打开独立的本机演示
          </Link>
        </div>
      </section>
    );
  if (!demo && view === '消息' && location.pathname === '/social' && auth.user)
    return <PlatformMessagesPage />;
  const showMode =
    view === '消息' && (location.pathname === '/social' || location.pathname === '/social/demo');
  return (
    <>
      {showMode && (
        <div className="platform-local-mode">
          <span>本机演示 · 独立保存</span>
          <Link to={auth.user ? '/social' : '/login?returnTo=%2Fsocial'}>
            {auth.user ? '账号消息' : '登录使用账号消息'}
          </Link>
        </div>
      )}
      <SocialHub
        initialView={view}
        profileName={profile.name}
        profileAvatar={profile.avatar}
        onOpenModule={(name) => navigate(pathForModule(name))}
      />
    </>
  );
}
