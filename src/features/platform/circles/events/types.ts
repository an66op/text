import type { PublicUser } from '@/shared/api/types';
export type EventRegistration = {
  status: 'registered' | 'waitlisted' | 'cancelled';
  reason: '' | 'user' | 'membership' | 'account' | 'event';
  queuePosition: number | null;
  createdAt: string;
  updatedAt: string;
};
export type CircleEvent = {
  id: string;
  circleId: string;
  creator: PublicUser;
  title: string;
  description: string;
  mode: 'online' | 'offline';
  location: string;
  startsAt: string;
  endsAt: string;
  registrationClosesAt: string;
  capacity: number;
  registeredCount: number;
  waitlistedCount: number;
  lifecycle: 'published' | 'cancelled';
  moderation: 'visible' | 'hidden';
  phase: 'upcoming' | 'ongoing' | 'ended' | 'cancelled';
  registrationOpen: boolean;
  myRegistration: EventRegistration | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type EventInput = Pick<
  CircleEvent,
  | 'title'
  | 'description'
  | 'mode'
  | 'location'
  | 'startsAt'
  | 'endsAt'
  | 'registrationClosesAt'
  | 'capacity'
>;
export type EventAttendee = { user: PublicUser; registration: EventRegistration };
export type RegistrationIntent = 'join' | 'waitlist' | 'leave';
export type RegistrationResult = { ok: true; registration: EventRegistration | null };
export type EventsView = 'upcoming' | 'mine' | 'all';
export type AttendeesStatus = 'all' | EventRegistration['status'];
export type EventPageResult<T> = { items: T[]; total: number };
