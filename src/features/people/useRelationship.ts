import { useCallback, useEffect, useRef, useState } from 'react';
import { apiErrorMessage, isAbort } from '@/shared/api/client';
import { friendshipApi } from './friendship-api';
import type { Relationship } from './friendship-types';

export function useRelationship(personId: string) {
  const [relationship, setRelationship] = useState<Relationship | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true;
    let inFlight = false;
    let dirty = false;
    let generation = 0;
    let timer = 0;
    let controller: AbortController | null = null;
    const load = async () => {
      if (!active || inFlight) return;
      window.clearTimeout(timer);
      inFlight = true;
      dirty = false;
      setLoading(true);
      setError('');
      const current = generation;
      controller = new AbortController();
      try {
        const result = await friendshipApi.relationship(personId, controller.signal);
        if (active && current === generation) setRelationship(result);
      } catch (caught) {
        if (active && current === generation && !isAbort(caught)) {
          setRelationship(null);
          setError(apiErrorMessage(caught));
        }
      } finally {
        inFlight = false;
        if (active) {
          if (dirty) void load();
          else {
            setLoading(false);
            timer = window.setTimeout(poll, 30000);
          }
        }
      }
    };
    const poll = () => {
      if (!active) return;
      if (document.hidden) timer = window.setTimeout(poll, 30000);
      else void load();
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
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('gongming:friendships-changed', invalidate);
    void load();
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller?.abort();
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('gongming:friendships-changed', invalidate);
      refreshRef.current = () => {};
    };
  }, [personId]);
  const refresh = useCallback(() => refreshRef.current(), []);
  return { relationship, loading, error, refresh };
}
