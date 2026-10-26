import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiErrorMessage, isAbort } from '@/shared/api/client';
import { platformApi } from '@/shared/api/platformApi';
import type { PlatformMessage } from '@/shared/api/types';
import { MessageCache, type CachedMessage } from './message-cache';
import type { StreamEvent } from './usePlatformStream';

export function useThreadMessages(
  userId: string,
  conversationId: string,
  updateVersion: number,
  mutationVersion = 0,
  event?: StreamEvent,
) {
  const [messages, setMessages] = useState<CachedMessage[]>([]),
    [loading, setLoading] = useState(true),
    [historyLoading, setHistoryLoading] = useState(false),
    [hasMore, setHasMore] = useState(false),
    [error, setError] = useState(''),
    [resolveError, setResolveError] = useState(''),
    [reconciling, setReconciling] = useState(false),
    [accessDenied, setDenied] = useState(false);
  const cache = useRef(new MessageCache()),
    permission = useRef({ epoch: 0, active: false, allowed: false });
  const projection = useRef(0),
    writeEpoch = useRef(0),
    authorizationStart = useRef(0);
  const refreshRef = useRef<(force?: boolean) => void>(() => {}),
    historyRef = useRef<() => Promise<void>>(async () => {}),
    resolveRef = useRef<() => void>(() => {}),
    denyRef = useRef<(message: string) => void>(() => {});
  const publish = useCallback(() => setMessages(cache.current.snapshot()), []);
  const capturePermission = useCallback(
    () => (permission.current.active && permission.current.allowed ? writeEpoch.current : null),
    [],
  );
  const apply = useCallback(
    (incoming: PlatformMessage[], epoch: number | null) => {
      if (
        epoch === null ||
        !permission.current.active ||
        !permission.current.allowed ||
        epoch < authorizationStart.current
      )
        return false;
      if (epoch !== writeEpoch.current) {
        cache.current.hold(incoming);
        publish();
        resolveRef.current();
        return false;
      }
      cache.current.accept(incoming);
      publish();
      resolveRef.current();
      return true;
    },
    [publish],
  );
  const retract = useCallback(
    (id: string) => {
      if (!permission.current.active) return;
      cache.current.retract(id);
      publish();
      resolveRef.current();
    },
    [publish],
  );
  const observeVersion = useCallback(
    (version: number) => {
      if (!permission.current.active || !permission.current.allowed) return;
      cache.current.observe(version);
      publish();
      resolveRef.current();
    },
    [publish],
  );
  useEffect(() => {
    permission.current = { epoch: permission.current.epoch + 1, active: true, allowed: true };
    authorizationStart.current = ++writeEpoch.current;
    projection.current++;
    cache.current = new MessageCache();
    publish();
    setLoading(true);
    setHistoryLoading(false);
    setHasMore(false);
    setDenied(false);
    setError('');
    setResolveError('');
    setReconciling(false);
    const historyPending = new Set<string>();
    let active = true,
      dirty = false,
      first = true,
      watermark = 0,
      timer = 0,
      resolveTimer = 0,
      denied = false,
      recovering = false;
    let latest: AbortController | null = null,
      history: AbortController | null = null,
      resolver: AbortController | null = null;
    let resolvingIds: string[] = [];
    const finishHistory = () => {
      for (const id of historyPending)
        if (!cache.current.pending.has(id)) historyPending.delete(id);
      if (!history && historyPending.size === 0) setHistoryLoading(false);
    };
    const current = (request: AbortController, epoch: number) =>
      active && !request.signal.aborted && permission.current.epoch === epoch;
    const revoke = (message: string) => {
      denied = true;
      recovering = false;
      dirty = false;
      historyPending.clear();
      setResolveError('');
      permission.current = { epoch: permission.current.epoch + 1, active: true, allowed: false };
      authorizationStart.current = ++writeEpoch.current;
      projection.current++;
      setReconciling(false);
      latest?.abort();
      history?.abort();
      resolver?.abort();
      latest = history = resolver = null;
      window.clearTimeout(timer);
      window.clearTimeout(resolveTimer);
      first = true;
      watermark = 0;
      cache.current = new MessageCache();
      publish();
      setHasMore(false);
      setLoading(false);
      setHistoryLoading(false);
      setDenied(true);
      setError(message);
    };
    const fail = (caught: unknown) => {
      if (!active || isAbort(caught)) return;
      if (caught instanceof ApiError && [403, 404].includes(caught.status))
        revoke(apiErrorMessage(caught));
      else setError(apiErrorMessage(caught));
    };
    const resolve = async () => {
      if (!active || denied || resolver || !cache.current.pending.size) return;
      const request = new AbortController(),
        epoch = permission.current.epoch,
        generation = projection.current;
      resolver = request;
      setReconciling(true);
      try {
        let batches = 0;
        while (current(request, epoch) && !denied && cache.current.pending.size && batches++ < 10) {
          const ids = [...cache.current.pending].slice(0, 200);
          resolvingIds = ids;
          for (const id of ids) cache.current.pending.delete(id);
          try {
            const result = await platformApi.resolveMessages(conversationId, ids, request.signal);
            if (!current(request, epoch) || denied) return;
            cache.current.observe(result.mutationVersion);
            if (generation !== projection.current) {
              cache.current.hold(result.items);
              for (const id of ids) cache.current.pending.add(id);
              break;
            }
            cache.current.accept(result.items, undefined, true);
            if (result.mutationVersion < cache.current.floor) {
              for (const id of ids) cache.current.pending.add(id);
            } else cache.current.remove(result.missingIds);
            publish();
            finishHistory();
            setResolveError('');
          } catch (caught) {
            for (const id of ids) cache.current.pending.add(id);
            throw caught;
          }
        }
      } catch (caught) {
        if (current(request, epoch)) {
          if (caught instanceof ApiError && [403, 404].includes(caught.status)) fail(caught);
          else setResolveError(apiErrorMessage(caught));
        }
      } finally {
        if (resolver === request) {
          resolver = null;
          resolvingIds = [];
          if (active && !cache.current.pending.size) setReconciling(false);
          if (active && !denied && cache.current.pending.size)
            resolveTimer = window.setTimeout(() => void resolve(), 1500);
        }
      }
    };
    const accept = (items: PlatformMessage[], version = 0, generation = projection.current) => {
      cache.current.observe(version);
      if (generation !== projection.current) cache.current.hold(items);
      else cache.current.accept(items, version, true);
      publish();
      void resolve();
    };
    const load = async () => {
      if (!active || latest || (denied && !recovering)) return;
      window.clearTimeout(timer);
      if (document.hidden) {
        timer = window.setTimeout(() => void load(), 3500);
        return;
      }
      dirty = false;
      const request = new AbortController(),
        epoch = permission.current.epoch,
        generation = projection.current;
      latest = request;
      try {
        let pages = 0,
          chasing = false;
        do {
          const result = await platformApi.messages(
            conversationId,
            request.signal,
            first ? {} : { afterSeq: watermark },
          );
          if (!current(request, epoch) || latest !== request) return;
          if (denied) {
            denied = false;
            recovering = false;
            permission.current.allowed = true;
            setDenied(false);
          }
          if (first) setHasMore(result.hasMore ?? result.total > result.items.length);
          accept(result.items, result.mutationVersion, generation);
          const next = Math.max(watermark, ...result.items.map((m) => m.seq ?? 0));
          chasing = !first && !!result.hasMore && next > watermark;
          watermark = next;
          first = false;
          if (++pages >= 20 && chasing) {
            dirty = true;
            break;
          }
        } while (chasing);
        if (current(request, epoch)) setError('');
      } catch (caught) {
        if (current(request, epoch)) fail(caught);
      } finally {
        if (latest === request) {
          latest = null;
          if (active) {
            setLoading(false);
            if (dirty && (!denied || recovering)) void load();
            else if (!denied) timer = window.setTimeout(() => void load(), 3500);
          }
        }
      }
    };
    const refresh = (force = false) => {
      if (!active) return;
      if (denied && !recovering) {
        recovering = true;
        permission.current = { epoch: permission.current.epoch + 1, active: true, allowed: false };
        authorizationStart.current = ++writeEpoch.current;
        first = true;
        watermark = 0;
      }
      if (force && !denied) {
        projection.current++;
        writeEpoch.current++;
        cache.current.freeze();
        publish();
        for (const id of resolvingIds) cache.current.pending.add(id);
        resolver?.abort();
        resolver = null;
        resolvingIds = [];
        void resolve();
      }
      dirty = true;
      void load();
    };
    historyRef.current = async () => {
      if (
        !active ||
        history ||
        first ||
        denied ||
        !permission.current.allowed ||
        !cache.current.records.size
      )
        return;
      const oldest = cache.current.snapshot()[0],
        request = new AbortController(),
        epoch = permission.current.epoch,
        generation = projection.current;
      history = request;
      setHistoryLoading(true);
      try {
        const result = await platformApi.messages(
          conversationId,
          request.signal,
          oldest.seq ? { beforeSeq: oldest.seq } : { beforeId: oldest.id },
        );
        if (!current(request, epoch) || history !== request || denied) return;
        accept(result.items, result.mutationVersion, generation);
        for (const message of result.items)
          if (cache.current.pending.has(message.id)) historyPending.add(message.id);
        setHasMore(result.hasMore ?? result.items.length === 50);
        setError('');
      } catch (caught) {
        if (current(request, epoch) && history === request) fail(caught);
      } finally {
        if (history === request) {
          history = null;
          if (active) finishHistory();
        }
      }
    };
    const visible = () => {
      if (!document.hidden) refresh(true);
    };
    refreshRef.current = refresh;
    resolveRef.current = () => void resolve();
    denyRef.current = revoke;
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible);
    void load();
    const invalidateWrites = () => {
      authorizationStart.current = ++writeEpoch.current;
      projection.current++;
    };
    return () => {
      active = false;
      permission.current = { epoch: permission.current.epoch + 1, active: false, allowed: false };
      invalidateWrites();
      latest?.abort();
      history?.abort();
      resolver?.abort();
      window.clearTimeout(timer);
      window.clearTimeout(resolveTimer);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', visible);
      refreshRef.current = () => {};
      resolveRef.current = () => {};
      historyRef.current = async () => {};
      denyRef.current = () => {};
    };
  }, [userId, conversationId, publish]);
  useEffect(() => {
    cache.current.observe(mutationVersion);
    publish();
    resolveRef.current();
  }, [mutationVersion, publish]);
  useEffect(() => {
    if (updateVersion > 0) {
      if (
        event?.conversationId === conversationId &&
        event.type === 'message.retracted' &&
        event.messageId
      )
        retract(event.messageId);
      refreshRef.current(event?.type !== 'message.created');
    }
  }, [updateVersion, event, conversationId, retract]);
  return {
    messages,
    observeVersion,
    loading,
    historyLoading,
    reconciling,
    hasMore,
    error: error || resolveError,
    accessDenied,
    refresh: useCallback(() => refreshRef.current(true), []),
    loadOlder: useCallback(() => historyRef.current(), []),
    capturePermission,
    apply,
    retract,
    deny: useCallback((message: string) => denyRef.current(message), []),
    quote: (id: string) => cache.current.quote(cache.current.sources.get(id)),
    missing: (id: string) => cache.current.missing.has(id),
    floor: cache.current.floor,
    permissionEpoch: permission.current.epoch,
    projectionGeneration: projection.current,
  };
}
