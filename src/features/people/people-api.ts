import { apiQuery, apiRequest } from '@/shared/api/client';
import type { Conversation, ListResult, PlatformPost, PublicUser } from '@/shared/api/types';

export const peopleApi = {
  directory: (q: string, offset: number, signal: AbortSignal) =>
    apiRequest<ListResult<PublicUser>>(`/directory${apiQuery({ q, limit: 30, offset })}`, {
      signal,
    }),
  user: (handle: string, signal: AbortSignal) =>
    apiRequest<PublicUser>(`/users/${encodeURIComponent(handle)}`, { signal }),
  posts: (handle: string, offset: number, signal: AbortSignal) =>
    apiRequest<ListResult<PlatformPost>>(
      `/posts${apiQuery({ author: handle, limit: 20, offset })}`,
      { signal },
    ),
  startChat: (person: PublicUser) =>
    apiRequest<Conversation>('/conversations', {
      method: 'POST',
      body: JSON.stringify({
        title: `与${person.name}的私聊`,
        kind: 'direct',
        memberIds: [person.id],
      }),
    }),
};
