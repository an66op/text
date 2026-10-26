export type UserRole = 'member' | 'moderator' | 'admin';
export type UserStatus = 'active' | 'suspended';
export type PostStatus = 'published' | 'hidden' | 'pending';
export type ReportStatus = 'open' | 'resolved' | 'dismissed';
export type MediaStatus = 'ready' | 'blocked';
export type CircleStatus = 'active' | 'suspended' | 'archived';
export type EventModeration = 'visible' | 'hidden';
export type EventLifecycle = 'published' | 'cancelled';
export type EventPhase = 'upcoming' | 'ongoing' | 'ended' | 'cancelled';

export interface User {
  id: string;
  handle: string;
  name: string;
  email: string;
  avatar: string;
  bio: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
}

export interface Session {
  user: User;
  expiresAt: string;
}

export type PublicUser = Pick<User, 'id' | 'handle' | 'name' | 'avatar' | 'bio'>;

export interface Post {
  id: string;
  author: PublicUser;
  body: string;
  images: string[];
  topic: string;
  status: PostStatus;
  createdAt: string;
  likeCount: number;
  liked: boolean;
  commentCount: number;
}

export interface MediaAsset {
  id: string;
  url: string;
  contentType: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: string;
  scope: 'world' | 'circle';
  circleId?: string;
}

export interface AdminMediaAsset extends MediaAsset {
  updatedAt: string;
  owner: PublicUser;
  status: MediaStatus;
  note: string;
  referenceCount: number;
  publishedReferenceCount: number;
  posts: Pick<Post, 'id' | 'body' | 'status'>[];
  circleReferenceCount: number;
  circlePublishedReferenceCount: number;
  circlePosts: (Pick<Post, 'id' | 'body' | 'status'> & { circleId: string; channelId: string })[];
}

export interface AdminCircle {
  id: string;
  name: string;
  description: string;
  cover: string;
  icon: string;
  category: string;
  visibility: 'public' | 'private';
  joinPolicy: 'open' | 'approval';
  status: CircleStatus;
  owner: PublicUser;
  role: 'owner' | 'admin' | 'member' | 'guest';
  membership: 'active' | 'pending' | 'banned' | 'none';
  memberCount: number;
  createdAt: string;
  updatedAt: string;
  channelCount: number;
  postCount: number;
  moderationNote: string;
}

export interface AdminCirclePost {
  id: string;
  circleId: string;
  channelId: string;
  author: PublicUser;
  title: string;
  body: string;
  images: string[];
  status: PostStatus;
  featured: boolean;
  pinned: boolean;
  likeCount: number;
  liked: boolean;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  circleName: string;
  channelName: string;
  moderationNote: string;
}

export interface AdminCircleEvent {
  id: string;
  circleId: string;
  creator: PublicUser;
  title: string;
  description: string;
  mode: 'online' | 'offline';
  location: string;
  startsAt: string;
  endsAt: string;
  registrationClosesAt: string;
  capacity: number;
  registeredCount: number;
  waitlistedCount: number;
  lifecycle: EventLifecycle;
  moderation: EventModeration;
  phase: EventPhase;
  registrationOpen: boolean;
  myRegistration: {
    status: 'registered' | 'waitlisted' | 'cancelled';
    reason: '' | 'user' | 'membership' | 'account' | 'event';
    queuePosition: number | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  circleName: string;
  circleStatus: CircleStatus;
  moderationNote: string;
}

export interface Report {
  id: string;
  reporterId: string;
  targetType: 'post' | 'user' | 'circle-post' | 'circle-event';
  targetId: string;
  reason: string;
  status: ReportStatus;
  note: string;
  createdAt: string;
}

export interface Audit {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  targetId: string;
  detail: unknown;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface Overview {
  users: number;
  posts: number;
  conversations: number;
  reports: number;
  pendingReports: number;
  hiddenPosts: number;
  dailyActive: number;
  series: { date: string; users: number; posts: number; messages: number }[];
  recentActivity: Audit[];
}

export interface SystemInfo {
  version: string;
  storage: string;
  environment: string;
  uptimeSeconds: number;
  features: string[];
}
