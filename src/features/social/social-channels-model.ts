import { writeStorage } from '@/shared/lib/storage';
import { pictures } from '@/features/content/fixtures';

export const broadcastReactions = ['👍', '❤️', '🔥', '🎉'] as const;
export type BroadcastComment = {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  createdAt: number;
};
export type BroadcastPost = {
  id: string;
  text: string;
  createdAt: number;
  authorName: string;
  image?: string;
  views?: number;
  viewed?: boolean;
  reactions?: Record<string, number>;
  myReaction?: string;
  comments?: BroadcastComment[];
};
export type SocialChannel = {
  id: string;
  name: string;
  description: string;
  icon: string;
  ownerId: string;
  ownerName: string;
  subscribed: boolean;
  subscriberCount: number;
  createdAt: number;
  posts: BroadcastPost[];
  username?: string;
  muted?: boolean;
  pinnedPostId?: string | null;
  discussionEnabled?: boolean;
};
export type BroadcastStore = { version: 1; channels: SocialChannel[] };
export const SOCIAL_CHANNELS_KEY = 'social-broadcast-channels-v1';
export const SOCIAL_CHANNELS_EVENT = 'social:broadcast-channels-change';
const initialStore: BroadcastStore = {
  version: 1,
  channels: [
    {
      id: 'orbit-updates',
      name: '共鸣动态',
      description: '产品更新、使用小技巧，以及值得留意的新消息。',
      icon: '🪐',
      ownerId: 'orbit-team',
      ownerName: '共鸣团队',
      username: 'gongming_updates',
      pinnedPostId: 'orbit-update-2',
      subscribed: true,
      subscriberCount: 1286,
      createdAt: 1791763200000,
      posts: [
        {
          id: 'orbit-update-2',
          text: '本周更新已送达：通讯里的私聊、群组和频道，现在各有自己的位置。订阅感兴趣的频道，让重要消息有序抵达。',
          createdAt: 1792112400000,
          authorName: '共鸣团队',
          views: 1086,
          reactions: { '👍': 26, '❤️': 18 },
          comments: [
            {
              id: 'orbit-comment-1',
              authorId: 'lin',
              authorName: '林间晚风',
              text: '消息分类很清楚，期待后续更新。',
              createdAt: 1792116000000,
            },
          ],
        },
        {
          id: 'orbit-update-1',
          text: '欢迎来到共鸣动态。这里会持续发布产品消息与使用提示，感谢每一位同行的朋友。',
          createdAt: 1791939600000,
          authorName: '共鸣团队',
          views: 1250,
          image: pictures.sea,
          reactions: { '❤️': 32 },
        },
      ],
    },
    {
      id: 'city-weekend',
      name: '城市周末',
      description: '展览、散步路线和小店，每周收藏一点城市里的新鲜事。',
      icon: '🌇',
      ownerId: 'weekend-editor',
      ownerName: '周末编辑部',
      username: 'city_weekend',
      subscribed: true,
      subscriberCount: 842,
      createdAt: 1791676800000,
      posts: [
        {
          id: 'weekend-guide',
          text: '周末灵感清单\n\n① 找一场小型摄影展，慢慢看完每张照片。\n② 沿熟悉的街区换一条路走，看看秋日的树影。\n③ 带一本书，在喜欢的咖啡店坐一下午。\n\n不必赶行程，留一点时间给偶然。',
          createdAt: 1792108800000,
          authorName: '周末编辑部',
          image: pictures.city,
          views: 623,
          reactions: { '👍': 16, '🔥': 8 },
        },
      ],
    },
    {
      id: 'design-notes',
      name: '设计拾光',
      description: '分享设计观察、创作方法和有意思的作品。',
      icon: '🎨',
      ownerId: 'design-editor',
      ownerName: '拾光工作室',
      username: 'design_notes',
      subscribed: false,
      subscriberCount: 563,
      createdAt: 1791590400000,
      posts: [
        {
          id: 'design-note-1',
          text: '今天的小观察：给重要的内容留足空白，阅读本身就会变得轻松。好的设计，有时只是少做一点。',
          createdAt: 1792026000000,
          authorName: '拾光工作室',
          image: pictures.coffee,
          views: 321,
          reactions: { '❤️': 12 },
        },
      ],
    },
  ],
};
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
const finiteCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const timestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15;
const reaction = (value: unknown): value is string =>
  typeof value === 'string' && broadcastReactions.some((emoji) => emoji === value);
function imageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}
function validComment(value: unknown): value is BroadcastComment {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    !!value.id &&
    typeof value.text === 'string' &&
    !!value.text.trim() &&
    typeof value.authorId === 'string' &&
    typeof value.authorName === 'string' &&
    timestamp(value.createdAt)
  );
}
function validPost(value: unknown): value is BroadcastPost {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    typeof value.text === 'string' &&
    typeof value.authorName === 'string' &&
    timestamp(value.createdAt) &&
    (value.image === undefined || imageUrl(value.image)) &&
    (value.views === undefined || finiteCount(value.views)) &&
    (value.viewed === undefined || typeof value.viewed === 'boolean') &&
    (value.myReaction === undefined || reaction(value.myReaction)) &&
    (value.reactions === undefined ||
      (record(value.reactions) &&
        Object.entries(value.reactions).every(
          ([key, count]) => reaction(key) && finiteCount(count),
        ))) &&
    (value.comments === undefined ||
      (Array.isArray(value.comments) &&
        value.comments.every(validComment) &&
        new Set(value.comments.map((comment) => comment.id)).size === value.comments.length))
  );
}
export function isBroadcastStore(value: unknown): value is BroadcastStore {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.channels)) return false;
  const ids = new Set<string>();
  return value.channels.every((channel: unknown) => {
    if (
      !record(channel) ||
      typeof channel.id !== 'string' ||
      !channel.id ||
      ids.has(channel.id) ||
      typeof channel.name !== 'string' ||
      typeof channel.description !== 'string' ||
      typeof channel.icon !== 'string' ||
      typeof channel.ownerId !== 'string' ||
      typeof channel.ownerName !== 'string' ||
      typeof channel.subscribed !== 'boolean' ||
      typeof channel.subscriberCount !== 'number' ||
      !Number.isInteger(channel.subscriberCount) ||
      channel.subscriberCount < 0 ||
      typeof channel.createdAt !== 'number' ||
      !Number.isFinite(channel.createdAt) ||
      !Array.isArray(channel.posts) ||
      !channel.posts.every(validPost) ||
      (channel.username !== undefined &&
        (typeof channel.username !== 'string' || !channel.username.trim())) ||
      (channel.muted !== undefined && typeof channel.muted !== 'boolean') ||
      (channel.discussionEnabled !== undefined && typeof channel.discussionEnabled !== 'boolean') ||
      (channel.pinnedPostId !== undefined &&
        channel.pinnedPostId !== null &&
        !channel.posts.some((post) => post.id === channel.pinnedPostId)) ||
      new Set(channel.posts.map((post) => post.id)).size !== channel.posts.length
    )
      return false;
    ids.add(channel.id);
    return true;
  });
}
function normalizeStore(store: BroadcastStore): BroadcastStore {
  return {
    ...store,
    channels: store.channels.map((channel) => {
      const seed = initialStore.channels.find((item) => item.id === channel.id);
      return {
        ...channel,
        username:
          channel.username ??
          seed?.username ??
          `channel_${channel.id.replace(/[^a-zA-Z0-9]/g, '').slice(-8)}`,
        muted: channel.muted ?? false,
        discussionEnabled: channel.discussionEnabled ?? true,
        pinnedPostId:
          channel.pinnedPostId === undefined
            ? seed?.pinnedPostId && channel.posts.some((post) => post.id === seed.pinnedPostId)
              ? seed.pinnedPostId
              : null
            : channel.pinnedPostId,
        posts: channel.posts.map((post) => {
          const sample = seed?.posts.find((item) => item.id === post.id);
          return {
            ...post,
            image: post.image ?? sample?.image,
            views: post.views ?? sample?.views ?? 0,
            viewed: post.viewed ?? false,
            reactions: post.reactions ?? sample?.reactions ?? {},
            comments: post.comments ?? sample?.comments ?? [],
          };
        }),
      };
    }),
  };
}
let cachedRaw: string | null | undefined;
let cachedStore = normalizeStore(initialStore);
export function getBroadcastSnapshot(): BroadcastStore {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SOCIAL_CHANNELS_KEY);
  } catch {
    return cachedStore;
  }
  if (cachedRaw === raw) return cachedStore;
  cachedRaw = raw;
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    cachedStore = normalizeStore(isBroadcastStore(parsed) ? parsed : initialStore);
  } catch {
    cachedStore = normalizeStore(initialStore);
  }
  return cachedStore;
}
function commit(store: BroadcastStore) {
  if (!isBroadcastStore(store)) throw new Error('频道数据无效，请重试。');
  if (!writeStorage(SOCIAL_CHANNELS_KEY, store))
    throw new Error('保存失败，请检查本机存储空间后重试。');
  window.dispatchEvent(new Event(SOCIAL_CHANNELS_EVENT));
}
export function setChannelSubscription(id: string, subscribed: boolean) {
  const store = getBroadcastSnapshot();
  const channel = store.channels.find((item) => item.id === id);
  if (!channel) throw new Error('频道不存在或已被删除。');
  if (channel.ownerId === 'me' && !subscribed) throw new Error('你创建的频道会自动订阅。');
  if (channel.subscribed === subscribed) return;
  commit({
    ...store,
    channels: store.channels.map((item) =>
      item.id === id
        ? {
            ...item,
            subscribed,
            subscriberCount: Math.max(0, item.subscriberCount + (subscribed ? 1 : -1)),
            muted: subscribed ? item.muted : false,
          }
        : item,
    ),
  });
}
export function createSocialChannel(
  input: { name: string; description: string; icon: string },
  authorName: string,
) {
  const name = input.name.trim();
  const description = input.description.trim();
  if (!name || name.length > 30) throw new Error('请填写 1–30 字的频道名称。');
  if (!description || description.length > 200) throw new Error('请填写 1–200 字的频道介绍。');
  const store = getBroadcastSnapshot();
  const id = `broadcast-${crypto.randomUUID()}`;
  const channel: SocialChannel = {
    id,
    name,
    description,
    icon: input.icon || '📣',
    ownerId: 'me',
    ownerName: authorName.trim() || '我',
    subscribed: true,
    subscriberCount: 1,
    createdAt: Date.now(),
    posts: [],
    username: `channel_${id.replaceAll('-', '').slice(-8)}`,
    muted: false,
    discussionEnabled: true,
    pinnedPostId: null,
  };
  commit({ ...store, channels: [channel, ...store.channels] });
  return id;
}
export function publishBroadcast(id: string, text: string, _authorName: string, image?: string) {
  const store = getBroadcastSnapshot();
  const channel = store.channels.find((item) => item.id === id);
  if (!channel) throw new Error('频道不存在或已被删除。');
  if (channel.ownerId !== 'me') throw new Error('只有频道创建者可以发布广播。');
  const content = text.trim();
  const media = image?.trim();
  if ((!content && !media) || content.length > 5000)
    throw new Error('请填写 1–5000 字的广播内容，或附上一张图片。');
  if (media && !imageUrl(media)) throw new Error('请输入有效的 http 或 https 图片地址。');
  const post: BroadcastPost = {
    id: crypto.randomUUID(),
    text: content,
    createdAt: Date.now(),
    authorName: channel.name,
    ...(media ? { image: media } : {}),
    views: 0,
    viewed: false,
    reactions: {},
    comments: [],
  };
  commit({
    ...store,
    channels: store.channels.map((item) =>
      item.id === id ? { ...item, posts: [post, ...item.posts] } : item,
    ),
  });
  return post.id;
}

