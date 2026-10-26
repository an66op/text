import { member } from '../../platform-test-fixtures';
import { circle } from '../test-fixtures';
import type { CircleEvent, EventRegistration } from './types';
export const registration: EventRegistration = {
  status: 'registered',
  reason: '',
  queuePosition: null,
  createdAt: '2026-10-27T08:00:00Z',
  updatedAt: '2026-10-27T08:00:00Z',
};
export const activity: CircleEvent = {
  id: `cevent_${'d'.repeat(32)}`,
  circleId: circle.id,
  creator: member,
  title: '城市光影漫步',
  description: '仅向圈友分享的活动安排。\n请在入口集合。',
  mode: 'offline',
  location: '西侧街角入口',
  startsAt: '2026-12-01T08:00:22.123456Z',
  endsAt: '2026-12-01T10:00:22.123456Z',
  registrationClosesAt: '2026-11-30T08:00:22.123456Z',
  capacity: 2,
  registeredCount: 1,
  waitlistedCount: 0,
  lifecycle: 'published',
  moderation: 'visible',
  phase: 'upcoming',
  registrationOpen: true,
  myRegistration: null,
  revision: 3,
  createdAt: '2026-10-27T08:00:00Z',
  updatedAt: '2026-10-27T08:00:00Z',
};
export const secondActivity: CircleEvent = {
  ...activity,
  id: `cevent_${'e'.repeat(32)}`,
  title: '第二场独立活动',
  description: '下一场独立正文',
  location: '下一场地点',
};
export const eventsPath = `/circles/s/${circle.id}/events`;
export const activityPath = `${eventsPath}/${activity.id}`;
