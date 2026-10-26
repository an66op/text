import type { PublicUser } from '@/shared/api/types';

export type NotificationKind =
  | 'friend-request'
  | 'friend-decision'
  | 'circle-request'
  | 'circle-decision'
  | 'circle-membership'
  | 'circle-status'
  | 'world-comment'
  | 'world-like'
  | 'circle-comment'
  | 'circle-like'
  | 'world-review'
  | 'circle-review'
  | 'media-review'
  | 'report-review';

export type Category = 'all' | 'requests' | 'interactions' | 'system';
export type NotificationCategory = Exclude<Category, 'all'>;
export type NotificationTarget =
  | { type: 'friend-requests' }
  | { type: 'user'; handle: string }
  | { type: 'circle-members'; circleId: string }
  | { type: 'circle'; circleId: string }
  | { type: 'world-post'; postId: string }
  | { type: 'circle-post'; circleId: string; postId: string }
  | { type: 'uploads'; mediaId: string };

export type Notification = {
  id: string;
  kind: NotificationKind;
  category: NotificationCategory;
  outcome: string;
  actor: PublicUser | null;
  available: boolean;
  context: { title: string; excerpt: string } | null;
  target: NotificationTarget | null;
  createdAt: string;
  readAt: string | null;
};

export type NotificationsPageResult = {
  items: Notification[];
  total: number;
  unreadTotal: number;
  throughId: string | null;
};
export type UnreadResult = { unreadTotal: number; throughId: string | null };
export type ReadResult = { ok: true; unreadTotal: number; readAt: string };
export type ReadAllResult = { ok: true; markedRead: number; unreadTotal: number };
export type NotificationsQuery = {
  category?: Category;
  unread?: boolean;
  limit?: number;
  offset?: number;
};
