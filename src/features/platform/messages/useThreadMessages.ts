import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiErrorMessage, isAbort } from '@/shared/api/client';
import { platformApi } from '@/shared/api/platformApi';
import type { MessagePage, PlatformMessage } from '@/shared/api/types';
import { mergeMessages } from './message-drafts';

export function useThreadMessages(userId: string, conversationId: string, updateVersion: number) {
  const [messages, setMessages] = useState<PlatformMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);
  const state = useRef<PlatformMessage[]>([]);
  const refreshRef = useRef<() => void>(() => {});
  const historyRef = useRef<() => Promise<void>>(async () => {});
  const apply = useCallback((incoming: PlatformMessage[]) => {
    state.current = mergeMessages(state.current, incoming);
    setMessages(state.current);
  }, []);
  useEffect(() => {
    state.current = [];
    setMessages([]);
    setLoading(true);
    setHasMore(false);
    setAccessDenied(false);
    setError('');
    let active = true;
    let inFlight = false;
    let dirty = false;
    let first = true;
    let watermark = 0;
    let timeout = 0;
    let controller: AbortController | null = null;
    let historyController: AbortController | null = null;
    let historyInFlight = false;
    let denied = false;
    const handleError = (caught: unknown) => {
      if (!active || isAbort(caught)) return;
      setError(apiErrorMessage(caught));
      if (caught instanceof ApiError && [403, 404].includes(caught.status)) {
        denied = true;
        setAccessDenied(true);
        state.current = [];
        setMessages([]);
      }
    };
    const load = async () => {
      if (!active || inFlight || denied) return;
      window.clearTimeout(timeout);
      if (document.hidden) {
        timeout = window.setTimeout(() => void load(), 3500);
        return;
      }
      inFlight = true;
      dirty = false;
      controller = new AbortController();
      try {
        let pages = 0;
        let chasing = false;
        do {
          const result: MessagePage = await platformApi.messages(
            conversationId,
            controller.signal,
            first ? {} : { afterSeq: watermark },
          );
          if (!active || controller.signal.aborted) return;
          if (first) setHasMore(result.hasMore ?? result.total > result.items.length);
          apply(result.items);
          const next = Math.max(watermark, ...result.items.map((message) => message.seq ?? 0));
          chasing = !first && !!result.hasMore && next > watermark;
          watermark = next;
          first = false;
          pages += 1;
          if (pages >= 20 && chasing) {
            dirty = true;
            break;
          }
        } while (chasing);
        setError('');
      } catch (caught) {
        handleError(caught);
      } finally {
        inFlight = false;
        if (active) {
          setLoading(false);
          if (dirty && !denied) void load();
          else if (!denied) timeout = window.setTimeout(() => void load(), 3500);
        }
      }
    };
    const refresh = () => {
      denied = false;
      setAccessDenied(false);
      dirty = true;
      void load();
    };
    historyRef.current = async () => {
      if (!active || historyInFlight || first || denied || !state.current.length) return;
      const oldest = state.current[0];
      historyInFlight = true;
      setHistoryLoading(true);
      historyController = new AbortController();
      try {
        const result = await platformApi.messages(
          conversationId,
          historyController.signal,
          oldest.seq ? { beforeSeq: oldest.seq } : { beforeId: oldest.id },
        );
        if (!active || historyController.signal.aborted) return;
        apply(result.items);
        setHasMore(result.hasMore ?? result.items.length === 50);
        setError('');
      } catch (caught) {
        handleError(caught);
      } finally {
        historyInFlight = false;
        if (active) setHistoryLoading(false);
      }
    };
    const visible = () => {
      if (!document.hidden) refresh();
    };
    refreshRef.current = refresh;
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible);
    void load();
    return () => {
      active = false;
      controller?.abort();
      historyController?.abort();
      window.clearTimeout(timeout);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', visible);
      refreshRef.current = () => {};
      historyRef.current = async () => {};
    };
  }, [userId, conversationId, apply]);
  useEffect(() => {
    if (updateVersion > 0) refreshRef.current();
  }, [updateVersion]);
  const refresh = useCallback(() => refreshRef.current(), []);
  const loadOlder = useCallback(() => historyRef.current(), []);
  return {
    messages,
    loading,
    historyLoading,
    hasMore,
    error,
    accessDenied,
    refresh,
    loadOlder,
    apply,
  };
}
