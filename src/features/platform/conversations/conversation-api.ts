import { apiQuery, apiRequest } from '@/shared/api/client';
import type { Conversation, ListResult, PublicUser } from '@/shared/api/types';

export type ConversationDetails = {
  conversation: Conversation;
  memberProfiles: PublicUser[];
};
const base = (id: string) => `/conversations/${encodeURIComponent(id)}`;
const body = (value: unknown) => JSON.stringify(value);

export const conversationApi = {
  details: (id: string, signal?: AbortSignal) =>
    apiRequest<ConversationDetails>(base(id), { signal }),
  rename: (id: string, title: string) =>
    apiRequest<Conversation>(base(id), { method: 'PATCH', body: body({ title }) }),
  add: (id: string, memberIds: string[]) =>
    apiRequest<Conversation>(`${base(id)}/members`, {
      method: 'POST',
      body: body({ memberIds }),
    }),
  remove: (id: string, userId: string) =>
    apiRequest<Conversation>(`${base(id)}/members/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    }),
  transfer: (id: string, userId: string) =>
    apiRequest<Conversation>(`${base(id)}/owner`, {
      method: 'POST',
      body: body({ userId }),
    }),
  leave: (id: string) =>
    apiRequest<{ ok: true }>(`${base(id)}/leave`, { method: 'POST', body: '{}' }),
  candidates: (q: string, offset: number, signal: AbortSignal) =>
    apiRequest<ListResult<PublicUser>>(`/directory${apiQuery({ q, limit: 30, offset })}`, {
      signal,
    }),
};
