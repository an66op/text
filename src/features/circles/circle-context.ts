import { createContext } from 'react';
import type {
  Circle,
  CircleChannel,
  CircleInput,
  CircleMember,
  CircleMessage,
  CirclePost,
  CirclePostInput,
  ChannelInput,
} from './types';

export type CirclesState = {
  circles: Circle[];
  getCircle: (id: string) => Circle | undefined;
  getChannels: (circleId: string) => CircleChannel[];
  getMembers: (circleId: string) => CircleMember[];
  getMessages: (circleId: string, channelId: string) => CircleMessage[];
  getPosts: (circleId: string, channelId?: string) => CirclePost[];
  canViewChannel: (circleId: string, channelId: string) => boolean;
  markRead: (circleId: string, channelId: string) => void;
  joinCircle: (id: string, code?: string) => void;
  leaveCircle: (id: string) => void;
  createCircle: (input: CircleInput) => string;
  updateCircle: (id: string, changes: Partial<CircleInput>) => void;
  deleteCircle: (id: string) => void;
  createChannel: (circleId: string, input: ChannelInput) => string;
  updateChannel: (circleId: string, channelId: string, changes: Partial<ChannelInput>) => void;
  deleteChannel: (circleId: string, channelId: string) => void;
  setMemberRole: (circleId: string, memberId: string, role: 'admin' | 'member') => void;
  removeMember: (circleId: string, memberId: string) => void;
  sendMessage: (circleId: string, channelId: string, text: string) => void;
  addPost: (circleId: string, channelId: string, input: CirclePostInput) => string;
  addComment: (circleId: string, postId: string, text: string) => void;
  togglePostLike: (circleId: string, postId: string) => void;
  setPostFeatured: (circleId: string, postId: string, featured: boolean) => void;
  setPostPinned: (circleId: string, postId: string, pinned: boolean) => void;
  toggleEvent: (circleId: string, eventId: string, channelId?: string) => void;
  isAttending: (circleId: string, eventId: string, channelId?: string) => boolean;
};
export const CircleContext = createContext<CirclesState | null>(null);
