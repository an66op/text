import { member, otherMember } from '../platform-test-fixtures';
import type { Channel, Circle, Invite, JoinRequest, Post } from './types';

export const circle: Circle = {
  id: `circle_${'a'.repeat(32)}`,
  name: '光影创作社',
  description: '摄影和创作的圈内空间',
  cover: '',
  icon: '◉',
  category: '摄影',
  visibility: 'public',
  joinPolicy: 'open',
  status: 'active',
  owner: otherMember,
  role: 'member',
  membership: 'active',
  memberCount: 2,
  createdAt: '2026-10-27T08:00:00Z',
  updatedAt: '2026-10-27T08:00:00Z',
};
export const channel: Channel = {
  id: `cchannel_${'b'.repeat(32)}`,
  circleId: circle.id,
  name: '作品交流',
  description: '',
  kind: 'forum',
  access: 'members',
  archived: false,
  createdAt: circle.createdAt,
  updatedAt: circle.createdAt,
};
export const circlePost: Post = {
  id: `cpost_${'c'.repeat(32)}`,
  circleId: circle.id,
  channelId: channel.id,
  author: member,
  title: '第一束光',
  body: '这是圈内才可见的作品',
  images: [],
  status: 'published',
  featured: false,
  pinned: false,
  likeCount: 0,
  liked: false,
  commentCount: 0,
  createdAt: circle.createdAt,
  updatedAt: circle.createdAt,
};
export const request: JoinRequest = {
  id: `crequest_${'e'.repeat(32)}`,
  circle,
  user: member,
  note: '想来一起拍照',
  status: 'pending',
  createdAt: circle.createdAt,
  updatedAt: circle.createdAt,
};
export const invite: Invite = {
  id: `cinvite_${'f'.repeat(32)}`,
  circleId: circle.id,
  createdAt: circle.createdAt,
  expiresAt: '2099-10-27T08:00:00Z',
  uses: 0,
  maxUses: 20,
  revoked: false,
};
export const homePath = `/circles/s/${circle.id}`;
export const postPath = `${homePath}/posts/${circlePost.id}`;
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
