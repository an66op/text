import { ApiError, apiQuery, apiRequest } from '@/shared/api/client';
import type {
  BlockList,
  BlockReceipt,
  ContactCapabilities,
  ContactPrivacy,
  ContactPrivacyFields,
} from './types';

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const revision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const date = (value: unknown) =>
  value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
const policy = (value: unknown) =>
  typeof value === 'string' && ['everyone', 'friends', 'nobody'].includes(value);
export const contactPrivacyFields = (value: ContactPrivacyFields): ContactPrivacyFields => ({
  directMessagePolicy: value.directMessagePolicy,
  groupInvitePolicy: value.groupInvitePolicy,
  allowFriendRequests: value.allowFriendRequests,
  discoverableByHandle: value.discoverableByHandle,
});
const invalid = (): never => {
  throw new ApiError('服务回执无法确认，请重新读取', 'INVALID_RESPONSE', 200);
};
export function readContactPrivacy(value: unknown): ContactPrivacy {
  if (
    !object(value) ||
    !policy(value.directMessagePolicy) ||
    !policy(value.groupInvitePolicy) ||
    typeof value.allowFriendRequests !== 'boolean' ||
    typeof value.discoverableByHandle !== 'boolean' ||
    !revision(value.revision) ||
    !date(value.updatedAt)
  )
    return invalid();
  return value as ContactPrivacy;
}
function readCapabilities(value: unknown, userId: string): ContactCapabilities {
  if (
    !object(value) ||
    value.userId !== userId ||
    !revision(value.revision) ||
    !['blockedByMe', 'canMessage', 'canRequestFriend', 'canInvite'].every(
      (key) => typeof value[key] === 'boolean',
    )
  )
    return invalid();
  return value as ContactCapabilities;
}
function readBlocks(value: unknown, userId?: string): BlockList {
  if (
    !object(value) ||
    !Array.isArray(value.items) ||
    !revision(value.total) ||
    !revision(value.revision) ||
    !date(value.updatedAt)
  )
    return invalid();
  for (const item of value.items) {
    if (
      !object(item) ||
      typeof item.userId !== 'string' ||
      !item.userId ||
      (userId && item.userId !== userId) ||
      typeof item.available !== 'boolean' ||
      typeof item.createdAt !== 'string' ||
      !date(item.createdAt)
    )
      return invalid();
    if (
      item.available
        ? !object(item.user) ||
          item.user.id !== item.userId ||
          !['id', 'handle', 'name', 'avatar', 'bio'].every(
            (key) => typeof (item.user as Record<string, unknown>)[key] === 'string',
          )
        : item.user !== null
    )
      return invalid();
  }
  if (userId && (value.items.length > 1 || value.total !== value.items.length)) return invalid();
  return value as BlockList;
}
function readReceipt(value: unknown, userId: string, blocked: boolean): BlockReceipt {
  if (
    !object(value) ||
    value.ok !== true ||
    value.userId !== userId ||
    value.blocked !== blocked ||
    !revision(value.revision) ||
    !date(value.updatedAt)
  )
    return invalid();
  return value as BlockReceipt;
}
export const privacyApi = {
  get: async (signal?: AbortSignal) =>
    readContactPrivacy(await apiRequest<unknown>('/me/contact-privacy', { signal })),
  save: async (value: ContactPrivacyFields & { revision: number }, signal?: AbortSignal) =>
    readContactPrivacy(
      await apiRequest<unknown>('/me/contact-privacy', {
        method: 'PUT',
        body: JSON.stringify({ ...contactPrivacyFields(value), revision: value.revision }),
        signal,
      }),
    ),
  blocks: async (
    query: { q?: string; userId?: string; limit?: number; offset?: number } = {},
    signal?: AbortSignal,
  ) =>
    readBlocks(await apiRequest<unknown>(`/me/blocks${apiQuery(query)}`, { signal }), query.userId),
  block: async (userId: string, revision: number, signal?: AbortSignal) =>
    readReceipt(
      await apiRequest<unknown>(`/me/blocks/${encodeURIComponent(userId)}`, {
        method: 'PUT',
        body: JSON.stringify({ revision }),
        signal,
      }),
      userId,
      true,
    ),
  unblock: async (userId: string, revision: number, signal?: AbortSignal) =>
    readReceipt(
      await apiRequest<unknown>(`/me/blocks/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        body: JSON.stringify({ revision }),
        signal,
      }),
      userId,
      false,
    ),
  capabilities: async (userId: string, signal?: AbortSignal) =>
    readCapabilities(
      await apiRequest<unknown>(`/contact-capabilities/${encodeURIComponent(userId)}`, { signal }),
      userId,
    ),
};
export const isContactRestricted = (error: unknown) =>
  error instanceof ApiError && error.status === 403 && error.code === 'contact_restricted';
