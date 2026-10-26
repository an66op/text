import type { PublicUser } from '@/shared/api/types';

export type Friend = { user: PublicUser; since: string };
export type FriendRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';
export type FriendRequest = {
  id: string;
  from: PublicUser;
  to: PublicUser;
  note: string;
  status: FriendRequestStatus;
  createdAt: string;
  updatedAt: string;
};
export type Relationship = {
  status: 'self' | 'none' | 'friends' | 'incoming' | 'outgoing';
  request?: FriendRequest;
  since?: string;
};
export type RequestDirection = 'incoming' | 'outgoing';
export type RequestAction = 'accept' | 'decline' | 'cancel';
