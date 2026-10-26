import { describe, expect, it } from 'vitest';
import { notificationPath, notificationText, normalizeNotification } from './model';
import { notice } from './test-fixtures';
import type { Notification, NotificationKind } from './types';
const target = {
  type: 'circle-event' as const,
  circleId: `circle_${'a'.repeat(32)}`,
  eventId: `cevent_${'b'.repeat(32)}`,
};
describe('circle event notification projection', () => {
  it.each<[NotificationKind, string, string]>([
    ['circle-event-update', 'updated', '活动资料已更新'],
    ['circle-event-update', 'cancelled', '活动已取消'],
    ['circle-event-registration', 'promoted', '候补已递补'],
    ['circle-event-review', 'hidden', '活动已隐藏'],
    ['circle-event-review', 'visible', '活动恢复可见'],
  ])('renders controlled historical text for %s/%s', (kind, outcome, title) => {
    const item: Notification = { ...notice, kind, outcome, category: 'system', target };
    expect(notificationText(item).title).toBe(title);
    expect(normalizeNotification(item).actor).toBeNull();
    expect(notificationPath(item)).toBe(`/circles/s/${target.circleId}/events/${target.eventId}`);
  });
  it('drops the old actor, activity title and target after loss of current membership or visibility', () => {
    const item: Notification = {
      ...notice,
      kind: 'circle-event-registration',
      outcome: 'promoted',
      category: 'system',
      target,
      available: false,
    };
    expect(normalizeNotification(item)).toMatchObject({ actor: null, context: null, target: null });
    expect(notificationPath(item)).toBeNull();
    expect(notificationText(item)).toEqual({ title: '候补已递补', body: '原内容当前不可访问' });
  });
  it.each([
    '../cevent_x',
    `cevent_${'b'.repeat(31)}`,
    `post_${'b'.repeat(32)}`,
    `cevent_${'B'.repeat(32)}`,
  ])('rejects an invalid event target %s', (eventId) => {
    expect(notificationPath({ ...notice, target: { ...target, eventId } })).toBeNull();
  });
});
