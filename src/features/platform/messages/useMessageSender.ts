import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiErrorMessage } from '@/shared/api/client';
import { accountEpoch } from '@/shared/api/account-guard';
import { platformApi } from '@/shared/api/platformApi';
import type { PlatformMessage } from '@/shared/api/types';
import { messagesChanged, type PendingMessage } from './message-drafts';
import type { useMessageDraft } from './useMessageDraft';
import type { useThreadMessages } from './useThreadMessages';
import type { UploadedImage } from '../media/media-model';
import { uncertainWrite } from './useConversationUploads';
export type RichPending = PendingMessage & {
  imageIds?: string[];
  replyToId?: string;
  images?: UploadedImage[];
  rich?: boolean;
  projection?: number;
};
export function useMessageSender(
  userId: string,
  conversationId: string,
  thread: ReturnType<typeof useThreadMessages>,
  draft: ReturnType<typeof useMessageDraft>,
  canSend: boolean,
  onSent: (message: PlatformMessage) => void,
  gate: { current: boolean },
) {
  const [rich, setRich] = useState<RichPending[]>([]),
    [sendingId, setSendingId] = useState(''),
    [error, setError] = useState(''),
    [checks, setChecks] = useState<Record<string, 'unknown' | 'absent' | 'checking'>>({});
  const operation = useRef(0),
    inFlightPending = useRef<RichPending | null>(null);
  const active = useRef(true),
    lock = useRef(false),
    controller = useRef<AbortController | null>(null),
    epoch = useRef(accountEpoch()),
    allowed = useRef(canSend);
  allowed.current = canSend;
  useEffect(() => {
    active.current = true;
    epoch.current = accountEpoch();
    return () => {
      active.current = false;
      controller.current?.abort();
    };
  }, []);
  const valid = () => active.current && epoch.current === accountEpoch();
  const remove = (id: string) => {
    draft.remove([id]);
    setRich((items) => items.filter((item) => item.clientId !== id));
  };
  const accept = (message: PlatformMessage, pending: RichPending, permission: number | null) => {
    if (
      message.conversationId !== conversationId ||
      message.sender.id !== userId ||
      message.clientId !== pending.clientId
    )
      throw new ApiError('服务回执与当前消息不一致，请先查询发送结果', 'INVALID_RESPONSE', 502);
    if (!valid()) return;
    if (!thread.apply([message], permission))
      throw new ApiError('会话权限已更新，请重新确认发送结果', 'CONVERSATION_ACCESS_CHANGED', 409);
    setError('');
    remove(pending.clientId);
    onSent(message);
    messagesChanged();
  };
  const textPending = draft.state.pending,
    removeText = draft.remove;
  useEffect(() => {
    const ids = new Set(
      thread.messages
        .filter(
          (item) =>
            item.sender.id === userId && item.conversationId === conversationId && item.clientId,
        )
        .map((item) => item.clientId!),
    );
    if (ids.size) {
      const pending = textPending.filter((item) => ids.has(item.clientId));
      if (pending.length) removeText(pending.map((item) => item.clientId));
      setRich((items) =>
        items.some((item) => ids.has(item.clientId))
          ? items.filter((item) => !ids.has(item.clientId))
          : items,
      );
    }
  }, [thread.messages, userId, conversationId, textPending, removeText]);
  const execute = async (pending: RichPending, lookup = false) => {
    const permission = thread.capturePermission();
    if (
      lock.current ||
      gate.current ||
      (!lookup && !allowed.current) ||
      !valid() ||
      permission === null
    )
      return;
    const version = ++operation.current;
    lock.current = true;
    gate.current = true;
    inFlightPending.current = pending;
    setSendingId(pending.clientId);
    setError('');
    const request = new AbortController();
    controller.current = request;
    const confirm = (message: PlatformMessage) => {
      if (!request.signal.aborted && version === operation.current)
        accept(message, pending, permission);
    };
    const find = async () => {
      try {
        return await platformApi.messageByClient(conversationId, pending.clientId, request.signal);
      } catch (caught) {
        if (!(caught instanceof ApiError) || caught.status !== 404) throw caught;
        // A by-client 404 also conceals lost membership. Confirm read access
        // before offering a manual resend of the unchanged request.
        try {
          const page = await platformApi.messages(conversationId, request.signal, { limit: 1 });
          if (valid() && !request.signal.aborted) thread.observeVersion(page.mutationVersion ?? 0);
        } catch (access) {
          if (
            valid() &&
            !request.signal.aborted &&
            access instanceof ApiError &&
            [403, 404].includes(access.status)
          )
            thread.deny(apiErrorMessage(access));
          throw access;
        }
        return null;
      }
    };
    try {
      if (lookup) {
        setChecks((values) => ({ ...values, [pending.clientId]: 'checking' }));
        try {
          const message = await find();
          if (!valid() || request.signal.aborted) return;
          if (message) {
            confirm(message);
            return;
          }
          setChecks((values) => ({ ...values, [pending.clientId]: 'absent' }));
          setError('尚未查询到这条消息，核实后可使用同一请求重试');
          return;
        } catch (caught) {
          if (!valid() || request.signal.aborted) return;
          throw caught;
        }
      }
      const message = pending.rich
        ? await platformApi.sendMessage(
            conversationId,
            pending.body,
            pending.clientId,
            { imageIds: pending.imageIds, replyToId: pending.replyToId },
            request.signal,
          )
        : await platformApi.sendMessage(
            conversationId,
            pending.body,
            pending.clientId,
            undefined,
            request.signal,
          );
      confirm(message);
    } catch (caught) {
      if (valid() && !request.signal.aborted) {
        const text = apiErrorMessage(caught);
        if (pending.rich)
          setRich((items) =>
            items.map((item) =>
              item.clientId === pending.clientId ? { ...item, error: text } : item,
            ),
          );
        else draft.fail(pending.clientId, text);
        setError(text);
        setChecks((values) => ({ ...values, [pending.clientId]: 'unknown' }));
        if (!lookup && uncertainWrite(caught)) {
          try {
            const message = await find();
            if (!valid() || request.signal.aborted) return;
            if (message) confirm(message);
            else {
              setChecks((values) => ({ ...values, [pending.clientId]: 'absent' }));
              setError('尚未查询到这条消息，核实后可使用同一请求重试');
            }
          } catch (_checkError) {
            if (valid() && !request.signal.aborted) {
              setChecks((values) => ({
                ...values,
                [pending.clientId]: 'unknown',
              }));
              setError('发送结果尚未确认，请查询结果后再选择重试');
            }
          }
        }
      }
    } finally {
      if (version === operation.current) {
        lock.current = false;
        gate.current = false;
      }
      if (valid() && version === operation.current) {
        setSendingId('');
        controller.current = null;
      }
    }
  };
  const failText = draft.fail;
  const clearRich = useCallback(() => {
    if (inFlightPending.current && !inFlightPending.current.rich)
      failText(inFlightPending.current.clientId, '会话权限已更新，请重新确认发送结果');
    inFlightPending.current = null;
    operation.current++;
    controller.current?.abort();
    controller.current = null;
    lock.current = false;
    gate.current = false;
    setRich([]);
    setChecks({});
    setSendingId('');
    setError('');
  }, [gate, failText]);
  const stage = (body: string, images: UploadedImage[], replyToId?: string) => {
    if (lock.current || gate.current || !valid() || !allowed.current) return false;
    if (rich.length + draft.state.pending.length >= 20) {
      setError('请先处理已有的待发消息');
      return false;
    }
    const pending: RichPending | null =
      images.length || replyToId
        ? {
            clientId: crypto.randomUUID(),
            body: body.trim(),
            imageIds: images.map((item) => item.id),
            replyToId,
            images,
            rich: true,
            projection: thread.projectionGeneration,
            createdAt: new Date().toISOString(),
            error: '',
          }
        : draft.stage(body);
    if (!pending) return false;
    if (pending.rich) {
      setRich((items) => [...items, pending]);
      draft.setDraft('');
    }
    void execute(pending);
    return true;
  };
  return {
    pending: [...draft.state.pending, ...rich] as RichPending[],
    sendingId,
    error,
    stage,
    retry: (pending: RichPending) => void execute(pending, checks[pending.clientId] !== 'absent'),
    retryLabel: (id: string) => (checks[id] === 'absent' ? '重试发送' : '查询发送结果'),
    busy: lock.current,
    isBusy: () => lock.current,
    clearRich,
    remove,
  };
}
