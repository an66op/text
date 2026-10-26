import type { PublicUser } from '@/shared/api/types';

export type ContactPolicy = 'everyone' | 'friends' | 'nobody';
export type ContactPrivacyFields = {
  directMessagePolicy: ContactPolicy;
  groupInvitePolicy: ContactPolicy;
  allowFriendRequests: boolean;
  discoverableByHandle: boolean;
};
export type ContactPrivacy = ContactPrivacyFields & { revision: number; updatedAt: string | null };
export type ContactCapabilities = {
  userId: string;
  blockedByMe: boolean;
  canMessage: boolean;
  canRequestFriend: boolean;
  canInvite: boolean;
  revision: number;
};
export type BlockEntry = {
  userId: string;
  user: PublicUser | null;
  available: boolean;
  createdAt: string;
};
export type BlockList = {
  items: BlockEntry[];
  total: number;
  revision: number;
  updatedAt: string | null;
};
export type BlockReceipt = {
  ok: true;
  userId: string;
  blocked: boolean;
  revision: number;
  updatedAt: string | null;
};
