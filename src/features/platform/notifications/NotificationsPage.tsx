import {
  Bell,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Heart,
  RefreshCw,
  UserPlus,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { LoginNotice, PlatformAvatar, PlatformError } from '../PlatformUi';
import { shortTime } from '../platform-format';
import { useAuth } from '../useAuth';
import { notificationPath, notificationText } from './model';
import type { Category, Notification } from './types';
import { useNotificationInbox } from './useNotificationInbox';
import '../platform.css';
import './notifications.css';

const categories: [Category, string][] = [
  ['all', '全部'],
  ['requests', '申请'],
  ['interactions', '互动'],
  ['system', '系统'],
];
export default function NotificationsPage() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const raw = params.get('category'),
    category = categories.some(([value]) => value === raw) ? (raw as Category) : 'all';
  const unread = params.get('unread') === 'true',
    rawPage = params.get('page') || '1';
  const page = /^[1-9]\d{0,3}$/.test(rawPage) ? Math.min(Number(rawPage) - 1, 5000) : 0;
  const change = (value: { category?: Category; unread?: boolean; page?: number }) => {
    const next = new URLSearchParams(params);
    if (value.category !== undefined) {
      if (value.category === 'all') next.delete('category');
      else next.set('category', value.category);
    }
    if (value.unread !== undefined) {
      if (value.unread) next.set('unread', 'true');
      else next.delete('unread');
    }
    const nextPage = value.page ?? 0;
    if (nextPage) next.set('page', String(nextPage + 1));
    else next.delete('page');
    setParams(next);
  };
  if (auth.status !== 'authenticated' || !auth.user)
    return (
      <section className="platform-page notifications-page">
        <PageHeader title="通知" backTo="/social" />
        <div className="notifications-content">
          {auth.status === 'checking' ? (
            <p className="platform-empty" role="status">
              正在验证账号…
            </p>
          ) : auth.status === 'unavailable' ? (
            <PlatformError
              message={auth.error || '账号服务暂不可达'}
              retry={() => void auth.refresh()}
            />
          ) : (
            <LoginNotice
              returnTo={`/notifications${params.size ? `?${params}` : ''}`}
              text="登录后查看站内通知"
            />
          )}
        </div>
      </section>
    );
  return (
    <Inbox
      key={`${auth.user.id}:${auth.expiresAt}:${category}:${unread}:${page}`}
      userId={auth.user.id}
      sessionKey={auth.expiresAt}
      category={category}
      unread={unread}
      page={page}
      change={change}
    />
  );
}
function Inbox({
  userId,
  sessionKey,
  category,
  unread,
  page,
  change,
}: {
  userId: string;
  sessionKey: string;
  category: Category;
  unread: boolean;
  page: number;
  change: (value: { category?: Category; unread?: boolean; page?: number }) => void;
}) {
  const auth = useAuth(),
    inbox = useNotificationInbox(userId, sessionKey, category, unread, page),
    data = inbox.data;
  return (
    <section className="platform-page notifications-page">
      <PageHeader
        title="通知"
        backTo="/social"
        action={
          <button
            type="button"
            aria-label="刷新通知"
            onClick={() => inbox.refresh(true)}
            disabled={inbox.loading || inbox.busy}
          >
            <RefreshCw size={18} />
          </button>
        }
      />
      <div className="notifications-content">
        <div className="notifications-tabs" role="tablist" aria-label="通知分类">
          {categories.map(([value, label]) => (
            <button
              type="button"
              role="tab"
              aria-selected={category === value}
              key={value}
              onClick={() => change({ category: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="notifications-toolbar">
          <button
            type="button"
            aria-pressed={unread}
            className="notification-unread-filter"
            onClick={() => change({ unread: !unread })}
          >
            未读{data && <span>{data.unreadTotal}</span>}
          </button>
          <button
            type="button"
            className="notification-read-all"
            disabled={!data || data.throughId === null || inbox.busy}
            onClick={() => void inbox.readAll()}
          >
            <CheckCheck size={15} />
            截至当前全部已读
          </button>
        </div>
        <PlatformError message={auth.error} retry={() => void auth.refresh()} />
        <PlatformError message={inbox.error} retry={() => inbox.refresh(true)} />
        <PlatformError message={inbox.mutationError} />
        {inbox.notice && (
          <p className="notification-notice" role="status">
            {inbox.notice}
          </p>
        )}
        {inbox.loading ? (
          <p className="platform-empty" role="status">
            正在读取通知…
          </p>
        ) : data?.items.length ? (
          <div className="notifications-list">
            {data.items.map((item) => (
              <NotificationItem
                key={item.id}
                item={item}
                busy={inbox.busy}
                markRead={() => void inbox.markRead(item.id)}
              />
            ))}
          </div>
        ) : (
          !inbox.error && (
            <div className="notifications-empty">
              <Bell size={28} />
              <h2>{unread ? '没有未读通知' : '暂无通知'}</h2>
              <button type="button" onClick={() => inbox.refresh(true)}>
                重新读取
              </button>
            </div>
          )
        )}
        {data && (data.total > 20 || page > 0) && (
          <nav className="notification-pagination" aria-label="通知分页">
            <button
              type="button"
              disabled={inbox.loading || !page}
              onClick={() => change({ page: page - 1 })}
            >
              <ChevronLeft size={16} />
              上一页
            </button>
            <span>
              {page + 1} / {Math.max(page + 1, Math.ceil(data.total / 20))}
            </span>
            <button
              type="button"
              disabled={inbox.loading || (page + 1) * 20 >= data.total}
              onClick={() => change({ page: page + 1 })}
            >
              下一页
              <ChevronRight size={16} />
            </button>
          </nav>
        )}
      </div>
    </section>
  );
}
function NotificationItem({
  item,
  busy,
  markRead,
}: {
  item: Notification;
  busy: boolean;
  markRead: () => void;
}) {
  const text = notificationText(item),
    path = notificationPath(item);
  const Icon =
    item.category === 'requests' ? UserPlus : item.category === 'interactions' ? Heart : Bell;
  return (
    <article
      className={`notification-item ${item.readAt ? 'is-read' : 'is-unread'}`}
      aria-label={text.title}
    >
      <div className="notification-avatar">
        {item.available && item.actor ? <PlatformAvatar user={item.actor} /> : <Icon size={19} />}
      </div>
      <div className="notification-item-content">
        <div className="notification-item-heading">
          <strong>{text.title}</strong>
          {!item.readAt && <span className="notification-dot" aria-label="未读" />}
          <time dateTime={item.createdAt}>{shortTime(item.createdAt)}</time>
        </div>
        {item.available && (
          <p className="notification-body">
            {item.available && item.actor && (
              <span className="notification-actor">{item.actor.name} · </span>
            )}
            {text.body}
          </p>
        )}
        {item.available && item.context && (
          <div className="notification-context">
            {item.context.title && <strong>{item.context.title}</strong>}
            {item.context.excerpt && <p>{item.context.excerpt}</p>}
          </div>
        )}
        {!item.available && <p className="notification-unavailable">原内容当前不可访问</p>}
        <div className="notification-item-actions">
          {path && (
            <Link to={path}>
              查看
              <ChevronRight size={13} />
            </Link>
          )}
          {item.readAt ? (
            <span>
              <Check size={13} />
              已读
            </span>
          ) : (
            <button type="button" onClick={markRead} disabled={busy}>
              <Check size={13} />
              标为已读
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
