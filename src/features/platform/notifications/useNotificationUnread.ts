import { useEffect } from 'react';
import { useAuth } from '../useAuth';
import { notificationsApi } from './api';
import { NOTIFICATIONS_CHANGED, notificationChange } from './notification-events';
import { useNotificationResource } from './useNotificationResource';

export function useNotificationUnread() {
  const auth = useAuth(),
    userId = auth.user?.id;
  const enabled = !!userId && auth.status === 'authenticated';
  const resource = useNotificationResource(
    `${userId || 'guest'}:${auth.expiresAt}`,
    enabled,
    async (signal) => {
      const result = await notificationsApi.unread(signal);
      if (!Number.isSafeInteger(result.unreadTotal) || result.unreadTotal < 0)
        throw new Error('未读数暂不可用');
      return result;
    },
    { pollMs: 20000, sensitive: false },
  );
  const { refresh } = resource;
  useEffect(() => {
    if (!enabled) return;
    const changed = (event: Event) => {
      const detail = notificationChange(event);
      if (!detail || detail.userId === userId) refresh(false, false);
    };
    window.addEventListener(NOTIFICATIONS_CHANGED, changed);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED, changed);
  }, [enabled, userId, refresh]);
  return {
    count: resource.data?.unreadTotal ?? null,
    loading: resource.loading,
    error: resource.error,
  };
}
