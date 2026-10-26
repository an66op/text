import {
  Bell,
  ChevronRight,
  Info,
  MonitorPlay,
  ShieldCheck,
  UserRound,
  LockKeyhole,
} from 'lucide-react';
import { Link } from 'react-router';
import { paths } from '@/shared/config/paths';
import PageHeader from '@/shared/ui/PageHeader';
import { useProfile } from './useProfile';
import { useAuth } from '@/features/platform/useAuth';
import { usePreferences } from './preferences';
import SettingsSwitch from './SettingsSwitch';
import './profile.css';

const links = [
  {
    title: '账号与资料',
    description: '个人信息、演示绑定与共鸣号',
    icon: UserRound,
    href: '/settings/account',
  },
  {
    title: '安全中心',
    description: '本地演示安全码与设备管理',
    icon: ShieldCheck,
    href: '/settings/security',
  },
  {
    title: '隐私权限',
    description: '本机动态范围、验证偏好与黑名单',
    icon: LockKeyhole,
    href: '/settings/privacy',
  },
  {
    title: '消息通知',
    description: '声音、预览与免打扰时段',
    icon: Bell,
    href: '/settings/notifications',
  },
  {
    title: '内容偏好',
    description: '兴趣选择与影音播放',
    icon: MonitorPlay,
    href: '/settings/content',
  },
  { title: '关于共鸣', description: '应用信息与本地数据说明', icon: Info, href: '/settings/about' },
];
export default function SettingsPage() {
  const { profile } = useProfile();
  const { user } = useAuth();
  const [preferences, setPreferences] = usePreferences();
  return (
    <div className="settings-page">
      <PageHeader title="设置" backTo={paths.me} />
      <div className="settings-content">
        <section className="settings-group">
          <h2>{user?.name ?? profile.name}的设置</h2>
          <div className="settings-card">
            {links.map(({ title, description, icon: Icon, href }) => (
              <Link className="settings-nav-row" to={href} key={href}>
                <span className="settings-nav-icon">
                  <Icon size={21} />
                </span>
                <span className="settings-row-copy">
                  <strong>{title}</strong>
                  <small>
                    {user && href === '/settings/account' ? '当前账号资料与个人备份' : description}
                  </small>
                </span>
                <ChevronRight size={18} />
              </Link>
            ))}
          </div>
        </section>
        <section className="settings-group">
          <h2>快捷设置</h2>
          <div className="settings-card">
            <SettingsSwitch
              label="消息通知"
              description="接收好友消息与互动提醒"
              checked={preferences['消息通知'] ?? true}
              onChange={(checked) =>
                setPreferences((current) => ({ ...current, 消息通知: checked }))
              }
            />
            <SettingsSwitch
              label="自动播放预览"
              description="浏览影音内容时自动播放预览"
              checked={preferences['自动播放预览'] ?? true}
              onChange={(checked) =>
                setPreferences((current) => ({ ...current, 自动播放预览: checked }))
              }
            />
          </div>
        </section>
        <p className="settings-hint">
          {user
            ? '本机偏好保存在此浏览器 · 账号资料由服务器保存'
            : '修改自动保存在本机 · 前端演示版本'}
        </p>
      </div>
    </div>
  );
}
