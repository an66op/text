import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiErrorMessage, isAbort } from '@/shared/api/client';
import type { Conversation } from '@/shared/api/types';
import { conversationApi, type ConversationDetails } from './conversation-api';

export function useConversationDetails(userId: string, conversationId: string) {
  const [data, setData] = useState<ConversationDetails | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const generation = useRef(0);
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true;
    let inFlight = false;
    let dirty = false;
    let timer = 0;
    let controller: AbortController | null = null;
    const load = async () => {
      if (!active || inFlight) return;
      window.clearTimeout(timer);
      inFlight = true;
      dirty = false;
      const current = generation.current;
      controller = new AbortController();
      try {
        const next = await conversationApi.details(conversationId, controller.signal);
        if (active && generation.current === current) {
          setData(next);
          setError('');
          setDenied(false);
        }
      } catch (caught) {
        if (active && generation.current === current && !isAbort(caught)) {
          const lostAccess = caught instanceof ApiError && [403, 404].includes(caught.status);
          setDenied(lostAccess);
          if (lostAccess) setData(null);
          setError(apiErrorMessage(caught));
        }
      } finally {
        inFlight = false;
        if (active) {
          if (dirty) void load();
          else {
            setLoading(false);
            timer = window.setTimeout(() => {
              if (document.hidden) {
                timer = window.setTimeout(invalidate, 10000);
                return;
              }
              void load();
            }, 15000);
          }
        }
      }
    };
    const invalidate = () => {
      generation.current += 1;
      dirty = true;
      void load();
    };
    const visible = () => {
      if (!document.hidden) invalidate();
    };
    refreshRef.current = invalidate;
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    void load();
    return () => {
      active = false;
      generation.current += 1;
      controller?.abort();
      window.clearTimeout(timer);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
      refreshRef.current = () => {};
    };
  }, [conversationId, userId]);
  const refresh = useCallback(() => refreshRef.current(), []);
  const accept = useCallback((conversation: Conversation) => {
    generation.current += 1;
    setData((previous) =>
      previous
        ? {
            conversation,
            memberProfiles: previous.memberProfiles.filter((person) =>
              conversation.members.includes(person.id),
            ),
          }
        : previous,
    );
  }, []);
  return { data, error, loading, denied, refresh, accept };
}
