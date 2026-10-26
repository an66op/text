import { useEffect, useRef, useState } from 'react';
import { friendshipApi } from './friendship-api';

export function useFriendshipCounts(userId: string) {
  const [incoming, setIncoming] = useState<number | null>(null);
  const [outgoing, setOutgoing] = useState<number | null>(null);
  const refresh = useRef<() => void>(() => {});
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
      if (document.hidden) {
        timer = window.setTimeout(() => void load(), 30000);
        return;
      }
      controller = new AbortController();
      inFlight = true;
      dirty = false;
      const current = generation;
      const result = await Promise.allSettled([
        friendshipApi.requests('incoming', 0, controller.signal, 1),
        friendshipApi.requests('outgoing', 0, controller.signal, 1),
      ]);
      if (active && current === generation) {
        setIncoming(result[0].status === 'fulfilled' ? result[0].value.total : null);
        setOutgoing(result[1].status === 'fulfilled' ? result[1].value.total : null);
      }
      inFlight = false;
      if (active) {
        if (dirty) void load();
        else timer = window.setTimeout(() => void load(), 30000);
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
    refresh.current = invalidate;
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('gongming:friendships-changed', invalidate);
    void load();
    return () => {
      active = false;
      controller?.abort();
      window.clearTimeout(timer);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('gongming:friendships-changed', invalidate);
      refresh.current = () => {};
    };
  }, [userId]);
  return { incoming, outgoing };
}
