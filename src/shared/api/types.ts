export type ListResult<T> = { items: T[]; total: number; unreadTotal?: number };
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
export type MessageImage = {
  id: string;
  url: string | null;
  contentType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  bytes: number;
  available: boolean;
};
export type MessageReply = {
  id: string;
  revision: number;
  available: boolean;
  sender: PublicUser | null;
  body: string | null;
  imageCount: number;
};
export type PlatformMessage = {
  id: string;
  conversationId: string;
  sender: PublicUser;
  body: string;
  createdAt: string;
  seq?: number;
  clientId?: string;
  status?: 'sent' | 'retracted';
  revision?: number;
  retractedAt?: string | null;
  canRetract?: boolean;
  images?: MessageImage[];
  replyTo?: MessageReply | null;
};
export type Conversation = {
  id: string;
  title: string;
  kind: ConversationKind;
  members: string[];
  ownerId: string;
  createdAt: string;
  lastMessage?: PlatformMessage;
  mutationVersion?: number;
  unreadCount?: number;
  readSeq?: number;
  lastReadMessageId?: string;
};
export type MessagePage = ListResult<PlatformMessage> & {
  mutationVersion?: number;
  hasMore?: boolean;
  nextBeforeId?: string | null;
  nextBeforeSeq?: number | null;
};
export type ReadMark = {
  conversationId: string;
  lastReadMessageId: string;
  readSeq: number;
  unreadCount: number;
};
export type Health = { status: string; [key: string]: unknown };

export type MessageResolve = {
  items: PlatformMessage[];
  missingIds: string[];
  mutationVersion: number;
};
