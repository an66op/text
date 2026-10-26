import { api, queryString } from './api';
import type { AdminCircleEvent, EventModeration } from './types';

export type EventGovernanceQuery = {
  circleId: string;
  lifecycle: string;
  moderation: string;
  q: string;
  offset: number;
  limit: number;
};

export const circleEventsApi = {
  listPath: (query: EventGovernanceQuery) => `/admin/circle-events${queryString(query)}`,
  govern: (
    id: string,
    value: { moderation: EventModeration; note: string; revision: number },
    signal: AbortSignal,
  ) =>
    api<AdminCircleEvent>(`/admin/circle-events/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: value,
      signal,
    }),
};
