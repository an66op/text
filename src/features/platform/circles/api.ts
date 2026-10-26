import { apiQuery, apiRequest } from '@/shared/api/client';
import type {
  Circle,
  CircleInput,
  Channel,
  ChannelInput,
  Member,
  JoinRequest,
  JoinResult,
  Post,
  Comment,
  Invite,
  CreatedInvite,
  Page,
} from './types';
type Query = Record<string, string | number | undefined>;
const path = (id: string) => `/circles/${encodeURIComponent(id)}`;
const json = (method: string, body: unknown, signal?: AbortSignal): RequestInit => ({
  method,
  body: JSON.stringify(body),
  signal,
});
const postPath = (id: string, postId: string) => `${path(id)}/posts/${encodeURIComponent(postId)}`;
export const circlesApi = {
  directory: (query: Query, signal?: AbortSignal) =>
    apiRequest<Page<Circle>>(`/circles${apiQuery(query)}`, { signal }),
  create: (value: CircleInput & { clientId: string }, signal?: AbortSignal) =>
    apiRequest<Circle>('/circles', json('POST', value, signal)),
  circle: (id: string, signal?: AbortSignal) => apiRequest<Circle>(path(id), { signal }),
  update: (id: string, value: Partial<CircleInput>, signal?: AbortSignal) =>
    apiRequest<Circle>(path(id), json('PATCH', value, signal)),
  archive: (id: string, signal?: AbortSignal) =>
    apiRequest<{ ok: true }>(path(id), { method: 'DELETE', signal }),
  join: (id: string, value: { note?: string; inviteToken?: string }, signal?: AbortSignal) =>
    apiRequest<JoinResult>(`${path(id)}/join`, json('POST', value, signal)),
  requests: (id: string | null, query: Query, signal?: AbortSignal) =>
    apiRequest<Page<JoinRequest>>(
      `${id ? `${path(id)}/requests` : '/circle-requests'}${apiQuery(query)}`,
      { signal },
    ),
  respond: (
    id: string,
    requestId: string,
    action: 'accept' | 'decline' | 'cancel',
    signal?: AbortSignal,
  ) =>
    apiRequest<JoinRequest>(
      `${path(id)}/requests/${encodeURIComponent(requestId)}/respond`,
      json('POST', { action }, signal),
    ),
  members: (id: string, query: Query, signal?: AbortSignal) =>
    apiRequest<Page<Member>>(`${path(id)}/members${apiQuery(query)}`, { signal }),
  role: (id: string, userId: string, role: 'admin' | 'member', signal?: AbortSignal) =>
    apiRequest<Member>(
      `${path(id)}/members/${encodeURIComponent(userId)}`,
      json('PATCH', { role }, signal),
    ),
  removeMember: (id: string, userId: string, ban: boolean, signal?: AbortSignal) =>
    apiRequest<{ ok: true }>(
      `${path(id)}/members/${encodeURIComponent(userId)}/remove`,
      json('POST', { ban }, signal),
    ),
  unban: (id: string, userId: string, signal?: AbortSignal) =>
    apiRequest<{ ok: true }>(
      `${path(id)}/members/${encodeURIComponent(userId)}/unban`,
      json('POST', {}, signal),
    ),
  transfer: (id: string, userId: string, signal?: AbortSignal) =>
    apiRequest<Circle>(`${path(id)}/owner`, json('POST', { userId }, signal)),
  leave: (id: string, signal?: AbortSignal) =>
    apiRequest<{ ok: true }>(`${path(id)}/leave`, json('POST', {}, signal)),
  channels: (id: string, signal?: AbortSignal) =>
    apiRequest<Page<Channel>>(`${path(id)}/channels?limit=50`, { signal }),
  createChannel: (id: string, value: ChannelInput, signal?: AbortSignal) =>
    apiRequest<Channel>(`${path(id)}/channels`, json('POST', value, signal)),
  updateChannel: (
    id: string,
    channelId: string,
    value: Partial<ChannelInput> & { archived?: boolean },
    signal?: AbortSignal,
  ) =>
    apiRequest<Channel>(
      `${path(id)}/channels/${encodeURIComponent(channelId)}`,
      json('PATCH', value, signal),
    ),
  posts: (id: string, query: Query, signal?: AbortSignal) =>
    apiRequest<Page<Post>>(`${path(id)}/posts${apiQuery(query)}`, { signal }),
  post: (id: string, postId: string, signal?: AbortSignal) =>
    apiRequest<Post>(postPath(id, postId), { signal }),
  createPost: (
    id: string,
    value: { channelId: string; title: string; body: string; images: string[]; clientId: string },
    signal?: AbortSignal,
  ) => apiRequest<Post>(`${path(id)}/posts`, json('POST', value, signal)),
  updatePost: (
    id: string,
    postId: string,
    value: Partial<Pick<Post, 'status' | 'featured' | 'pinned'>>,
    signal?: AbortSignal,
  ) => apiRequest<Post>(postPath(id, postId), json('PATCH', value, signal)),
  deletePost: (id: string, postId: string, signal?: AbortSignal) =>
    apiRequest<{ ok: true }>(postPath(id, postId), { method: 'DELETE', signal }),
  like: (id: string, postId: string, liked: boolean, signal?: AbortSignal) =>
    apiRequest<Post>(`${postPath(id, postId)}/like`, json('POST', { liked }, signal)),
  comments: (id: string, postId: string, query: Query, signal?: AbortSignal) =>
    apiRequest<Page<Comment>>(`${postPath(id, postId)}/comments${apiQuery(query)}`, { signal }),
  comment: (id: string, postId: string, body: string, signal?: AbortSignal) =>
    apiRequest<Comment>(`${postPath(id, postId)}/comments`, json('POST', { body }, signal)),
  report: (postId: string, reason: string, signal?: AbortSignal) =>
    apiRequest<{ id: string }>(
      '/reports',
      json('POST', { targetType: 'circle-post', targetId: postId, reason }, signal),
    ),
  invites: (id: string, signal?: AbortSignal, offset = 0) =>
    apiRequest<Page<Invite>>(`${path(id)}/invites${apiQuery({ limit: 20, offset })}`, { signal }),
  createInvite: (
    id: string,
    value: { expiresInHours: number; maxUses: number },
    signal?: AbortSignal,
  ) => apiRequest<CreatedInvite>(`${path(id)}/invites`, json('POST', value, signal)),
  revokeInvite: (id: string, inviteId: string, signal?: AbortSignal) =>
    apiRequest<{ ok: true }>(`${path(id)}/invites/${encodeURIComponent(inviteId)}`, {
      method: 'DELETE',
      signal,
    }),
  previewInvite: (token: string, signal?: AbortSignal) =>
    apiRequest<Circle>('/circle-invites/preview', json('POST', { token }, signal)),
};
