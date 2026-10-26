import { useCallback, useEffect, useRef, useState } from 'react';
import { apiErrorMessage } from '@/shared/api/client';
import {
  emptyMessageDraft,
  messageDraftKey,
  readMessageDraft,
  saveMessageDraft,
  type MessageDraft,
  type PendingMessage,
} from './message-drafts';

export function useMessageDraft(userId: string, conversationId: string) {
  const key = messageDraftKey(userId, conversationId);
  const [error, setError] = useState('');
  const [state, setState] = useState<MessageDraft>(() => {
    try {
      return readMessageDraft(key);
    } catch {
      return emptyMessageDraft();
    }
  });
  const latest = useRef(state);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const load = () => {
      try {
        const next = readMessageDraft(key);
        latest.current = next;
        setState(next);
        setError('');
      } catch (caught) {
        setError(apiErrorMessage(caught));
      }
    };
    const sync = (event: StorageEvent) => {
      if (event.key === key || event.key === null) load();
    };
    load();
    window.addEventListener('storage', sync);
    return () => {
      active.current = false;
      window.removeEventListener('storage', sync);
    };
  }, [key]);
  const mutate = useCallback(
    (update: (value: MessageDraft) => MessageDraft, preserveInMemory = false) => {
      if (!active.current) return false;
      try {
        // Validate current disk data first, preserving an incompatible draft rather than overwriting it.
        const disk = readMessageDraft(key);
        const next = update({ ...latest.current, pending: disk.pending });
        saveMessageDraft(key, next);
        latest.current = next;
        setState(next);
        setError('');
        return true;
      } catch (caught) {
        if (preserveInMemory) {
          const next = update(latest.current);
          latest.current = next;
          setState(next);
        }
        setError(`本机保存失败：${apiErrorMessage(caught)}。请检查存储空间，当前内容已保留。`);
        return false;
      }
    },
    [key],
  );
  const setDraft = useCallback(
    (draft: string) => mutate((previous) => ({ ...previous, draft }), true),
    [mutate],
  );
  const stage = useCallback(
    (body: string): PendingMessage | null => {
      if (latest.current.pending.length >= 20) {
        setError('请先处理已有的 20 条待发消息');
        return null;
      }
      const pending: PendingMessage = {
        clientId: crypto.randomUUID(),
        body: body.trim(),
        createdAt: new Date().toISOString(),
        error: '',
      };
      return mutate((previous) => ({
        ...previous,
        draft: '',
        pending: [...previous.pending, pending],
      }))
        ? pending
        : null;
    },
    [mutate],
  );
  const remove = useCallback(
    (ids: string[]) =>
      mutate((previous) => ({
        ...previous,
        pending: previous.pending.filter((entry) => !ids.includes(entry.clientId)),
      })),
    [mutate],
  );
  const fail = useCallback(
    (clientId: string, message: string) =>
      mutate((previous) => ({
        ...previous,
        pending: previous.pending.map((entry) =>
          entry.clientId === clientId ? { ...entry, error: message.slice(0, 2000) } : entry,
        ),
      })),
    [mutate],
  );
  return { state, error, setDraft, stage, remove, fail };
}
