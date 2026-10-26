import { apiRequest } from '@/shared/api/client';
import type {
  RevokeOtherSessionsResult,
  RevokeSessionResult,
  SessionDevices,
} from './session-types';

export const sessionApi = {
  list: (signal?: AbortSignal) => apiRequest<SessionDevices>('/me/sessions', { signal }),
  revoke: (id: string, signal?: AbortSignal) =>
    apiRequest<RevokeSessionResult>(`/me/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      signal,
    }),
  revokeOthers: (signal?: AbortSignal) =>
    apiRequest<RevokeOtherSessionsResult>('/me/sessions/revoke-others', {
      method: 'POST',
      body: JSON.stringify({}),
      signal,
    }),
};
