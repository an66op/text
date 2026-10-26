import { UserRound } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '@/features/platform/useAuth';
import SocialPage from '@/features/social/SocialPage';
import AppTopbar from '@/shared/ui/AppTopbar';
import { LoginNotice, PlatformError } from '@/features/platform/PlatformUi';
import { paths } from '@/shared/config/paths';
import FriendsPanel from './FriendsPanel';
import FriendRequestsPanel from './FriendRequestsPanel';
import MemberDiscovery from './MemberDiscovery';
import { useFriendshipCounts } from './useFriendshipCounts';
import './people.css';
import './friendship.css';

export default function ContactsPage() {
  const { user, status, error, refresh } = useAuth();
  if (status === 'checking')
    return (
      <div className="route-status" role="status">
        正在验证账号…
      </div>
    );
  if (status === 'unavailable')
    return (
      <section className="people-directory">
        <AppTopbar title="通讯录" />
        <div className="people-directory-content">
          <PlatformError message={error || '账号服务暂时无法连接'} retry={() => void refresh()} />
          <LoginNotice returnTo={paths.contacts} />
          <Link to={paths.localContacts}>查看本机通讯录演示</Link>
        </div>
      </section>
    );
  return user ? <ContactsHub key={user.id} userId={user.id} /> : <SocialPage view="通讯录" />;
}

function ContactsHub({ userId }: { userId: string }) {
  const [params, setParams] = useSearchParams();
  const selected = params.get('tab');
  const tab = selected === 'requests' || selected === 'discover' ? selected : 'friends';
  const counts = useFriendshipCounts(userId);
  const choose = (value: string) => {
    const next = new URLSearchParams(params);
    if (value === 'friends') next.delete('tab');
    else next.set('tab', value);
    setParams(next);
  };
  return (
    <section className="people-directory friendship-directory">
      <AppTopbar
        title="通讯录"
        actions={
          <Link to={paths.account} aria-label="我的共鸣资料">
            <UserRound size={21} />
          </Link>
        }
      />
      <div className="people-directory-content">
        <div className="friendship-tabs" role="tablist" aria-label="通讯录分类">
          {(
            [
              { value: 'friends', label: '好友' },
              { value: 'requests', label: '申请' },
              { value: 'discover', label: '发现' },
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              id={`people-tab-${item.value}`}
              aria-controls={`people-panel-${item.value}`}
              aria-selected={tab === item.value}
              className={tab === item.value ? 'active' : ''}
              onClick={() => choose(item.value)}
            >
              {item.label}
              {item.value === 'requests' && !!counts.incoming && (
                <small
                  className="friendship-pending-badge"
                  aria-label={`${counts.incoming} 条待处理申请`}
                >
                  {counts.incoming > 99 ? '99+' : counts.incoming}
                </small>
              )}
            </button>
          ))}
        </div>
        <section role="tabpanel" id={`people-panel-${tab}`} aria-labelledby={`people-tab-${tab}`}>
          {tab === 'friends' ? (
            <FriendsPanel onDiscover={() => choose('discover')} />
          ) : tab === 'requests' ? (
            <FriendRequestsPanel incoming={counts.incoming} outgoing={counts.outgoing} />
          ) : (
            <MemberDiscovery />
          )}
        </section>
        {tab !== 'discover' && (
          <p className="people-footnote">
            <Link className="friendship-local-link" to={paths.localContacts}>
              本机通讯录演示
            </Link>
            <span>好友关系由双方确认，独立于成员目录。</span>
          </p>
        )}
      </div>
    </section>
  );
}
