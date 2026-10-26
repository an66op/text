import { useCallback, useEffect, useRef, useState } from 'react';
import { apiErrorMessage, isAbort } from '@/shared/api/client';
import { platformApi } from '@/shared/api/platformApi';
import { tombstone } from './message-cache';
import type { Conversation, ReadMark } from '@/shared/api/types';

export function useConversationFeed(userId: string) {
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const floors = useRef(new Map<string, number>());
  const project = useCallback((item: Conversation, old?: Conversation) => {
    const floor = Math.max(
      floors.current.get(item.id) ?? 0,
      item.mutationVersion ?? 0,
      (item.lastMessage?.revision ?? 1) - 1,
    );
    floors.current.set(item.id, floor);
    const value = old && (old.mutationVersion ?? 0) > (item.mutationVersion ?? 0) ? old : item;
    return {
      ...value,
      mutationVersion: floor,
      lastMessage:
        value.lastMessage && terminal.current.has(value.lastMessage.id)
          ? tombstone(value.lastMessage)
          : value.lastMessage && (value.lastMessage.revision ?? 1) < floor + 1
            ? undefined
            : value.lastMessage,
    };
  }, []);
  const terminal = useRef(new Set<string>());
  const retract = useCallback((conversationId: string, messageId: string) => {
    terminal.current.add(messageId);
    setItems((items) =>
      items.map((item) =>
        item.id === conversationId && item.lastMessage?.id === messageId
          ? { ...item, lastMessage: tombstone(item.lastMessage) }
          : item,
      ),
    );
  }, []);
  const refreshRef = useRef<(strict?: boolean) => void>(() => {});
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
          setItems((previous) =>
            result.items.map((item) => {
              const old = previous.find((value) => value.id === item.id);
              return project(item, old);
            }),
          );
          setError('');
        }
      } catch (caught) {
        if (active && current === generation && !isAbort(caught)) setError(apiErrorMessage(caught));
      } finally {
        inFlight = false;
        if (active) {
          if (current === generation) setLoading(false);
          if (dirty) void load();
          else timeout = window.setTimeout(() => void load(), 5000);
        }
      }
    };
    const invalidate = (strict = true) => {
      // Message/read notifications may outpace the network. Their current snapshot
      // is still useful; only metadata/permission changes invalidate its generation.
      if (strict) generation += 1;
      dirty = true;
      void load();
    };
    const changed = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          conversationId?: string;
          retractedId?: string;
          mutationVersion?: number;
        }>
      ).detail;
      if (detail?.conversationId && detail.mutationVersion !== undefined) {
        floors.current.set(
          detail.conversationId,
          Math.max(floors.current.get(detail.conversationId) ?? 0, detail.mutationVersion),
        );
        setItems((items) => items.map((item) => project(item)));
      }
      if (detail?.conversationId && detail.retractedId)
        retract(detail.conversationId, detail.retractedId);
      invalidate(false);
    };
    const visible = () => {
      if (!document.hidden) invalidate();
    };
    refreshRef.current = invalidate;
    window.addEventListener('gongming:conversations-changed', changed);
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    void load();
    return () => {
      active = false;
      controller?.abort();
      window.clearTimeout(timeout);
      window.removeEventListener('gongming:conversations-changed', changed);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
      refreshRef.current = () => {};
    };
  }, [userId, retract, project]);
  const refresh = useCallback((strict = true) => refreshRef.current(strict), []);
  const upsert = useCallback(
    (conversation: Conversation) =>
      setItems((previous) => [
        project(
          conversation,
          previous.find((item) => item.id === conversation.id),
        ),
        ...previous.filter((item) => item.id !== conversation.id),
      ]),
    [project],
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
  return { items, loading, error, refresh, upsert, read, retract };
}
