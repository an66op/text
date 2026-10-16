import { ArrowUpRight, ChevronRight, MapPin, Settings, Wallet } from 'lucide-react';
import { Link } from 'react-router';
import { paths } from '@/shared/config/paths';
import { avatar } from '@/shared/lib/media';
import { useProfile } from './useProfile';
import './profile.css';

const services = [
  { label: '钱包', detail: '资产与交易记录', icon: Wallet, to: paths.wallet, tone: 'violet' },
  { label: '设置', detail: '一切按你的习惯', icon: Settings, to: paths.settings, tone: 'blue' },
];

export default function ProfilePage() {
  const { profile } = useProfile();
  return (
    <div className="profile-home">
      <div className="profile-home-content">
        <section className="profile-identity" aria-label="个人资料">
          <Link className="profile-identity-settings" to={paths.settings} aria-label="设置">
            <Settings size={22} />
          </Link>
          <div className="profile-identity-heading">
            <img src={profile.avatar || avatar(49)} alt={profile.name} />
            <div>
              <h1>{profile.name}</h1>
              <p>@{profile.handle || 'orange_soda'}</p>
            </div>
          </div>
          <p className="profile-identity-bio">{profile.bio || '在这里，遇见有趣的生活。'}</p>
          <div className="profile-identity-footer">
            <span>
              <MapPin size={14} />
              {(profile.location ?? '杭州') || '未设置地区'}
            </span>
            <Link to={paths.editProfile}>
              编辑资料 <ChevronRight size={16} />
            </Link>
          </div>
        </section>
        <div className="profile-section-heading">
          <h2>我的空间</h2>
          <span>生活，各有喜欢</span>
        </div>
        <nav className="profile-service-grid" aria-label="个人服务">
          {services.map(({ label, detail, icon: Icon, to, tone }) => (
            <Link key={to} to={to} className={`profile-service profile-service-${tone}`}>
              <span className="profile-service-icon">
                <Icon size={25} strokeWidth={1.8} />
              </span>
              <ArrowUpRight className="profile-service-arrow" size={17} />
              <strong>{label}</strong>
              <small>{detail}</small>
            </Link>
          ))}
        </nav>
        <p className="profile-home-signature">共鸣，让每一种喜欢都有回响。</p>
      </div>
    </div>
  );
}
