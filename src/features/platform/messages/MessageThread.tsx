import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowDown,
  ChevronUp,
  MessageCircle,
  Radio,
  RotateCcw,
  Send,
  Users,
} from 'lucide-react';
import { ApiError, apiErrorMessage } from '@/shared/api/client';
import { Link } from 'react-router';
import { paths } from '@/shared/config/paths';
import { platformApi } from '@/shared/api/platformApi';
import type { Conversation, PlatformMessage, ReadMark } from '@/shared/api/types';
import { useAuth } from '../useAuth';
import { PlatformAvatar, PlatformError } from '../PlatformUi';
import { shortTime } from '../platform-format';
import ConnectionStatus from './ConnectionStatus';
import { messagesChanged, type PendingMessage } from './message-drafts';
import { useMessageDraft } from './useMessageDraft';
import { useThreadMessages } from './useThreadMessages';
import type { StreamStatus } from './usePlatformStream';
import { useVisibleReadMark } from './useVisibleReadMark';

export default function MessageThread({
  conversation,
  onBack,
  onSent,
  onRead,
  updateVersion,
  streamStatus,
}: {
  conversation: Conversation;
  onBack: () => void;
  onSent: (message: PlatformMessage) => void;
  onRead: (mark: ReadMark) => void;
  updateVersion: number;
  streamStatus: StreamStatus;
}) {
  const { user } = useAuth();
  const userId = user!.id;
  const thread = useThreadMessages(userId, conversation.id, updateVersion);
  const draft = useMessageDraft(userId, conversation.id);
  const pendingMessages = draft.state.pending;
  const removePending = draft.remove;
  const [sendingId, setSendingId] = useState('');
  const [sendError, setSendError] = useState('');
  const [followingLatest, setFollowingLatest] = useState(true);
  const layout = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const historyPosition = useRef<{
    top: number;
    height: number;
    anchorId?: string;
    offset: number;
  } | null>(null);
  const active = useRef(true);
  const sending = useRef(false);
  const readError = useVisibleReadMark({
    userId,
    conversationId: conversation.id,
    root: scroll,
    messages: thread.messages,
    readSeq: conversation.readSeq ?? 0,
    onRead,
    updateVersion,
  });
  const canSend =
    !thread.accessDenied && (conversation.kind !== 'channel' || conversation.ownerId === userId);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    const container = layout.current;
    if (!container) return;
    const header = container.querySelector<HTMLElement>('.platform-thread-header');
    const status = container.querySelector<HTMLElement>('.platform-thread-status');
    const footer = container.querySelector<HTMLElement>('.platform-thread-footer');
    const measure = () => {
      for (const [element, property] of [
        [header, '--thread-header-height'],
        [status, '--thread-status-height'],
        [footer, '--thread-footer-height'],
      ] as const) {
        const height = element?.getBoundingClientRect().height ?? 0;
        if (height > 0) container.style.setProperty(property, `${Math.ceil(height)}px`);
      }
      if (following.current && scroll.current)
        scroll.current.scrollTop = scroll.current.scrollHeight;
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    for (const element of [header, status, footer]) if (element) observer?.observe(element);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, []);
  useEffect(() => {
    const confirmed = pendingMessages.filter((pending) =>
      thread.messages.some(
        (message) =>
          message.clientId === pending.clientId &&
          message.body === pending.body &&
          message.sender.id === userId,
      ),
    );
    if (confirmed.length) removePending(confirmed.map((entry) => entry.clientId));
  }, [thread.messages, pendingMessages, removePending, userId]);
  useLayoutEffect(() => {
    if (historyPosition.current && !thread.historyLoading && scroll.current) {
      const previous = historyPosition.current;
      const anchor = [...scroll.current.querySelectorAll<HTMLElement>('[data-message-id]')].find(
        (node) => node.dataset.messageId === previous.anchorId,
      );
      if (anchor)
        scroll.current.scrollTop +=
          anchor.getBoundingClientRect().top -
          scroll.current.getBoundingClientRect().top -
          previous.offset;
      else scroll.current.scrollTop = previous.top + scroll.current.scrollHeight - previous.height;
      historyPosition.current = null;
    } else if (following.current && !thread.historyLoading && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [thread.messages, thread.historyLoading, draft.state.pending]);
  const send = async (pending: PendingMessage) => {
    const permission = thread.capturePermission();
    if (sending.current || !canSend || !active.current || permission === null) return;
    sending.current = true;
    setSendingId(pending.clientId);
    setSendError('');
    try {
      const message = await platformApi.sendMessage(
        conversation.id,
        pending.body,
        pending.clientId,
      );
      if (
        message.conversationId !== conversation.id ||
        message.sender.id !== userId ||
        (message.clientId && message.clientId !== pending.clientId)
      )
        throw new ApiError(
          '服务返回的消息与当前请求不一致，请使用同一请求重试',
          'INVALID_RESPONSE',
          502,
        );
      messagesChanged();
      if (!active.current) return;
      if (!thread.apply([message], permission))
        throw new ApiError(
          '会话权限已更新，旧请求未用于恢复消息，请先重新确认会话权限',
          'CONVERSATION_ACCESS_CHANGED',
          409,
        );
      following.current = true;
      setFollowingLatest(true);
      draft.remove([pending.clientId]);
      onSent(message);
      thread.refresh();
    } catch (caught) {
      if (!active.current) return;
      const message = apiErrorMessage(caught);
      draft.fail(pending.clientId, message);
      setSendError(message);
    } finally {
      sending.current = false;
      if (active.current) setSendingId('');
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.state.draft.trim() || sending.current || !canSend) return;
    const pending = draft.stage(draft.state.draft);
    if (pending) {
      historyPosition.current = null;
      following.current = true;
      setFollowingLatest(true);
      void send(pending);
    }
  };
  const loadOlder = () => {
    const area = scroll.current;
    if (area) {
      const top = area.getBoundingClientRect().top;
      const anchor = [...area.querySelectorAll<HTMLElement>('[data-message-id]')].find(
        (node) => node.getBoundingClientRect().bottom > top,
      );
      historyPosition.current = {
        top: area.scrollTop,
        height: area.scrollHeight,
        anchorId: anchor?.dataset.messageId,
        offset: anchor ? anchor.getBoundingClientRect().top - top : 0,
      };
    }
    following.current = false;
    setFollowingLatest(false);
    void thread.loadOlder();
  };
  return (
    <div className="platform-thread" ref={layout}>
      <header className="platform-thread-header">
        <button type="button" aria-label="返回服务器会话" onClick={onBack}>
          <ArrowLeft size={21} />
        </button>
        <div>
          <h2>{conversation.title}</h2>
          <small>
            {conversation.kind === 'channel'
              ? '频道'
              : conversation.kind === 'group'
                ? '群组'
                : '私聊'}{' '}
            · {conversation.members.length} 位成员
          </small>
        </div>
        <Link
          className="platform-thread-info"
          to={paths.conversationDetails(conversation.id)}
          aria-label="聊天信息"
        >
          {conversation.kind === 'channel' ? <Radio size={20} /> : <Users size={20} />}
        </Link>
      </header>
      <div className="platform-thread-status">
        <ConnectionStatus status={streamStatus} />
      </div>
      <div
        className="platform-thread-messages"
        ref={scroll}
        onScroll={() => {
          const area = scroll.current;
          if (area) {
            const near = area.scrollHeight - area.scrollTop - area.clientHeight < 100;
            following.current = near;
            setFollowingLatest(near);
          }
        }}
      >
        <PlatformError message={thread.error} retry={thread.refresh} />
        {thread.hasMore && (
          <button
            type="button"
            className="platform-message-history"
            disabled={thread.historyLoading}
            onClick={loadOlder}
          >
            <ChevronUp size={14} />
            {thread.historyLoading ? '正在读取历史…' : '加载更早消息'}
          </button>
        )}
        {thread.loading ? (
          <p className="platform-empty" role="status">
            正在读取消息…
          </p>
        ) : thread.messages.length ? (
          <>
            {thread.messages.map((message) => (
              <article
                key={message.id}
                className={`platform-message ${message.sender.id === userId ? 'mine' : ''}`}
                data-message-id={message.id}
                data-message-seq={message.seq ?? 0}
              >
                <PlatformAvatar user={message.sender} />
                <div>
                  <strong>
                    {conversation.kind === 'channel' ? conversation.title : message.sender.name}
                  </strong>
                  <p>{message.body}</p>
                  <time dateTime={message.createdAt}>{shortTime(message.createdAt)}</time>
                </div>
              </article>
            ))}
          </>
        ) : (
          !thread.error && (
            <div className="platform-empty">
              <MessageCircle size={29} />
              <h2>
                {conversation.kind === 'channel'
                  ? '第一条播报，从这里开始'
                  : '你们的故事，还未开篇'}
              </h2>
              <p>{canSend ? '发送一条消息，开启交流。' : '等待频道主的第一条更新。'}</p>
            </div>
          )
        )}
        {draft.state.pending.map((pending) => (
          <article
            className="platform-message mine pending"
            key={pending.clientId}
            aria-label={sendingId === pending.clientId ? '消息正在发送' : '消息尚未确认'}
          >
            <div>
              <p>{pending.body}</p>
              <span className="platform-pending-state">
                {sendingId === pending.clientId
                  ? '发送中…'
                  : pending.error
                    ? '发送未完成'
                    : '尚未确认送达'}
                {sendingId !== pending.clientId && (
                  <button
                    type="button"
                    disabled={!!sendingId || !canSend}
                    onClick={() => void send(pending)}
                    aria-label={`重试发送：${pending.body.slice(0, 20)}`}
                  >
                    <RotateCcw size={12} />
                    重试
                  </button>
                )}
              </span>
              {pending.error && <small>{pending.error}</small>}
            </div>
          </article>
        ))}
        <div aria-hidden="true" />
      </div>
      {!followingLatest && (
        <button
          type="button"
          className="platform-latest-button"
          onClick={() => {
            following.current = true;
            setFollowingLatest(true);
            if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
          }}
        >
          <ArrowDown size={15} />
          回到最新
        </button>
      )}
      <div className="platform-thread-footer">
        <PlatformError message={draft.error || sendError || readError} />
        {canSend ? (
          <form onSubmit={submit}>
            <input
              aria-label="服务器消息内容"
              value={draft.state.draft}
              maxLength={5000}
              onChange={(event) => draft.setDraft(event.target.value)}
              placeholder={conversation.kind === 'channel' ? '发布频道消息…' : '发送消息…'}
            />
            <button
              type="submit"
              aria-label="发送服务器消息"
              disabled={!!sendingId || !draft.state.draft.trim()}
            >
              <Send size={19} />
            </button>
          </form>
        ) : (
          <p>
            {thread.accessDenied
              ? '当前无法访问这个会话'
              : '你已加入频道，只有当前频道主可以发布消息'}
          </p>
        )}
      </div>
    </div>
  );
}
