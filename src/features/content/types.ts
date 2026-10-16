export type Post = {
  id: number;
  name: string;
  tag: string;
  text: string;
  image?: string;
  likes: number;
  kind: string;
  target?: 'activity' | 'world';
  owner?: boolean;
  images?: string[];
  location?: string;
  audience?: 'public' | 'friends' | 'self';
  createdAt?: number;
};

export type CatalogModule = '直播' | '视频' | '小说' | '组织' | '游戏';
export type DetailKind = 'post' | 'watch' | 'read' | 'game' | 'community';
export type CatalogItem = {
  id: string;
  module: CatalogModule;
  title: string;
  desc: string;
  img: string;
  badge: string;
  owner?: boolean;
  author?: string;
  category?: string;
};

export type ReadingProgress = { chapter: number; position: number; updatedAt: number };
export type ReaderSettings = {
  size: number;
  theme: 'paper' | 'white' | 'night';
  lineHeight: number;
};
export type GameResult = {
  id: string;
  gameId: string;
  score: number;
  total: number;
  completedAt: number;
};
export type VideoProgress = { episode: number; seconds: number; updatedAt: number };
export type CommentReply = {
  id: string;
  text: string;
  author: string;
  parent: string;
  createdAt: number;
};
export type ContentRouteKind =
  | 'compose'
  | 'cover'
  | 'profile'
  | 'post-actions'
  | 'short-comments'
  | 'book'
  | 'chapters'
  | 'bookshelf'
  | 'reading-settings'
  | 'game-results'
  | 'community-create'
  | 'community-manage'
  | 'community-members'
  | 'community-event'
  | 'topics';

export type FeedVariant = 'world' | 'moments';
export type FeedTab = '推荐' | '最新' | '热门';

export const isPost = (value: unknown): value is Post => {
  if (!value || typeof value !== 'object') return false;
  const post = value as Record<string, unknown>;
  return (
    typeof post.id === 'number' &&
    Number.isFinite(post.id) &&
    typeof post.name === 'string' &&
    typeof post.tag === 'string' &&
    typeof post.text === 'string' &&
    typeof post.likes === 'number' &&
    Number.isFinite(post.likes) &&
    typeof post.kind === 'string' &&
    (post.image === undefined || typeof post.image === 'string') &&
    (post.images === undefined ||
      (Array.isArray(post.images) && post.images.every((image) => typeof image === 'string')))
  );
};
export const isPostArray = (value: unknown): value is Post[] =>
  Array.isArray(value) && value.every(isPost);
export const isComments = (value: unknown): value is Record<number, string[]> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([key, comments]) =>
      /^\d+$/.test(key) &&
      Array.isArray(comments) &&
      comments.every((comment) => typeof comment === 'string'),
  );
};
export const isChapter = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;
