import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocalStorage } from '@/shared/hooks/useLocalStorage';
import { isStringArray, readStorage, writeStorage } from '@/shared/lib/storage';
import { initialConversations, initialMessages, initialRequests, initialTags } from './fixtures';
import {
  isConversations,
  isMessages,
  loadMessages,
  isFriendRequests,
  isContactNotes,
  isSocialTags,
} from './social-model';
import { SocialContext } from './social-context';
// Refresh the provider without recreating the context used by chat consumers.

const emptyAccepted: string[] = [];
const emptyNotes = {};

function useSocialState() {
  const [messageSeed] = useState(loadMessages);
  const [conversations, setConversations] = useLocalStorage(
    'social-conversations',
    initialConversations,
    isConversations,
  );
  const [messages, setMessages] = useLocalStorage('social-messages', messageSeed, isMessages);
  const [accepted, setAccepted] = useLocalStorage<string[]>(
    'social-accepted',
    emptyAccepted,
    isStringArray,
  );
  const [requests, setRequests] = useLocalStorage<import('./types').FriendRequest[]>(
    'social-requests',
    initialRequests,
    isFriendRequests,
  );
  const [notes, setNotes] = useLocalStorage<Record<string, import('./types').ContactNote>>(
    'social-contact-notes',
    emptyNotes,
    isContactNotes,
  );
  const [tags, setTags] = useLocalStorage('social-tags', initialTags, isSocialTags);
  useEffect(() => {
    const version = readStorage(
      'social-fixture-version',
      0,
      (value): value is number => typeof value === 'number' && Number.isFinite(value),
    );
    if (version >= 2) return;
    // Enrich previous demos once; later exits and deletions remain authoritative.
    setConversations((current) => [
      ...current,
      ...initialConversations.filter((seed) => !current.some((item) => item.id === seed.id)),
    ]);
    setMessages((current) => ({ ...initialMessages, ...current }));
    writeStorage('social-fixture-version', 2);
  }, [setConversations, setMessages]);
  const unread = conversations.reduce(
    (sum, conversation) => sum + (conversation.muted ? 0 : conversation.unread),
    0,
  );
  return useMemo(
    () => ({
      conversations,
      setConversations,
      messages,
      setMessages,
      accepted,
      setAccepted,
      requests,
      setRequests,
      notes,
      setNotes,
      tags,
      setTags,
      unread,
    }),
    [
      conversations,
      setConversations,
      messages,
      setMessages,
      accepted,
      setAccepted,
      requests,
      setRequests,
      notes,
      setNotes,
      tags,
      setTags,
      unread,
    ],
  );
}

export function SocialProvider({ children }: { children: ReactNode }) {
  const value = useSocialState();
  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>;
}
