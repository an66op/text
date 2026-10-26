export const NOTIFICATIONS_CHANGED = 'gongming:notifications-changed';
export type NotificationChange = { userId: string; unreadTotal: number; source?: string };
export function notificationsChanged(detail: NotificationChange) {
  window.dispatchEvent(new CustomEvent<NotificationChange>(NOTIFICATIONS_CHANGED, { detail }));
}
export function notificationChange(event: Event): NotificationChange | null {
  const detail: unknown = (event as CustomEvent<unknown>).detail;
  if (!detail || typeof detail !== 'object') return null;
  const value = detail as Partial<NotificationChange>;
  return typeof value.userId === 'string' &&
    Number.isSafeInteger(value.unreadTotal) &&
    value.unreadTotal! >= 0
    ? (value as NotificationChange)
    : null;
}
