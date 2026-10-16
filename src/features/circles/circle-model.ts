import { catalog } from '../content/fixtures';
import type { CatalogItem } from '../content/types';
import { circleCategoryIcons } from './fixtures';
import type {
  ChannelInput,
  Circle,
  CircleChannel,
  CircleInput,
  CircleMember,
  CircleMessage,
  CirclePost,
  CircleRole,
} from './types';

export const CIRCLES_STORAGE_KEY = 'circles-state-v1';
export type CircleExtra = {
  settings?: Partial<CircleInput>;
  joined?: boolean;
  role?: CircleRole;
  memberCountDelta?: number;
  channels?: CircleChannel[];
  members?: CircleMember[];
  messages?: Record<string, CircleMessage[]>;
  posts?: CirclePost[];
  // New records use channelId:eventId; bare eventId records belong to canonical 'events'.
  attendance?: string[];
};
export type CircleStore = { version: 1; circles: Record<string, CircleExtra>; deleted: string[] };
export const emptyCircleStore: CircleStore = { version: 1, circles: {}, deleted: [] };
const roles = ['owner', 'admin', 'member', 'guest'];
export const channelTypes: CircleChannel['type'][] = [
  'text',
  'forum',
  'voice',
  'announcement',
  'events',
  'resources',
];
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string';
const nonempty = (value: unknown): value is string => string(value) && value.trim().length > 0;
const number = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(nonempty);
const safeId = (value: string) =>
  value !== '__proto__' && value !== 'constructor' && value !== 'prototype' && !!value.trim();
const unique = (values: { id: string }[]) =>
  new Set(values.map((value) => value.id)).size === values.length;
