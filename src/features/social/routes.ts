const segment = (id: string) => encodeURIComponent(id);
export const socialPaths = {
  channels: '/social?type=channels',
  channelCreate: '/social/channels/new',
  channel: (id: string) => `/social/channels/${segment(id)}`,
  channelInfo: (id: string) => `/social/channels/${segment(id)}/info`,
  channelComments: (id: string, postId: string) =>
    `/social/channels/${segment(id)}/posts/${segment(postId)}/comments`,
  friendSearch: '/contacts/search',
  friendRequests: '/contacts/requests',
  friendApply: (id: string) => `/contacts/add/${segment(id)}`,
  contact: (id: string) => `/contacts/${segment(id)}`,
  contactEdit: (id: string) => `/contacts/${segment(id)}/edit`,
  groups: '/social/groups',
  groupCreate: '/social/groups/new',
  chatInfo: (id: string) => `/social/chat/${segment(id)}/info`,
  groupMembers: (id: string) => `/social/chat/${segment(id)}/members`,
  groupInvite: (id: string) => `/social/chat/${segment(id)}/invite`,
  groupNotice: (id: string) => `/social/chat/${segment(id)}/notice`,
  chatSearch: (id: string) => `/social/chat/${segment(id)}/search`,
  call: (id: string, mode: 'voice' | 'video') => `/social/chat/${segment(id)}/call/${mode}`,
  message: (id: string, messageId: string) =>
    `/social/chat/${segment(id)}/message/${segment(messageId)}`,
  tags: '/contacts/tags',
  tagCreate: '/contacts/tags/new',
  tagDetail: (id: string) => `/contacts/tags/${segment(id)}`,
} as const;
export type SocialRouteKind =
  | 'friendSearch'
  | 'friendRequests'
  | 'friendApply'
  | 'contact'
  | 'contactEdit'
  | 'groups'
  | 'groupCreate'
  | 'chatInfo'
  | 'groupMembers'
  | 'groupInvite'
  | 'groupNotice'
  | 'tags'
  | 'tagCreate'
  | 'tagDetail'
  | 'call'
  | 'message'
  | 'chatSearch';
