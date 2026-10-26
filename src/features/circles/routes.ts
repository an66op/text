const segment = (value: string) => encodeURIComponent(value);
export const circlePaths = {
  list: '/circles/demo',
  create: '/circles/demo/new',
  home: (id: string) => `/circles/${segment(id)}`,
  channel: (id: string, channelId: string) =>
    `/circles/${segment(id)}/channels/${segment(channelId)}`,
  compose: (id: string, channelId: string) =>
    `/circles/${segment(id)}/channels/${segment(channelId)}/new`,
  post: (id: string, postId: string) => `/circles/${segment(id)}/posts/${segment(postId)}`,
  voice: (id: string, channelId: string) => `/circles/${segment(id)}/voice/${segment(channelId)}`,
  members: (id: string) => `/circles/${segment(id)}/members`,
  settings: (id: string) => `/circles/${segment(id)}/settings`,
  invite: (id: string) => `/circles/${segment(id)}/invite`,
  join: (id: string) => `/circles/${segment(id)}/join`,
  createChannel: (id: string) => `/circles/${segment(id)}/channels/new`,
  editChannel: (id: string, channelId: string) =>
    `/circles/${segment(id)}/channels/${segment(channelId)}/edit`,
} as const;
