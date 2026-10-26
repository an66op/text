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
  const permission = useRef({ epoch: 0, active: false, allowed: false });
  const state = useRef<PlatformMessage[]>([]);
  const refreshRef = useRef<() => void>(() => {});
  const historyRef = useRef<() => Promise<void>>(async () => {});
  const append = useCallback((incoming: PlatformMessage[]) => {
    state.current = mergeMessages(state.current, incoming);
    setMessages(state.current);
  }, []);
  // Capture at dispatch, rather than render: a request can start immediately after
  // mount, before the first server read has triggered another render.
  const capturePermission = useCallback(
    () =>
      permission.current.active && permission.current.allowed ? permission.current.epoch : null,
    [],
  );
  // A later successful reauthorization cannot make an old acknowledgement current.
  const apply = useCallback(
    (incoming: PlatformMessage[], epoch: number | null) => {
      if (
        epoch === null ||
        !permission.current.active ||
        !permission.current.allowed ||
        permission.current.epoch !== epoch
      )
        return false;
      append(incoming);
      return true;
    },
    [append],
  );
  useEffect(() => {
    permission.current = { epoch: permission.current.epoch + 1, active: true, allowed: true };
    state.current = [];
    setMessages([]);
    setLoading(true);
    setHistoryLoading(false);
    setHasMore(false);
    setAccessDenied(false);
    setError('');
    let active = true;
    let dirty = false;
    let first = true;
    let watermark = 0;
    let timeout = 0;
    let latestController: AbortController | null = null;
    let historyController: AbortController | null = null;
    let denied = false;
    let recovering = false;
    const revoke = (message: string) => {
      denied = true;
      recovering = false;
      dirty = false;
      permission.current = { epoch: permission.current.epoch + 1, active: true, allowed: false };
      latestController?.abort();
      historyController?.abort();
      latestController = null;
      historyController = null;
      window.clearTimeout(timeout);
      first = true;
      watermark = 0;
      state.current = [];
      setMessages([]);
      setHasMore(false);
      setLoading(false);
      setHistoryLoading(false);
      setAccessDenied(true);
      setError(message);
    };
    const handleError = (caught: unknown) => {
      if (!active || isAbort(caught)) return;
      if (caught instanceof ApiError && [403, 404].includes(caught.status))
        revoke(apiErrorMessage(caught));
      else setError(apiErrorMessage(caught));
    };
    const load = async () => {
      if (!active || latestController || (denied && !recovering)) return;
      window.clearTimeout(timeout);
      if (document.hidden) {
        timeout = window.setTimeout(() => void load(), 3500);
        return;
      }
      dirty = false;
      const controller = new AbortController();
      latestController = controller;
      const epoch = permission.current.epoch;
      const current = () =>
        active &&
        !controller.signal.aborted &&
        latestController === controller &&
        permission.current.epoch === epoch;
      try {
        let pages = 0;
        let chasing = false;
        do {
          const result: MessagePage = await platformApi.messages(
            conversationId,
            controller.signal,
            first ? {} : { afterSeq: watermark },
          );
          if (!current()) return;
          // Revocation stays visible until this new-generation server read confirms
          // membership. Cached history and send responses cannot grant access.
          if (denied) {
            denied = false;
            recovering = false;
            permission.current.allowed = true;
            setAccessDenied(false);
          }
          if (first) setHasMore(result.hasMore ?? result.total > result.items.length);
          append(result.items);
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
        if (current()) setError('');
      } catch (caught) {
        if (current()) handleError(caught);
      } finally {
        if (latestController === controller) {
          latestController = null;
          if (active) {
            setLoading(false);
            if (dirty && (!denied || recovering)) void load();
            else if (!denied) timeout = window.setTimeout(() => void load(), 3500);
          }
        }
      }
    };
    const refresh = () => {
      if (!active) return;
      if (denied && !recovering) {
        recovering = true;
        permission.current = { epoch: permission.current.epoch + 1, active: true, allowed: false };
        first = true;
        watermark = 0;
      }
      dirty = true;
      void load();
    };
    historyRef.current = async () => {
      if (
        !active ||
        historyController ||
        first ||
        denied ||
        !permission.current.allowed ||
        !state.current.length
      )
        return;
      const oldest = state.current[0];
      const controller = new AbortController();
      historyController = controller;
      const epoch = permission.current.epoch;
      const current = () =>
        active &&
        !controller.signal.aborted &&
        historyController === controller &&
        permission.current.epoch === epoch &&
        !denied &&
        permission.current.allowed;
      setHistoryLoading(true);
      try {
        const result = await platformApi.messages(
          conversationId,
          controller.signal,
          oldest.seq ? { beforeSeq: oldest.seq } : { beforeId: oldest.id },
        );
        if (!current()) return;
        append(result.items);
        setHasMore(result.hasMore ?? result.items.length === 50);
        setError('');
      } catch (caught) {
        if (current()) handleError(caught);
      } finally {
        if (historyController === controller) {
          historyController = null;
          if (active) setHistoryLoading(false);
        }
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
      permission.current = { epoch: permission.current.epoch + 1, active: false, allowed: false };
      latestController?.abort();
      historyController?.abort();
      window.clearTimeout(timeout);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', visible);
      refreshRef.current = () => {};
      historyRef.current = async () => {};
    };
  }, [userId, conversationId, append]);
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
    capturePermission,
    apply,
  };
}
