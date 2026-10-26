import { useEffect, useRef, useState } from 'react';
import { ApiError, apiErrorMessage, isAbort } from '@/shared/api/client';
import { notificationsApi } from './api';
import { normalizeNotification } from './model';
import {
  NOTIFICATIONS_CHANGED,
  notificationChange,
  notificationsChanged,
} from './notification-events';
import type { Category } from './types';
import { useNotificationResource } from './useNotificationResource';

export function useNotificationInbox(
  userId: string,
  sessionKey: string,
  category: Category,
  unread: boolean,
  page: number,
) {
  const key = `${userId}:${sessionKey}:${category}:${unread}:${page}`;
  const list = useNotificationResource(key, true, async (signal) => {
    const result = await notificationsApi.list(
      { category, unread, limit: 20, offset: page * 20 },
      signal,
    );
    return { ...result, items: result.items.map(normalizeNotification) };
  });
  const { refresh } = list;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const active = useRef(false),
    request = useRef<AbortController | null>(null),
    owner = useRef(key),
    source = useRef(crypto.randomUUID());
  owner.current = key;
  useEffect(() => {
    active.current = true;
    setBusy(false);
    setError('');
    setNotice('');
    const change = (event: Event) => {
      const detail = notificationChange(event);
      if (!detail || (detail.userId === userId && detail.source !== source.current))
        refresh(false, false);
    };
    window.addEventListener(NOTIFICATIONS_CHANGED, change);
    return () => {
      active.current = false;
      request.current?.abort();
      request.current = null;
      window.removeEventListener(NOTIFICATIONS_CHANGED, change);
    };
  }, [key, userId, refresh]);
  const perform = async (operation: (signal: AbortSignal) => Promise<void>) => {
    if (!active.current || owner.current !== key || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const valid = () =>
      active.current &&
      owner.current === key &&
      !controller.signal.aborted &&
      request.current === controller;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation(controller.signal);
    } catch (caught) {
      if (valid() && !isAbort(caught)) {
        setError(apiErrorMessage(caught));
        if (caught instanceof ApiError && [401, 403, 404, 409].includes(caught.status))
          list.refresh(true);
      }
    } finally {
      if (request.current === controller) request.current = null;
      if (validAfter()) setBusy(false);
    }
    function validAfter() {
      return active.current && owner.current === key && !controller.signal.aborted;
    }
  };
  const markRead = async (id: string) => {
    const item = list.data?.items.find((value) => value.id === id);
    if (!item || item.readAt) return;
    await perform(async (signal) => {
      const result = await notificationsApi.read(id, signal);
      if (!active.current || owner.current !== key || signal.aborted) return;
      if (result.ok !== true || !result.readAt)
        throw new Error('服务器尚未确认通知已读，请刷新后重试');
      list.commit((current) =>
        current
          ? {
              ...current,
              unreadTotal: result.unreadTotal,
              total:
                unread && current.items.some((value) => value.id === id && !value.readAt)
                  ? Math.max(0, current.total - 1)
                  : current.total,
              items: unread
                ? current.items.filter((value) => value.id !== id)
                : current.items.map((value) =>
                    value.id === id ? { ...value, readAt: result.readAt } : value,
                  ),
            }
          : null,
      );
      notificationsChanged({ userId, unreadTotal: result.unreadTotal, source: source.current });
      setNotice('已标为已读');
    });
  };
  const readAll = async () => {
    if (!list.data) return;
    const throughId = list.data.throughId;
    await perform(async (signal) => {
      const result = await notificationsApi.readAll(throughId, signal);
      if (!active.current || owner.current !== key || signal.aborted) return;
      if (result.ok !== true) throw new Error('服务器尚未确认批量已读，请刷新后重试');
      list.refresh(true);
      notificationsChanged({ userId, unreadTotal: result.unreadTotal, source: source.current });
      setNotice(
        `截至本次列表快照，已将 ${result.markedRead} 条通知标为已读；之后新到的通知保留未读。`,
      );
    });
  };
  return { ...list, busy, mutationError: error, notice, markRead, readAll };
}
