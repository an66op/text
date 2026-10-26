import { apiQuery, apiRequest } from '@/shared/api/client';
import type { ListResult } from '@/shared/api/types';
import type {
  Friend,
  FriendRequest,
  Relationship,
  RequestAction,
  RequestDirection,
} from './friendship-types';

const idPath = (id: string) => encodeURIComponent(id);
export const friendshipApi = {
  friends: (q = '', offset = 0, signal?: AbortSignal) =>
    apiRequest<ListResult<Friend>>(`/friends${apiQuery({ q, limit: 30, offset })}`, { signal }),
  requests: (direction: RequestDirection, offset = 0, signal?: AbortSignal, limit = 30) =>
    apiRequest<ListResult<FriendRequest>>(
      `/friend-requests${apiQuery({ direction, status: 'pending', limit, offset })}`,
      { signal },
    ),
  relationship: (userId: string, signal?: AbortSignal) =>
    apiRequest<Relationship>(`/relationships/${idPath(userId)}`, { signal }),
  request: (userId: string, note: string) =>
    apiRequest<FriendRequest>('/friend-requests', {
      method: 'POST',
      body: JSON.stringify({ userId, note }),
    }),
  respond: (requestId: string, action: RequestAction) =>
    apiRequest<FriendRequest>(`/friend-requests/${idPath(requestId)}/respond`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  remove: (userId: string) =>
    apiRequest<{ ok: true }>(`/friends/${idPath(userId)}`, { method: 'DELETE' }),
};

export function friendshipsChanged() {
  window.dispatchEvent(new Event('gongming:friendships-changed'));
}
