import { apiQuery, apiRequest } from '@/shared/api/client';
import type {
  AttendeesStatus,
  CircleEvent,
  EventAttendee,
  EventInput,
  EventPageResult,
  EventsView,
  RegistrationIntent,
  RegistrationResult,
} from './types';
const base = (circleId: string) => `/circles/${encodeURIComponent(circleId)}/events`;
const path = (circleId: string, eventId: string) =>
  `${base(circleId)}/${encodeURIComponent(eventId)}`;
const json = (method: string, body: unknown, signal?: AbortSignal): RequestInit => ({
  method,
  body: JSON.stringify(body),
  signal,
});
const scoped = (value: CircleEvent, circleId: string, eventId?: string) => {
  if (value.circleId !== circleId || (eventId && value.id !== eventId))
    throw new Error('活动回执与当前页面不一致，请刷新确认');
  return value;
};
export const eventsApi = {
  list: async (
    circleId: string,
    query: { view: EventsView; limit: number; offset: number },
    signal?: AbortSignal,
  ) => {
    const result = await apiRequest<EventPageResult<CircleEvent>>(
      `${base(circleId)}${apiQuery(query)}`,
      { signal },
    );
    return { ...result, items: result.items.map((value) => scoped(value, circleId)) };
  },
  detail: async (circleId: string, eventId: string, signal?: AbortSignal) =>
    scoped(await apiRequest<CircleEvent>(path(circleId, eventId), { signal }), circleId, eventId),
  create: async (
    circleId: string,
    input: EventInput & { clientId: string },
    signal?: AbortSignal,
  ) => scoped(await apiRequest<CircleEvent>(base(circleId), json('POST', input, signal)), circleId),
  update: async (
    circleId: string,
    eventId: string,
    input: EventInput & { revision: number },
    signal?: AbortSignal,
  ) =>
    scoped(
      await apiRequest<CircleEvent>(path(circleId, eventId), json('PATCH', input, signal)),
      circleId,
      eventId,
    ),
  cancel: async (circleId: string, eventId: string, revision: number, signal?: AbortSignal) =>
    scoped(
      await apiRequest<CircleEvent>(
        `${path(circleId, eventId)}/cancel`,
        json('POST', { revision }, signal),
      ),
      circleId,
      eventId,
    ),
  registration: (
    circleId: string,
    eventId: string,
    intent: RegistrationIntent,
    clientId: string,
    signal?: AbortSignal,
  ) =>
    apiRequest<RegistrationResult>(
      `${path(circleId, eventId)}/registration`,
      json('POST', { intent, clientId }, signal),
    ),
  attendees: (
    circleId: string,
    eventId: string,
    query: { status: AttendeesStatus; limit: number; offset: number },
    signal?: AbortSignal,
  ) =>
    apiRequest<EventPageResult<EventAttendee>>(
      `${path(circleId, eventId)}/attendees${apiQuery(query)}`,
      { signal },
    ),
  report: (circleId: string, eventId: string, reason: string, signal?: AbortSignal) =>
    apiRequest<{ id: string; status: string }>(
      `${path(circleId, eventId)}/report`,
      json('POST', { reason }, signal),
    ),
};
