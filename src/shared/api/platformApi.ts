import { apiQuery, apiRequest } from './client';
import type {
  Conversation,
  ConversationKind,
  Health,
  ListResult,
  PlatformComment,
  PlatformMessage,
  PlatformPost,
  PlatformUser,
  PublicUser,
  Session,
} from './types';

const body = (value: unknown) => JSON.stringify(value);
const idPath = (value: string) => encodeURIComponent(value);

export const platformApi = {
  me: (signal?: AbortSignal) => apiRequest<Session>('/auth/me', { signal }),
  login: (email: string, password: string) =>
    apiRequest<Session>('/auth/login', { method: 'POST', body: body({ email, password }) }),
  register: (value: { email: string; password: string; name: string; handle: string }) =>
    apiRequest<Session>('/auth/register', { method: 'POST', body: body(value) }),
  logout: () => apiRequest<{ ok: true }>('/auth/logout', { method: 'POST' }),
  updateMe: (value: { name?: string; bio?: string; avatar?: string }) =>
    apiRequest<PlatformUser>('/me', { method: 'PATCH', body: body(value) }),
  health: (signal?: AbortSignal) => apiRequest<Health>('/health', { signal }),
  posts: (
    query: { q?: string; topic?: string; limit?: number; offset?: number } = {},
    signal?: AbortSignal,
  ) => apiRequest<ListResult<PlatformPost>>(`/posts${apiQuery(query)}`, { signal }),
  publishPost: (value: { body: string; images?: string[]; topic?: string }) =>
    apiRequest<PlatformPost>('/posts', { method: 'POST', body: body(value) }),
  deletePost: (id: string) =>
    apiRequest<{ ok: true }>(`/posts/${idPath(id)}`, { method: 'DELETE' }),
  likePost: (id: string, liked: boolean) =>
    apiRequest<PlatformPost>(`/posts/${idPath(id)}/like`, {
      method: 'POST',
      body: body({ liked }),
    }),
  comments: (id: string, signal?: AbortSignal) =>
    apiRequest<ListResult<PlatformComment>>(`/posts/${idPath(id)}/comments?limit=100`, { signal }),
  comment: (id: string, text: string) =>
    apiRequest<PlatformComment>(`/posts/${idPath(id)}/comments`, {
      method: 'POST',
      body: body({ body: text }),
    }),
  reportPost: (id: string, reason: string) =>
    apiRequest<{ id: string }>('/reports', {
      method: 'POST',
      body: body({ targetType: 'post', targetId: id, reason }),
    }),
  directory: (signal?: AbortSignal) =>
    apiRequest<ListResult<PublicUser>>('/directory?limit=100', { signal }),
  conversations: (signal?: AbortSignal) =>
    apiRequest<ListResult<Conversation>>('/conversations?limit=100', { signal }),
  createConversation: (value: { title: string; kind: ConversationKind; memberIds: string[] }) =>
    apiRequest<Conversation>('/conversations', { method: 'POST', body: body(value) }),
  messages: (id: string, signal?: AbortSignal) =>
    apiRequest<ListResult<PlatformMessage>>(`/conversations/${idPath(id)}/messages?limit=100`, {
      signal,
    }),
  sendMessage: (id: string, text: string) =>
    apiRequest<PlatformMessage>(`/conversations/${idPath(id)}/messages`, {
      method: 'POST',
      body: body({ body: text }),
    }),
};
