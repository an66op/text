import { useCallback, useEffect, useRef, useState } from 'react';
import { apiErrorMessage, isAbort } from '@/shared/api/client';
import { platformApi } from '@/shared/api/platformApi';
import type { Conversation, ReadMark } from '@/shared/api/types';

export function useConversationFeed(userId: string) {
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true;
    let inFlight = false;
    let dirty = false;
    let generation = 0;
    let timeout = 0;
    let controller: AbortController | null = null;
    const load = async () => {
      if (!active || inFlight) return;
      window.clearTimeout(timeout);
      if (document.hidden) {
        timeout = window.setTimeout(() => void load(), 5000);
        return;
      }
      inFlight = true;
      dirty = false;
      const current = generation;
      controller = new AbortController();
      try {
        const result = await platformApi.conversations(controller.signal);
        if (active && current === generation) {
          setItems(result.items);
          setError('');
        }
      } catch (caught) {
        if (active && current === generation && !isAbort(caught)) setError(apiErrorMessage(caught));
      } finally {
        inFlight = false;
        if (active) {
          if (dirty) void load();
          else {
            setLoading(false);
            timeout = window.setTimeout(() => void load(), 5000);
          }
        }
      }
    };
    const invalidate = () => {
      generation += 1;
      dirty = true;
      void load();
    };
    const visible = () => {
      if (!document.hidden) invalidate();
    };
    refreshRef.current = invalidate;
    window.addEventListener('gongming:conversations-changed', invalidate);
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    void load();
    return () => {
      active = false;
      controller?.abort();
      window.clearTimeout(timeout);
      window.removeEventListener('gongming:conversations-changed', invalidate);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
      refreshRef.current = () => {};
    };
  }, [userId]);
  const refresh = useCallback(() => refreshRef.current(), []);
  const upsert = useCallback(
    (conversation: Conversation) =>
      setItems((previous) => [
        conversation,
        ...previous.filter((item) => item.id !== conversation.id),
      ]),
    [],
  );
  const read = useCallback(
    (mark: ReadMark) =>
      setItems((previous) =>
        previous.map((item) =>
          item.id === mark.conversationId && (item.readSeq ?? 0) <= mark.readSeq
            ? {
                ...item,
                readSeq: mark.readSeq,
                lastReadMessageId: mark.lastReadMessageId,
                unreadCount: mark.unreadCount,
              }
            : item,
        ),
      ),
    [],
  );
  return { items, loading, error, refresh, upsert, read };
}
