import type { PublicUser } from '@/shared/api/types';
export type Role = 'owner' | 'admin' | 'member' | 'guest';
export type Circle = {
  id: string;
  name: string;
  description: string;
  cover: string;
  icon: string;
  category: string;
  visibility: 'public' | 'private';
  joinPolicy: 'open' | 'approval';
  status: 'active' | 'suspended' | 'archived';
  owner: PublicUser;
  role: Role;
  membership: 'active' | 'pending' | 'banned' | 'none';
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};
export type CircleInput = Pick<
  Circle,
  'name' | 'description' | 'cover' | 'icon' | 'category' | 'visibility' | 'joinPolicy'
>;
export type Channel = {
  id: string;
  circleId: string;
  name: string;
  description: string;
  kind: 'forum' | 'announcement';
  access: 'members' | 'staff';
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};
export type ChannelInput = Pick<Channel, 'name' | 'description' | 'kind' | 'access'>;
export type Member = {
  user: PublicUser;
  role: Exclude<Role, 'guest'>;
  status: 'active' | 'removed' | 'banned';
  joinedAt: string;
};
export type JoinRequest = {
  id: string;
  circle: Circle;
  user: PublicUser;
  note: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  createdAt: string;
  updatedAt: string;
};
export type JoinResult = { status: 'joined' | 'pending'; circle: Circle; request?: JoinRequest };
export type Post = {
  id: string;
  circleId: string;
  channelId: string;
  author: PublicUser;
  title: string;
  body: string;
  images: string[];
  status: 'published' | 'pending' | 'hidden';
  featured: boolean;
  pinned: boolean;
  likeCount: number;
  liked: boolean;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
};
export type Comment = {
  id: string;
  postId: string;
  author: PublicUser;
  body: string;
  createdAt: string;
};
export type Invite = {
  id: string;
  circleId: string;
  createdAt: string;
  expiresAt: string;
  maxUses: number;
  uses: number;
  revoked: boolean;
};
export type CreatedInvite = Invite & { token: string };
export type Page<T> = { items: T[]; total: number };
export const isManager = (circle: Circle) =>
  circle.membership === 'active' && (circle.role === 'owner' || circle.role === 'admin');
