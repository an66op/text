const segment = encodeURIComponent;
const home = (circleId: string) => `/circles/s/${segment(circleId)}`;
export const circlePaths = {
  list: '/circles',
  demo: '/circles/demo',
  create: '/circles/new',
  home,
  channel: (id: string, channelId: string) => `${home(id)}/channels/${segment(channelId)}`,
  post: (id: string, postId: string) => `${home(id)}/posts/${segment(postId)}`,
  compose: (id: string, channelId?: string) =>
    `${home(id)}/compose${channelId ? `?channel=${segment(channelId)}` : ''}`,
  members: (id: string) => `${home(id)}/members`,
  manage: (id: string) => `${home(id)}/manage`,
  join: (id: string) => `${home(id)}/join`,
  invite: (id: string) => `${home(id)}/invite`,
};
