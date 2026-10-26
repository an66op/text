import type { PlatformPost, PlatformUser, Session } from '@/shared/api/types';
import type { AuthState } from './auth-context';

export const member: PlatformUser = {
  id: 'user-member',
  handle: 'member',
  name: '示例成员',
  email: 'member@example.test',
  avatar: '',
  bio: '',
  role: 'member',
  status: 'active',
  createdAt: '2026-10-27T08:00:00Z',
};
export const otherMember: PlatformUser = {
  ...member,
  id: 'user-other',
  handle: 'other',
  name: '另一位成员',
  email: 'other@example.test',
};
export const session: Session = { user: member, expiresAt: '2099-10-27T08:00:00Z' };
export const post: PlatformPost = {
  id: 'post-one',
  author: otherMember,
  body: '真实服务中的想法',
  images: [],
  topic: '设计',
  status: 'published',
  createdAt: '2026-10-27T08:00:00Z',
  likeCount: 3,
  liked: false,
  commentCount: 0,
};
export function signedIn(user = member): AuthState {
  return {
    user,
    status: 'authenticated',
    error: '',
    expiresAt: session.expiresAt,
    refresh: async () => {},
    login: async () => {},
    register: async () => {},
    logout: async () => {},
    loginWallet: async () => true,
    updateProfile: async () => {},
  };
}
