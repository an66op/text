import {
  AudioLines,
  Compass,
  MessageCircle,
  ChevronRight,
  Settings,
  Sparkles,
  User,
  Users,
} from 'lucide-react';
import { Link } from 'react-router';
import { paths } from '@/shared/config/paths';
import { avatar } from '@/shared/lib/media';
import { useProfile } from '@/features/profile/useProfile';
import type { PrimarySection } from './types';

const items = [
  { id: 'social', label: '社交', icon: MessageCircle, to: paths.social },
  { id: 'contacts', label: '通讯录', icon: Users, to: paths.contacts },
  { id: 'discover', label: '发现', icon: Compass, to: paths.discover },
  { id: 'ai', label: 'AI', icon: Sparkles, to: paths.ai },
  { id: 'me', label: '我', icon: User, to: paths.me },
] as const;

export default function Navigation({
  section,
  unread,
  showBottomNav,
}: {
  section: PrimarySection;
  unread: number;
  showBottomNav: boolean;
}) {
  const { profile } = useProfile();
  return (
    <>
      <aside className="sidebar">
        <Link className="brand" to={paths.social}>
          <div className="brand-mark">
            <AudioLines size={25} strokeWidth={2.4} />
          </div>
          <span>
            共鸣<small>GONGMING</small>
          </span>
        </Link>
        <nav aria-label="桌面主导航">
          {items.map(({ id, label, icon: Icon, to }) => (
            <Link
              key={id}
              to={to}
              aria-current={section === id ? 'page' : undefined}
              className={section === id ? 'selected' : ''}
            >
              <Icon size={21} strokeWidth={section === id ? 2.2 : 1.8} />
              <span>{label}</span>
              {id === 'social' && unread > 0 && <b className="count">{unread}</b>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Link to={paths.settings}>
            <Settings size={18} />
            设置与帮助
          </Link>
          <Link className="account" to={paths.me}>
            <img src={profile.avatar || avatar(49)} alt="我的头像" />
            <span>
              <strong>{profile.name}</strong>
              <small>@{profile.handle || 'orange_soda'}</small>
            </span>
            <ChevronRight size={16} />
          </Link>
        </div>
      </aside>
      {showBottomNav && (
        <nav className="mobile-nav messenger-bottom" aria-label="主导航">
          {items.map(({ id, label, icon: Icon, to }) => (
            <Link
              key={id}
              to={to}
              aria-current={section === id ? 'page' : undefined}
              className={section === id ? 'active' : ''}
            >
              <span className="bottom-icon">
                <Icon size={23} strokeWidth={section === id ? 2.3 : 1.8} />
                {id === 'social' && unread > 0 && <b>{unread > 99 ? '99+' : unread}</b>}
              </span>
              <span>{label}</span>
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}
