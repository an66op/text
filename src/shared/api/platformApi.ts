import { apiQuery, apiRequest } from './client';
import { authContextHeaders, browserAuthRequest } from './auth-context';
import type {
  Conversation,
  ConversationKind,
  Health,
  ListResult,
  MessagePage,
  MessageResolve,
  PlatformComment,
  PlatformMessage,
  PlatformPost,
  PlatformUser,
  PublicUser,
  ReadMark,
  Session,
} from './types';

const body = (value: unknown) => JSON.stringify(value);
const idPath = (value: string) => encodeURIComponent(value);

export const platformApi = {
  me: (signal?: AbortSignal) => apiRequest<Session>('/auth/me', { signal }),
  login: (email: string, password: string, signal?: AbortSignal) =>
    browserAuthRequest(
      (context) =>
        apiRequest<Session>('/auth/login', {
          method: 'POST',
          body: body({ email, password }),
          signal,
          headers: authContextHeaders(context),
        }),
      signal,
    ),
  register: (
    value: { email: string; password: string; name: string; handle: string },
    signal?: AbortSignal,
  ) =>
    browserAuthRequest(
      (context) =>
        apiRequest<Session>('/auth/register', {
          method: 'POST',
          body: body(value),
          signal,
          headers: authContextHeaders(context),
        }),
      signal,
    ),
  logout: (signal?: AbortSignal) =>
    browserAuthRequest(
      (context) =>
        apiRequest<{ ok: true }>('/auth/logout', {
          method: 'POST',
          signal,
          headers: authContextHeaders(context),
        }),
      signal,
    ),
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
  messages: (
    id: string,
    signal?: AbortSignal,
    query: { beforeSeq?: number; afterSeq?: number; beforeId?: string; limit?: number } = {},
  ) =>
    apiRequest<MessagePage>(
      `/conversations/${idPath(id)}/messages${apiQuery({ limit: 50, ...query })}`,
      {
        signal,
      },
    ),
  sendMessage: (
    id: string,
    text: string,
    clientId?: string,
    rich?: { imageIds?: string[]; replyToId?: string },
    signal?: AbortSignal,
  ) =>
    apiRequest<PlatformMessage>(`/conversations/${idPath(id)}/messages`, {
      method: 'POST',
      body: body({ body: text, ...(clientId ? { clientId } : {}), ...rich }),
      signal,
    }),
  message: (id: string, messageId: string, signal?: AbortSignal) =>
    apiRequest<PlatformMessage>(`/conversations/${idPath(id)}/messages/${idPath(messageId)}`, {
      signal,
    }),
  messageByClient: (id: string, clientId: string, signal?: AbortSignal) =>
    apiRequest<PlatformMessage>(
      `/conversations/${idPath(id)}/messages/by-client/${idPath(clientId)}`,
      { signal },
    ),
  resolveMessages: (id: string, ids: string[], signal?: AbortSignal) =>
    apiRequest<MessageResolve>(`/conversations/${idPath(id)}/messages/resolve`, {
      method: 'POST',
      body: body({ ids }),
      signal,
    }),
  retractMessage: (id: string, signal?: AbortSignal) =>
    apiRequest<{ ok: true; messageId: string }>(`/me/messages/${idPath(id)}`, {
      method: 'DELETE',
      signal,
    }),
  markConversationRead: (id: string, messageId: string) =>
    apiRequest<ReadMark>(`/conversations/${idPath(id)}/read`, {
      method: 'POST',
      body: body({ messageId }),
    }),
};
