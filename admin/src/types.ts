export type UserRole = 'member' | 'moderator' | 'admin';
export type UserStatus = 'active' | 'suspended';
export type PostStatus = 'published' | 'hidden' | 'pending';
export type ReportStatus = 'open' | 'resolved' | 'dismissed';

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

export interface Report {
  id: string;
  reporterId: string;
  targetType: 'post' | 'user';
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
