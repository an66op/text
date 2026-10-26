export type ListResult<T> = { items: T[]; total: number };
export type PlatformUser = {
  id: string;
  handle: string;
  name: string;
  email: string;
  avatar: string;
  bio: string;
  role: 'member' | 'moderator' | 'admin';
  status: 'active' | 'suspended';
  createdAt: string;
};
export type PublicUser = Pick<PlatformUser, 'id' | 'handle' | 'name' | 'avatar' | 'bio'>;
export type Session = { user: PlatformUser; expiresAt: string };
export type PlatformPost = {
  id: string;
  author: PublicUser;
  body: string;
  images: string[];
  topic: string;
  status: 'published' | 'hidden' | 'pending';
  createdAt: string;
  likeCount: number;
  liked: boolean;
  commentCount: number;
};
export type PlatformComment = {
  id: string;
  postId: string;
  author: PublicUser;
  body: string;
  createdAt: string;
};
export type ConversationKind = 'direct' | 'group' | 'channel';
export type PlatformMessage = {
  id: string;
  conversationId: string;
  sender: PublicUser;
  body: string;
  createdAt: string;
};
export type Conversation = {
  id: string;
  title: string;
  kind: ConversationKind;
  members: string[];
  ownerId: string;
  createdAt: string;
  lastMessage?: PlatformMessage;
};
export type Health = { status: string; [key: string]: unknown };
