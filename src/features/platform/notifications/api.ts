import { apiQuery, apiRequest } from '@/shared/api/client';
import type {
  NotificationsPageResult,
  NotificationsQuery,
  ReadAllResult,
  ReadResult,
  UnreadResult,
} from './types';

const json = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
  signal,
});

export const notificationsApi = {
  list: (query: NotificationsQuery, signal?: AbortSignal) =>
    apiRequest<NotificationsPageResult>(
      `/notifications${apiQuery({
        ...query,
        unread: query.unread === undefined ? undefined : String(query.unread),
      })}`,
      { signal },
    ),
  unread: (signal?: AbortSignal) => apiRequest<UnreadResult>('/notifications/unread', { signal }),
  read: (id: string, signal?: AbortSignal) =>
    apiRequest<ReadResult>(`/notifications/${encodeURIComponent(id)}/read`, json({}, signal)),
  readAll: (throughId: string | null, signal?: AbortSignal) =>
    apiRequest<ReadAllResult>('/notifications/read-all', json({ throughId }, signal)),
};
