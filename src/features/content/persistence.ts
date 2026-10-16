import type {
  CatalogItem,
  CommentReply,
  GameResult,
  ReaderSettings,
  ReadingProgress,
  VideoProgress,
} from './types';
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
export const isReading = (value: unknown): value is Record<string, ReadingProgress> =>
  record(value) &&
  Object.values(value).every(
    (item) =>
      record(item) &&
      finite(item.chapter) &&
      item.chapter >= 1 &&
      finite(item.position) &&
      finite(item.updatedAt),
  );
export const isReaderSettings = (value: unknown): value is ReaderSettings =>
  record(value) &&
  finite(value.size) &&
  value.size >= 14 &&
  value.size <= 26 &&
  ['paper', 'white', 'night'].includes(String(value.theme)) &&
  finite(value.lineHeight) &&
  value.lineHeight >= 1.5 &&
  value.lineHeight <= 2.5;
export const isGameResults = (value: unknown): value is GameResult[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      record(item) &&
      typeof item.id === 'string' &&
      typeof item.gameId === 'string' &&
      finite(item.score) &&
      finite(item.total) &&
      finite(item.completedAt),
  );
export const isCommunities = (value: unknown): value is CatalogItem[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      record(item) &&
      typeof item.id === 'string' &&
      typeof item.title === 'string' &&
      typeof item.desc === 'string' &&
      typeof item.img === 'string' &&
      typeof item.badge === 'string' &&
      item.module === '组织' &&
      item.owner === true,
  );
export const isReplies = (value: unknown): value is Record<number, CommentReply[]> =>
  record(value) &&
  Object.entries(value).every(
    ([id, items]) =>
      /^\d+$/.test(id) &&
      Array.isArray(items) &&
      items.every(
        (item) =>
          record(item) &&
          typeof item.id === 'string' &&
          typeof item.text === 'string' &&
          typeof item.author === 'string' &&
          typeof item.parent === 'string' &&
          finite(item.createdAt),
      ),
  );
export const isVideoProgress = (value: unknown): value is Record<string, VideoProgress> =>
  record(value) &&
  Object.values(value).every(
    (item) =>
      record(item) &&
      finite(item.episode) &&
      item.episode >= 1 &&
      finite(item.seconds) &&
      item.seconds >= 0 &&
      finite(item.updatedAt),
  );
export const isLiveMessages = (value: unknown): value is Record<string, string[]> =>
  record(value) &&
  Object.values(value).every(
    (items) => Array.isArray(items) && items.every((item) => typeof item === 'string'),
  );
export const isCover = (value: unknown): value is string =>
  typeof value === 'string' && /^(https?:|data:image\/)/.test(value);