function isSettings(value: unknown): value is Partial<CircleInput> {
  return (
    object(value) &&
    ['name', 'description', 'cover', 'icon', 'category'].every(
      (key) => value[key] === undefined || string(value[key]),
    ) &&
    (value.name === undefined || nonempty(value.name)) &&
    (value.visibility === undefined ||
      value.visibility === 'public' ||
      value.visibility === 'invite')
  );
}
function isChannel(value: unknown): value is CircleChannel {
  return (
    object(value) &&
    nonempty(value.id) &&
    nonempty(value.circleId) &&
    nonempty(value.name) &&
    string(value.description) &&
    string(value.category) &&
    channelTypes.includes(value.type as CircleChannel['type']) &&
    (value.access === 'members' || value.access === 'staff') &&
    number(value.unread) &&
    Number.isInteger(value.unread)
  );
}
function isMessage(value: unknown): value is CircleMessage {
  return (
    object(value) &&
    nonempty(value.id) &&
    nonempty(value.authorId) &&
    nonempty(value.authorName) &&
    string(value.avatar) &&
    nonempty(value.text) &&
    number(value.createdAt)
  );
}
function isMember(value: unknown): value is CircleMember {
  return (
    object(value) &&
    nonempty(value.id) &&
    nonempty(value.name) &&
    string(value.avatar) &&
    ['owner', 'admin', 'member'].includes(value.role as string) &&
    typeof value.online === 'boolean'
  );
}
function isPost(value: unknown): value is CirclePost {
  if (!object(value) || !isMessage(value)) return false;
  const post = value as unknown as Record<string, unknown>;
  return (
    nonempty(post.circleId) &&
    nonempty(post.channelId) &&
    nonempty(post.title) &&
    (post.image === undefined || string(post.image)) &&
    number(post.likes) &&
    Number.isInteger(post.likes) &&
    typeof post.liked === 'boolean' &&
    (post.featured === undefined || typeof post.featured === 'boolean') &&
    (post.pinned === undefined || typeof post.pinned === 'boolean') &&
    Array.isArray(post.comments) &&
    post.comments.every(isMessage) &&
    unique(post.comments)
  );
}
export function isCircleStore(value: unknown): value is CircleStore {
  if (!object(value) || value.version !== 1 || !object(value.circles) || !strings(value.deleted))
    return false;
  return Object.entries(value.circles).every(([id, extra]) => {
    if (!safeId(id) || !object(extra)) return false;
    if (extra.settings !== undefined && !isSettings(extra.settings)) return false;
    if (extra.joined !== undefined && typeof extra.joined !== 'boolean') return false;
    if (extra.role !== undefined && !roles.includes(extra.role as string)) return false;
    if (
      (extra.joined === false && extra.role !== undefined && extra.role !== 'guest') ||
      (extra.joined === true && extra.role === 'guest')
    )
      return false;
    if (
      extra.memberCountDelta !== undefined &&
      (typeof extra.memberCountDelta !== 'number' || !Number.isSafeInteger(extra.memberCountDelta))
    )
      return false;
    if (
      extra.channels !== undefined &&
      (!Array.isArray(extra.channels) ||
        !extra.channels.every(isChannel) ||
        !unique(extra.channels) ||
        !extra.channels.every((channel) => channel.circleId === id && safeId(channel.id)))
    )
      return false;
    if (
      extra.members !== undefined &&
      (!Array.isArray(extra.members) || !extra.members.every(isMember) || !unique(extra.members))
    )
      return false;
    if (
      extra.messages !== undefined &&
      (!object(extra.messages) ||
        !Object.entries(extra.messages).every(
          ([channelId, messages]) =>
            safeId(channelId) &&
            Array.isArray(messages) &&
            messages.every(isMessage) &&
            unique(messages),
        ))
    )
      return false;
    if (
      extra.posts !== undefined &&
      (!Array.isArray(extra.posts) ||
        !extra.posts.every(isPost) ||
        !unique(extra.posts) ||
        !extra.posts.every((post) => post.circleId === id))
    )
      return false;
    if (extra.channels !== undefined) {
      const channelIds = new Set((extra.channels as CircleChannel[]).map((channel) => channel.id));
      if (
        extra.messages &&
        Object.keys(extra.messages).some((channelId) => !channelIds.has(channelId))
      )
        return false;
      if (
        extra.posts &&
        (extra.posts as CirclePost[]).some((post) => !channelIds.has(post.channelId))
      )
        return false;
    }
    return extra.attendance === undefined || strings(extra.attendance);
  });
}
export function organizationItems(communities: CatalogItem[]): CatalogItem[] {
  const items = new Map(catalog.组织.map((item) => [item.id, item]));
  communities.filter((item) => item.module === '组织').forEach((item) => items.set(item.id, item));
  return [...items.values()];
}
export function deriveCircles(
  communities: CatalogItem[],
  memberships: string[],
  store: CircleStore,
): Circle[] {
  return organizationItems(communities)
    .filter((item) => !store.deleted.includes(item.id))
    .map((item) => {
      const extra = store.circles[item.id];
      const joined =
        extra?.joined ??
        (!!item.owner || memberships.includes(item.id) || item.id === 'organization-photography');
      const role = joined
        ? item.owner
          ? 'owner'
          : extra?.role && extra.role !== 'guest'
            ? extra.role
            : item.id === 'organization-photography'
              ? 'admin'
              : 'member'
        : 'guest';
      const category =
        item.category ??
        (item.id.includes('outdoors')
          ? '户外'
          : item.id.includes('reading')
            ? '读书'
            : item.id.includes('creators')
              ? '创作'
              : '兴趣');
      const baseCount = item.owner
        ? 1
        : Number(item.desc.match(/([\d,]+)\s*位/)?.[1]?.replaceAll(',', '') ?? 36);
      return {
        id: item.id,
        name: item.title,
        description: item.desc,
        cover: item.img,
        icon: circleCategoryIcons[category] ?? '🪐',
        category,
        ...extra?.settings,
        joined,
        role,
        memberCount: Math.max(1, baseCount + (extra?.memberCountDelta ?? 0)),
        onlineCount: item.owner ? 1 : Math.max(2, Math.round(baseCount / 11)),
        visibility: extra?.settings?.visibility ?? 'public',
        inviteCode:
          item.id === 'organization-photography'
            ? 'FRIENDS204'
            : `XO-${item.id.replace('organization-', '').slice(0, 8).toUpperCase()}`,
      };
    });
}
export function cleanCircleInput(input: CircleInput): CircleInput {
  if (
    !isSettings(input) ||
    !nonempty(input.name) ||
    !string(input.description) ||
    !string(input.cover) ||
    !nonempty(input.icon) ||
    !nonempty(input.category) ||
    !['public', 'invite'].includes(input.visibility)
  )
    throw new Error('请完整填写圈子信息');
  if (input.name.trim().length > 40 || input.description.length > 500)
    throw new Error('圈子名称或简介过长');
  return {
    name: input.name.trim(),
    description: input.description.trim(),
    cover: input.cover.trim(),
    icon: input.icon.trim(),
    category: input.category.trim(),
    visibility: input.visibility,
  };
}
export function cleanChannelInput(input: ChannelInput): ChannelInput {
  if (
    !object(input) ||
    !nonempty(input.name) ||
    !string(input.description) ||
    !nonempty(input.category) ||
    !channelTypes.includes(input.type) ||
    !['members', 'staff'].includes(input.access)
  )
    throw new Error('请完整填写频道信息');
  if (input.name.trim().length > 32 || input.description.length > 300)
    throw new Error('频道名称或简介过长');
  return {
    name: input.name.trim(),
    description: input.description.trim(),
    type: input.type,
    category: input.category.trim(),
    access: input.access,
  };
}
