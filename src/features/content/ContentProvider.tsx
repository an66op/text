import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useLocalStorage } from '@/shared/hooks/useLocalStorage';
import { isNumberArray, isStringArray } from '@/shared/lib/storage';
import { pictures } from './fixtures';
import {
  isChapter,
  isComments,
  isPostArray,
  type CatalogItem,
  type CommentReply,
  type GameResult,
  type Post,
  type ReaderSettings,
  type ReadingProgress,
  type VideoProgress,
} from './types';
import { legacyMemberships, migrateLegacyPosts } from './migrations';
import { ContentContext } from './content-context';
import {
  isCommunities,
  isCover,
  isGameResults,
  isLiveMessages,
  isReaderSettings,
  isReading,
  isReplies,
  isVideoProgress,
} from './persistence';

const emptyNumbers: number[] = [];
const emptyStrings: string[] = [];
const emptyComments: Record<number, string[]> = {};
const emptyReading: Record<string, ReadingProgress> = {};
const emptyResults: GameResult[] = [];
const emptyCommunities: CatalogItem[] = [];
const emptyReplies: Record<number, CommentReply[]> = {};
const emptyVideo: Record<string, VideoProgress> = {};
const emptyLive: Record<string, string[]> = {};
const defaultReader: ReaderSettings = { size: 18, theme: 'paper', lineHeight: 2 };
function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
export function ContentProvider({ children }: { children: ReactNode }) {
  const [initialPosts] = useState(migrateLegacyPosts);
  const [initialMemberships] = useState(legacyMemberships);
  const [posts, setPosts] = useLocalStorage('posts', initialPosts, isPostArray);
  const [likes, setLikes] = useLocalStorage('likes', emptyNumbers, isNumberArray);
  const [bookmarks, setBookmarks] = useLocalStorage('bookmarks', emptyNumbers, isNumberArray);
  const [follows, setFollows] = useLocalStorage('follows', emptyStrings, isStringArray);
  const [comments, setComments] = useLocalStorage('comments', emptyComments, isComments);
  const [bookshelf, setBookshelf] = useLocalStorage(
    'content-bookshelf-ids',
    initialMemberships.books,
    isStringArray,
  );
  const [memberships, setMemberships] = useLocalStorage(
    'content-community-ids',
    initialMemberships.communities,
    isStringArray,
  );
  const [chapter, setChapter] = useLocalStorage('chapter', 1, isChapter);
  const [cover, setCover] = useLocalStorage('content-cover', pictures.forest, isCover);
  const [reading, setReading] = useLocalStorage('content-reading', emptyReading, isReading);
  const [readerSettings, setReaderSettings] = useLocalStorage(
    'content-reader-settings',
    defaultReader,
    isReaderSettings,
  );
  const [results, setResults] = useLocalStorage(
    'content-game-results',
    emptyResults,
    isGameResults,
  );
  const [communities, setCommunities] = useLocalStorage(
    'content-communities',
    emptyCommunities,
    isCommunities,
  );
  const [attendance, setAttendance] = useLocalStorage(
    'content-attendance',
    emptyStrings,
    isStringArray,
  );
  const [replies, setReplies] = useLocalStorage('content-replies', emptyReplies, isReplies);
  const [videoProgress, setVideoProgress] = useLocalStorage(
    'content-video-progress',
    emptyVideo,
    isVideoProgress,
  );
  const [liveMessages, setLiveMessages] = useLocalStorage(
    'content-live-messages',
    emptyLive,
    isLiveMessages,
  );
  const toggleLike = useCallback(
    (id: number) => setLikes((previous) => toggleValue(previous, id)),
    [setLikes],
  );
  const toggleBookmark = useCallback(
    (id: number) => setBookmarks((previous) => toggleValue(previous, id)),
    [setBookmarks],
  );
  const toggleFollow = useCallback(
    (name: string) => setFollows((previous) => toggleValue(previous, name)),
    [setFollows],
  );
  const toggleShelf = useCallback(
    (id: string) => setBookshelf((previous) => toggleValue(previous, id)),
    [setBookshelf],
  );
  const toggleMembership = useCallback(
    (id: string) => setMemberships((previous) => toggleValue(previous, id)),
    [setMemberships],
  );
  const addPost = useCallback(
    (post: Omit<Post, 'id' | 'likes'>) => {
      const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
      setPosts((previous) => [{ ...post, id, likes: 0 }, ...previous]);
      return id;
    },
    [setPosts],
  );
  const deletePost = useCallback(
    (id: number) => {
      setPosts((previous) => previous.filter((post) => post.id !== id));
      setComments((previous) =>
        Object.fromEntries(Object.entries(previous).filter(([key]) => Number(key) !== id)),
      );
      setReplies((previous) =>
        Object.fromEntries(Object.entries(previous).filter(([key]) => Number(key) !== id)),
      );
      setLikes((previous) => previous.filter((key) => key !== id));
      setBookmarks((previous) => previous.filter((key) => key !== id));
    },
    [setPosts, setComments, setReplies, setLikes, setBookmarks],
  );
  const addComment = useCallback(
    (id: number, comment: string) => {
      const text = comment.trim();
      if (text) setComments((previous) => ({ ...previous, [id]: [...(previous[id] ?? []), text] }));
    },
    [setComments],
  );
  const deleteComment = useCallback(
    (id: number, index: number) => {
      setComments((previous) => ({
        ...previous,
        [id]: (previous[id] ?? []).filter((_, position) => index !== position),
      }));
      setReplies((previous) => ({
        ...previous,
        [id]: (previous[id] ?? [])
          .filter((reply) => reply.parent !== `own-${index}`)
          .map((reply) => {
            const match = /^own-(\d+)$/.exec(reply.parent);
            return match && Number(match[1]) > index
              ? { ...reply, parent: `own-${Number(match[1]) - 1}` }
              : reply;
          }),
      }));
    },
    [setComments, setReplies],
  );
  const addReply = useCallback(
    (id: number, reply: Omit<CommentReply, 'id' | 'createdAt'>) => {
      if (!reply.text.trim()) return;
      setReplies((previous) => ({
        ...previous,
        [id]: [
          ...(previous[id] ?? []),
          { ...reply, text: reply.text.trim(), id: crypto.randomUUID(), createdAt: Date.now() },
        ],
      }));
    },
    [setReplies],
  );
  const changeChapter = useCallback(
    (delta: number) => setChapter((previous) => Math.max(1, previous + delta)),
    [setChapter],
  );
  const saveReading = useCallback(
    (id: string, selected: number, position = 0) => {
      setReading((previous) => ({
        ...previous,
        [id]: { chapter: Math.max(1, selected), position, updatedAt: Date.now() },
      }));
    },
    [setReading],
  );
  const saveGameResult = useCallback(
    (gameId: string, score: number, total: number) => {
      setResults((previous) =>
        [
          { id: crypto.randomUUID(), gameId, score, total, completedAt: Date.now() },
          ...previous,
        ].slice(0, 100),
      );
    },
    [setResults],
  );
  const createCommunity = useCallback(
    (item: Omit<CatalogItem, 'id' | 'module' | 'owner'>) => {
      const id = `organization-${crypto.randomUUID()}`;
      setCommunities((previous) => [{ ...item, id, module: '组织', owner: true }, ...previous]);
      setMemberships((previous) => [...previous, id]);
      return id;
    },
    [setCommunities, setMemberships],
  );
  const updateCommunity = useCallback(
    (id: string, changes: Partial<CatalogItem>) => {
      setCommunities((previous) =>
        previous.map((item) =>
          item.id === id ? { ...item, ...changes, id, module: '组织', owner: true } : item,
        ),
      );
    },
    [setCommunities],
  );
  const deleteCommunity = useCallback(
    (id: string) => {
      setCommunities((previous) => previous.filter((item) => item.id !== id));
      setMemberships((previous) => previous.filter((key) => key !== id));
      setAttendance((previous) => previous.filter((key) => !key.startsWith(`${id}:`)));
    },
    [setCommunities, setMemberships, setAttendance],
  );
  const toggleAttendance = useCallback(
    (id: string) => setAttendance((previous) => toggleValue(previous, id)),
    [setAttendance],
  );
  const saveVideoProgress = useCallback(
    (id: string, episode: number, seconds: number) => {
      if (!Number.isFinite(seconds)) return;
      setVideoProgress((previous) => ({
        ...previous,
        [id]: { episode, seconds, updatedAt: Date.now() },
      }));
    },
    [setVideoProgress],
  );
  const addLiveMessage = useCallback(
    (id: string, draft: string) => {
      const text = draft.trim();
      if (text)
        setLiveMessages((previous) => ({
          ...previous,
          [id]: [...(previous[id] ?? []), text].slice(-100),
        }));
    },
    [setLiveMessages],
  );
  const value = useMemo(
    () => ({
      posts,
      likes,
      bookmarks,
      follows,
      comments,
      bookshelf,
      memberships,
      chapter,
      cover,
      reading,
      readerSettings,
      results,
      communities,
      attendance,
      replies,
      videoProgress,
      liveMessages,
      toggleLike,
      toggleBookmark,
      toggleFollow,
      toggleShelf,
      toggleMembership,
      addPost,
      deletePost,
      addComment,
      deleteComment,
      addReply,
      changeChapter,
      setCover,
      saveReading,
      setReaderSettings,
      saveGameResult,
      createCommunity,
      updateCommunity,
      deleteCommunity,
      toggleAttendance,
      saveVideoProgress,
      addLiveMessage,
    }),
    [
      posts,
      likes,
      bookmarks,
      follows,
      comments,
      bookshelf,
      memberships,
      chapter,
      cover,
      reading,
      readerSettings,
      results,
      communities,
      attendance,
      replies,
      videoProgress,
      liveMessages,
      toggleLike,
      toggleBookmark,
      toggleFollow,
      toggleShelf,
      toggleMembership,
      addPost,
      deletePost,
      addComment,
      deleteComment,
      addReply,
      changeChapter,
      setCover,
      saveReading,
      setReaderSettings,
      saveGameResult,
      createCommunity,
      updateCommunity,
      deleteCommunity,
      toggleAttendance,
      saveVideoProgress,
      addLiveMessage,
    ],
  );
  return <ContentContext.Provider value={value}>{children}</ContentContext.Provider>;
}
