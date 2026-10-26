import { otherMember } from '../platform-test-fixtures';
import type { Notification, NotificationsPageResult } from './types';
export const notice: Notification = {
  id: `notice_${'a'.repeat(32)}`,
  kind: 'circle-comment',
  category: 'interactions',
  outcome: '',
  actor: otherMember,
  available: true,
  context: { title: '仅限圈内的标题', excerpt: '私密圈内的最新正文' },
  target: {
    type: 'circle-post',
    circleId: `circle_${'b'.repeat(32)}`,
    postId: `cpost_${'c'.repeat(32)}`,
  },
  createdAt: '2026-10-27T08:00:00.000000Z',
  readAt: null,
};
export const readAt = '2026-10-27T09:00:00.000000Z';
export function result(
  items: Notification[] = [notice],
  extra: Partial<NotificationsPageResult> = {},
): NotificationsPageResult {
  return {
    items,
    total: items.length,
    unreadTotal: items.filter((item) => !item.readAt).length,
    throughId: items[0]?.id ?? null,
    ...extra,
  };
}
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (value: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