function selectedChannel(id: string, member = false) {
  const store = getBroadcastSnapshot();
  const channel = store.channels.find((item) => item.id === id);
  if (!channel) throw new Error('频道不存在或已被删除。');
  if (member && !channel.subscribed) throw new Error('请先加入频道。');
  return { store, channel };
}
function selectedPost(channel: SocialChannel, postId: string) {
  const post = channel.posts.find((item) => item.id === postId);
  if (!post) throw new Error('频道消息不存在或已被删除。');
  return post;
}
function updatePost(store: BroadcastStore, channelId: string, post: BroadcastPost) {
  commit({
    ...store,
    channels: store.channels.map((item) =>
      item.id === channelId
        ? { ...item, posts: item.posts.map((value) => (value.id === post.id ? post : value)) }
        : item,
    ),
  });
}
export function setChannelMuted(id: string, muted: boolean) {
  const { store } = selectedChannel(id, true);
  if (typeof muted !== 'boolean') throw new Error('通知设置无效。');
  commit({
    ...store,
    channels: store.channels.map((item) => (item.id === id ? { ...item, muted } : item)),
  });
}
export function pinBroadcastPost(id: string, postId: string | null) {
  const { store, channel } = selectedChannel(id, true);
  if (channel.ownerId !== 'me') throw new Error('只有频道创建者可以置顶消息。');
  if (postId !== null) selectedPost(channel, postId);
  commit({
    ...store,
    channels: store.channels.map((item) =>
      item.id === id ? { ...item, pinnedPostId: postId } : item,
    ),
  });
}
export function markBroadcastViewed(id: string, postId: string) {
  const { store, channel } = selectedChannel(id);
  const post = selectedPost(channel, postId);
  if (post.viewed) return;
  updatePost(store, id, { ...post, views: (post.views ?? 0) + 1, viewed: true });
}
export function toggleBroadcastReaction(id: string, postId: string, emoji: string) {
  const { store, channel } = selectedChannel(id, true);
  const post = selectedPost(channel, postId);
  if (!reaction(emoji)) throw new Error('请选择支持的表态。');
  const counts = { ...post.reactions };
  if (post.myReaction) counts[post.myReaction] = Math.max(0, (counts[post.myReaction] ?? 0) - 1);
  const mine = post.myReaction === emoji ? undefined : emoji;
  if (mine) counts[mine] = (counts[mine] ?? 0) + 1;
  updatePost(store, id, { ...post, myReaction: mine, reactions: counts });
}
export function addBroadcastComment(id: string, postId: string, text: string, authorName: string) {
  const { store, channel } = selectedChannel(id, true);
  const post = selectedPost(channel, postId);
  if (channel.discussionEnabled === false) throw new Error('此频道未开启评论。');
  const content = text.trim();
  if (!content || content.length > 2000) throw new Error('请输入 1–2000 字的评论。');
  const comment: BroadcastComment = {
    id: crypto.randomUUID(),
    authorId: 'me',
    authorName: authorName.trim() || '我',
    text: content,
    createdAt: Date.now(),
  };
  updatePost(store, id, { ...post, comments: [...(post.comments ?? []), comment] });
}
