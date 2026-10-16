export type CircleRole = 'owner' | 'admin' | 'member' | 'guest';
export type Circle = {
  id: string;
  name: string;
  description: string;
  cover: string;
  icon: string;
  category: string;
  joined: boolean;
  role: CircleRole;
  memberCount: number;
  onlineCount: number;
  visibility: 'public' | 'invite';
  inviteCode: string;
};
export type CircleInput = Pick<
  Circle,
  'name' | 'description' | 'cover' | 'icon' | 'category' | 'visibility'
>;
export type CircleChannel = {
  id: string;
  circleId: string;
  name: string;
  description: string;
  type: 'text' | 'forum' | 'voice' | 'announcement' | 'events' | 'resources';
  category: string;
  access: 'members' | 'staff';
  unread: number;
};
export type ChannelInput = Pick<
  CircleChannel,
  'name' | 'description' | 'type' | 'category' | 'access'
>;
export type CircleMember = {
  id: string;
  name: string;
  avatar: string;
  role: 'owner' | 'admin' | 'member';
  online: boolean;
};
export type CircleMessage = {
  id: string;
  authorId: string;
  authorName: string;
  avatar: string;
  text: string;
  createdAt: number;
};
export type CircleComment = CircleMessage;
export type CirclePost = {
  id: string;
  circleId: string;
  channelId: string;
  authorId: string;
  authorName: string;
  avatar: string;
  title: string;
  text: string;
  image?: string;
  createdAt: number;
  likes: number;
  liked: boolean;
  featured?: boolean;
  pinned?: boolean;
  comments: CircleComment[];
};
export type CirclePostInput = Pick<CirclePost, 'title' | 'text' | 'image'>;
export function canManage(circle: Pick<Circle, 'role'> | undefined): boolean {
  return circle?.role === 'owner' || circle?.role === 'admin';
}
