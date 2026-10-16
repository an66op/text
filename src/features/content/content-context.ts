import { createContext } from 'react';
import type {
  CatalogItem,
  CommentReply,
  GameResult,
  Post,
  ReaderSettings,
  ReadingProgress,
  VideoProgress,
} from './types';

export type ContentState = {
  posts: Post[];
  likes: number[];
  bookmarks: number[];
  follows: string[];
  comments: Record<number, string[]>;
  bookshelf: string[];
  memberships: string[];
  chapter: number;
  cover: string;
  reading: Record<string, ReadingProgress>;
  readerSettings: ReaderSettings;
  results: GameResult[];
  communities: CatalogItem[];
  attendance: string[];
  replies: Record<number, CommentReply[]>;
  videoProgress: Record<string, VideoProgress>;
  liveMessages: Record<string, string[]>;
  toggleLike: (id: number) => void;
  toggleBookmark: (id: number) => void;
  toggleFollow: (name: string) => void;
  toggleShelf: (id: string) => void;
  toggleMembership: (id: string) => void;
  addPost: (post: Omit<Post, 'id' | 'likes'>) => number;
  deletePost: (id: number) => void;
  addComment: (id: number, comment: string) => void;
  deleteComment: (id: number, index: number) => void;
  addReply: (id: number, reply: Omit<CommentReply, 'id' | 'createdAt'>) => void;
  changeChapter: (delta: number) => void;
  setCover: (url: string) => void;
  saveReading: (id: string, chapter: number, position?: number) => void;
  setReaderSettings: (settings: ReaderSettings) => void;
  saveGameResult: (gameId: string, score: number, total: number) => void;
  createCommunity: (item: Omit<CatalogItem, 'id' | 'module' | 'owner'>) => string;
  updateCommunity: (id: string, changes: Partial<CatalogItem>) => void;
  deleteCommunity: (id: string) => void;
  toggleAttendance: (id: string) => void;
  saveVideoProgress: (id: string, episode: number, seconds: number) => void;
  addLiveMessage: (id: string, text: string) => void;
};

export const ContentContext = createContext<ContentState | null>(null);
