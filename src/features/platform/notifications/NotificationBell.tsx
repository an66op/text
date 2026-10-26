import { Bell } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '../useAuth';
import { useNotificationUnread } from './useNotificationUnread';
import './notifications.css';

export default function NotificationBell({ className = '' }: { className?: string }) {
  const auth = useAuth(),
    { count, error, loading } = useNotificationUnread();
  const label =
    auth.status === 'checking'
      ? '通知，正在验证账号'
      : auth.status === 'unavailable'
        ? '通知，账号服务暂不可用'
        : !auth.user
          ? '通知，登录后查看'
          : count === null
            ? loading
              ? '通知，正在读取未读数'
              : '通知，未读数暂不可用'
            : `通知，${count} 条未读${error ? '，刷新失败' : ''}`;
  return (
    <Link
      to="/notifications"
      className={`notification-bell ${className}`.trim()}
      aria-label={label}
      title={error || '通知'}
    >
      <Bell size={20} />
      {auth.status === 'authenticated' && count !== null && count > 0 && (
        <span className="notification-bell-count" aria-hidden="true">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
