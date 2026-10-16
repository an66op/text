import type { Dispatch, SetStateAction } from 'react';
export type View = '消息' | '通讯录';
export type Contact = {
  id: string;
  name: string;
  avatar: number;
  note: string;
  letter: string;
  status: string;
  region?: string;
};
export type Conversation = {
  id: string;
  name: string;
  avatar?: number;
  kind: 'person' | 'group' | 'file';
  preview: string;
  time: string;
  unread: number;
  pinned?: boolean;
  muted?: boolean;
  members?: string[];
  notice?: string;
  owner?: string;
};
export type MessageFile = { name: string; content: string; size: number; type: string };
export type ChatMessage = {
  id: string;
  mine: boolean;
  text?: string;
  image?: string;
  file?: MessageFile;
  time: string;
  senderId?: string;
};
export type Props = {
  initialView?: View;
  onOpenModule: (name: string) => void;
  profileName: string;
  profileAvatar?: string;
};
export type SocialAction = 'group' | 'friend' | 'newFriends' | 'groups' | 'tags';
export type SocialTag = { id: string; name: string; contactIds: string[] };
export type ContactNote = { alias: string; description: string };
export type FriendRequest = {
  id: string;
  contactId: string;
  direction: 'incoming' | 'outgoing';
  greeting: string;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  date: string;
};
export type SocialStore = {
  conversations: Conversation[];
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  messages: Record<string, ChatMessage[]>;
  setMessages: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>;
  accepted: string[];
  setAccepted: Dispatch<SetStateAction<string[]>>;
  requests: FriendRequest[];
  setRequests: Dispatch<SetStateAction<FriendRequest[]>>;
  notes: Record<string, ContactNote>;
  setNotes: Dispatch<SetStateAction<Record<string, ContactNote>>>;
  tags: SocialTag[];
  setTags: Dispatch<SetStateAction<SocialTag[]>>;
  unread: number;
};
