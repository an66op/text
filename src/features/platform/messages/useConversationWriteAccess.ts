import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { accountEpoch } from '@/shared/api/account-guard';
import { ApiError, apiErrorMessage, isAbort } from '@/shared/api/client';
import type { Conversation } from '@/shared/api/types';
import { conversationApi } from '../conversations/conversation-api';
import type { StreamEvent } from './usePlatformStream';

export function useConversationWriteAccess(
  userId: string,
  conversation: Conversation,
  event: StreamEvent | undefined,
  onDenied: (message: string) => void,
) {
  const [allowed, setAllowed] = useState(conversation.canSend === true),
    [error, setError] = useState('');
  const [restrictionEpoch, setRestrictionEpoch] = useState(0);
  const generation = useRef(0),
    refreshRef = useRef<() => void>(() => {}),
    denied = useRef(onDenied);
  denied.current = onDenied;
  const restrict = useCallback((message = '当前联系权限不允许此操作') => {
    generation.current++;
    setRestrictionEpoch((value) => value + 1);
    setAllowed(false);
    setError(message);
    refreshRef.current();
  }, []);
  useLayoutEffect(() => {
    if (conversation.canSend === false) restrict();
  }, [conversation.canSend, restrict]);
  useEffect(() => {
    let active = true,
      dirty = false,
      timer = 0,
      request: AbortController | null = null;
    const account = accountEpoch();
    const valid = () => active && account === accountEpoch();
    const load = async () => {
      if (!valid() || request) return;
      window.clearTimeout(timer);
      dirty = false;
      const controller = new AbortController(),
        epoch = generation.current;
      request = controller;
      try {
        const result = await conversationApi.details(conversation.id, controller.signal);
        if (!valid() || controller.signal.aborted || epoch !== generation.current) return;
        if (
          result.conversation.id !== conversation.id ||
          typeof result.conversation.canSend !== 'boolean'
        )
          throw new ApiError('无法确认当前发送权限，请刷新重试', 'INVALID_RESPONSE', 200);
        setAllowed(result.conversation.canSend);
        setError(result.conversation.canSend ? '' : '当前联系权限不允许此操作');
      } catch (caught) {
        if (
          valid() &&
          !controller.signal.aborted &&
          epoch === generation.current &&
          !isAbort(caught)
        ) {
          setError(apiErrorMessage(caught));
          if (caught instanceof ApiError && [403, 404].includes(caught.status))
            denied.current(apiErrorMessage(caught));
        }
      } finally {
        if (request === controller) request = null;
        if (valid()) {
          if (dirty) void load();
          else
            timer = window.setTimeout(() => {
              if (!document.hidden) void load();
              else timer = window.setTimeout(refresh, 10000);
            }, 10000);
        }
      }
    };
    const refresh = () => {
      generation.current++;
      dirty = true;
      void load();
    };
    const visible = () => {
      if (!document.hidden) refresh();
    };
    refreshRef.current = refresh;
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('gongming:privacy-changed', refresh);
    void load();
    const invalidate = () => {
      generation.current++;
    };
    return () => {
      active = false;
      invalidate();
      request?.abort();
      window.clearTimeout(timer);
      refreshRef.current = () => {};
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('gongming:privacy-changed', refresh);
    };
  }, [userId, conversation.id]);
  useEffect(() => {
    if (
      event &&
      ['resync', 'conversation.updated', 'membership.revoked'].includes(event.type) &&
      (!event.conversationId || event.conversationId === conversation.id)
    )
      refreshRef.current();
  }, [event, conversation.id]);
  return {
    allowed,
    error,
    restrictionEpoch,
    restrict,
    refresh: useCallback(() => refreshRef.current(), []),
  };
}
