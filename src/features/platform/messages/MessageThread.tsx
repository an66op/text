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
  Plus,
  X,
  Image as ImageIcon,
  Reply,
  Undo2,
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
import { messagesChanged } from './message-drafts';
import { useMessageSender } from './useMessageSender';
import { useConversationUploads, uncertainWrite } from './useConversationUploads';
import MessageViewer, { MessageImages } from './MessageMedia';
import ChatUploadPicker from './ChatUploadPicker';
import ActionDialog from '@/shared/ui/ActionDialog';
import './chat-media.css';
import { useMessageDraft } from './useMessageDraft';
import { useThreadMessages } from './useThreadMessages';
import type { StreamEvent, StreamStatus } from './usePlatformStream';
import { useVisibleReadMark } from './useVisibleReadMark';

export default function MessageThread({
  conversation,
  onBack,
  onSent,
  onRead,
  updateVersion,
  streamStatus,
  streamEvent,
}: {
  conversation: Conversation;
  onBack: () => void;
  onSent: (message: PlatformMessage) => void;
  onRead: (mark: ReadMark) => void;
  updateVersion: number;
  streamStatus: StreamStatus;
  streamEvent?: StreamEvent;
}) {
  const { user } = useAuth();
  const userId = user!.id;
  const thread = useThreadMessages(
    userId,
    conversation.id,
    updateVersion,
    conversation.mutationVersion,
    streamEvent,
  );
  const draft = useMessageDraft(userId, conversation.id);
  const [sendError, setSendError] = useState(''),
    [panel, setPanel] = useState(false),
    [picker, setPicker] = useState(false),
    [replyId, setReplyId] = useState(''),
    [retractId, setRetractId] = useState(''),
    [retractBusy, setRetractBusy] = useState(false),
    [unknownRetracts, setUnknownRetracts] = useState<Set<string>>(new Set()),
    [viewer, setViewer] = useState<{ messageId: string; imageId: string } | null>(null);
  const retractUnknown = unknownRetracts.has(retractId);
  const setRetractUnknown = (unknown: boolean) =>
    setUnknownRetracts((previous) => {
      const next = new Set(previous);
      if (unknown) next.add(retractId);
      else next.delete(retractId);
      return next;
    });
  const fileInput = useRef<HTMLInputElement>(null),
    gate = useRef(false),
    requests = useRef(new Set<AbortController>());
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
  const uploads = useConversationUploads(userId, conversation.id, thread.deny);
  const sender = useMessageSender(
    userId,
    conversation.id,
    thread,
    draft,
    canSend,
    (message) => {
      following.current = true;
      setFollowingLatest(true);
      onSent(message);
    },
    gate,
  );
  const reply = replyId ? thread.quote(replyId) : null;
  const replyInvalid = !!replyId && (!reply?.available || thread.missing(replyId));
  const clearUploads = uploads.clear,
    clearRich = sender.clearRich;
  const privacy = useRef('');
  useEffect(() => {
    const key = `${thread.permissionEpoch}:${canSend}:${conversation.ownerId}`;
    if (privacy.current && !privacy.current.startsWith('0:') && privacy.current !== key) {
      clearUploads();
      clearRich();
      setReplyId('');
      setViewer(null);
      setRetractId('');
      requests.current.forEach((request) => request.abort());
    }
    privacy.current = key;
  }, [thread.permissionEpoch, canSend, conversation.ownerId, clearUploads, clearRich]);
  useEffect(() => {
    if (thread.floor > 0)
      messagesChanged({ conversationId: conversation.id, mutationVersion: thread.floor });
  }, [thread.floor, conversation.id]);
  const retractMessage = thread.messages.find((message) => message.id === retractId);
  useEffect(() => {
    active.current = true;
    const controllers = requests.current;
    return () => {
      active.current = false;
      controllers.forEach((request) => request.abort());
    };
  }, []);
  useLayoutEffect(() => {
    const container = layout.current;
    if (!container) return;
    const header = container.querySelector<HTMLElement>('.platform-thread-header');
    const status = container.querySelector<HTMLElement>('.platform-thread-status');
    const footer = container.querySelector<HTMLElement>('.platform-thread-footer');
    const measure = () => {
      const availableHeight = Math.min(
        container.getBoundingClientRect().height || window.innerHeight,
        window.visualViewport?.height ?? window.innerHeight,
      );
      if (availableHeight > 0)
        container.style.setProperty('--thread-available-height', `${availableHeight}px`);
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
  }, [thread.messages, thread.historyLoading, sender.pending]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (
      (!draft.state.draft.trim() && !uploads.images.length) ||
      !canSend ||
      !uploads.ready ||
      replyInvalid ||
      gate.current
    )
      return;
    if (sender.stage(draft.state.draft, uploads.images, replyId || undefined)) {
      historyPosition.current = null;
      following.current = true;
      setFollowingLatest(true);
      uploads.detach();
      setReplyId('');
      setPanel(false);
    }
  };
  const retract = async () => {
    if (!retractMessage || gate.current || !active.current) return;
    gate.current = true;
    setRetractBusy(true);
    setSendError('');
    const request = new AbortController();
    requests.current.add(request);
    const permission = thread.capturePermission();
    try {
      if (retractUnknown) {
        const message = await platformApi.message(conversation.id, retractId, request.signal);
        if (!active.current || request.signal.aborted) return;
        if (
          message.id !== retractId ||
          message.conversationId !== conversation.id ||
          message.sender.id !== userId ||
          !['sent', 'retracted'].includes(message.status ?? '')
        )
          throw new ApiError('撤回查询回执与原消息不一致，请重新查询', 'INVALID_RESPONSE', 502);
        if (!thread.apply([message], permission))
          throw new ApiError(
            '会话权限已更新，请重新确认撤回结果',
            'CONVERSATION_ACCESS_CHANGED',
            409,
          );
        if (message.status === 'retracted') {
          thread.retract(retractId);
          setRetractId('');
          setRetractUnknown(false);
        } else {
          setRetractUnknown(false);
          setSendError('消息仍未确认撤回，核实后可再次确认撤回');
        }
        return;
      }
      const result = await platformApi.retractMessage(retractId, request.signal);
      if (!active.current || request.signal.aborted) return;
      if (!result.ok || result.messageId !== retractId)
        throw new ApiError('撤回回执无法确认', 'INVALID_RESPONSE', 200);
      thread.retract(retractId);
      messagesChanged({ conversationId: conversation.id, retractedId: retractId });
      setRetractId('');
      setRetractUnknown(false);
    } catch (caught) {
      if (active.current && !request.signal.aborted) {
        setSendError(apiErrorMessage(caught));
        if (uncertainWrite(caught)) setRetractUnknown(true);
      }
    } finally {
      gate.current = false;
      requests.current.delete(request);
      if (active.current) setRetractBusy(false);
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
          <h2>{thread.accessDenied ? '会话不可访问' : conversation.title}</h2>
          {!thread.accessDenied && (
            <small>
              {conversation.kind === 'channel'
                ? '频道'
                : conversation.kind === 'group'
                  ? '群组'
                  : '私聊'}{' '}
              · {conversation.members.length} 位成员
            </small>
          )}
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
        {thread.loading || (!thread.messages.length && thread.reconciling) ? (
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
                data-message-seq={message.syncing ? 0 : (message.seq ?? 0)}
              >
                <PlatformAvatar user={message.sender} />
                <div>
                  <strong>
                    {conversation.kind === 'channel' ? conversation.title : message.sender.name}
                  </strong>
                  {message.syncing ? (
                    <p className="chat-system">正在确认消息状态…</p>
                  ) : message.status === 'retracted' ? (
                    <p className="chat-system">消息已撤回</p>
                  ) : (
                    <>
                      {message.replyTo && (
                        <div className="chat-quote">
                          {message.replyTo.available ? (
                            <>
                              <strong>{message.replyTo.sender?.name}</strong>
                              <span>
                                {message.replyTo.body || `[${message.replyTo.imageCount}张图片]`}
                              </span>
                            </>
                          ) : (
                            <span>原消息已不可用</span>
                          )}
                        </div>
                      )}
                      {message.body && <p>{message.body}</p>}
                      {!!message.images?.length && (
                        <MessageImages
                          images={message.images}
                          onOpen={(imageId) => setViewer({ messageId: message.id, imageId })}
                        />
                      )}
                      <div className="chat-message-actions">
                        <button
                          type="button"
                          aria-label={`回复消息：${message.body.slice(0, 20) || '图片'}`}
                          disabled={!canSend}
                          onClick={() => setReplyId(message.id)}
                        >
                          <Reply size={12} />
                          回复
                        </button>
                        {message.sender.id === userId && message.canRetract && (
                          <button
                            type="button"
                            aria-label={`撤回消息：${message.body.slice(0, 20) || '图片'}`}
                            disabled={!!sender.sendingId || retractBusy}
                            onClick={() => {
                              setRetractId(message.id);
                              setSendError('');
                            }}
                          >
                            <Undo2 size={12} />
                            撤回
                          </button>
                        )}
                      </div>
                    </>
                  )}
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
        {sender.pending
          .filter((item) => !item.rich || canSend)
          .map((pending) => (
            <article
              className="platform-message mine pending"
              key={pending.clientId}
              aria-label={sender.sendingId === pending.clientId ? '消息正在发送' : '消息尚未确认'}
            >
              <div>
                {pending.body && <p>{pending.body}</p>}
                {!!pending.images?.length && pending.projection === thread.projectionGeneration && (
                  <div className="chat-pending-images">
                    {pending.images.map((image) => (
                      <img key={image.id} src={image.url} alt="待发图片" />
                    ))}
                  </div>
                )}
                <span className="platform-pending-state">
                  {sender.sendingId === pending.clientId
                    ? '发送中…'
                    : pending.error
                      ? '发送未完成'
                      : '尚未确认送达'}
                  {sender.sendingId !== pending.clientId && (
                    <button
                      type="button"
                      disabled={
                        !!sender.sendingId ||
                        thread.accessDenied ||
                        (!canSend && sender.retryLabel(pending.clientId) === '重试发送')
                      }
                      onClick={() => sender.retry(pending)}
                      aria-label={`重试发送：${pending.body.slice(0, 20)}`}
                    >
                      <RotateCcw size={12} />
                      {sender.retryLabel(pending.clientId)}
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
        {canSend ? (
          <>
            <div className="chat-compose-aux">
              <PlatformError
                message={draft.error || sendError || sender.error || uploads.error || readError}
              />
              {replyId && (
                <div className={`chat-compose-reply ${replyInvalid ? 'invalid' : ''}`}>
                  <div>
                    <strong>
                      {replyInvalid
                        ? '原消息已不可用，请取消引用后发送'
                        : `回复 ${reply?.sender?.name ?? ''}`}
                    </strong>
                    <span>
                      {replyInvalid
                        ? '正文与图片已保留'
                        : reply?.body || `[${reply?.imageCount ?? 0}张图片]`}
                    </span>
                  </div>
                  <button type="button" aria-label="取消引用" onClick={() => setReplyId('')}>
                    <X size={17} />
                  </button>
                </div>
              )}
              {uploads.items.some((item) => !item.cancelled) && (
                <div className="chat-attachments">
                  {uploads.items
                    .filter((item) => !item.cancelled)
                    .map((item) => (
                      <div key={item.clientId}>
                        <img src={item.preview} alt="待发送图片" />
                        <button
                          type="button"
                          aria-label="移出草稿"
                          onClick={() => uploads.detach(item.clientId)}
                        >
                          <X size={13} />
                        </button>
                        <span>
                          {item.status === 'ready'
                            ? '已就绪'
                            : item.status === 'uploading'
                              ? '上传中…'
                              : item.status === 'queued'
                                ? '等待上传'
                                : item.status === 'checking'
                                  ? '查询中…'
                                  : item.status === 'uncertain'
                                    ? '待确认'
                                    : '未完成'}
                        </span>
                        {item.error && <small>{item.error}</small>}
                        {item.status === 'uncertain' ? (
                          <button type="button" onClick={() => void uploads.recover(item.clientId)}>
                            查询上传结果
                          </button>
                        ) : item.status === 'failed' && item.retryAllowed ? (
                          <button type="button" onClick={() => uploads.retry(item.clientId)}>
                            同一请求重试
                          </button>
                        ) : null}
                      </div>
                    ))}
                </div>
              )}
              {!!uploads.cancelled.length && (
                <div className="chat-cancelled-uploads" aria-label="已取消上传的恢复">
                  {uploads.cancelled.map((item) => (
                    <div key={item.clientId}>
                      <span>
                        {item.status === 'ready'
                          ? '已取消的上传已保存，可加入草稿'
                          : item.status === 'checking'
                            ? '正在查询已取消的上传…'
                            : item.status === 'failed' && item.retryAllowed
                              ? '未查到已保存图片，可重新选择原文件'
                              : '已取消的上传可能已保存，请先查询'}
                      </span>
                      {item.error && <small>{item.error}</small>}
                      {item.status === 'ready' && item.image ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (uploads.restore(item.image!)) uploads.detach(item.clientId);
                          }}
                        >
                          加入草稿
                        </button>
                      ) : item.status === 'failed' && item.retryAllowed ? (
                        <button type="button" onClick={() => fileInput.current?.click()}>
                          重新选择原文件
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={item.status === 'checking'}
                          onClick={() => void uploads.recover(item.clientId)}
                        >
                          查询已取消上传
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {picker && (
                <ChatUploadPicker
                  conversationId={conversation.id}
                  onSelect={uploads.restore}
                  onClose={() => setPicker(false)}
                />
              )}
              {panel && (
                <div className="chat-more-panel">
                  <button type="button" onClick={() => fileInput.current?.click()}>
                    <ImageIcon size={24} />
                    选择图片
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPanel(false);
                      setPicker(true);
                    }}
                  >
                    <RotateCcw size={24} />
                    恢复本人上传
                  </button>
                  <Link
                    to={`/account/uploads?scope=conversation&conversationId=${encodeURIComponent(conversation.id)}`}
                  >
                    我的上传
                  </Link>
                </div>
              )}
            </div>
            <input
              hidden
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png"
              multiple
              onChange={(event) => {
                uploads.add(Array.from(event.target.files ?? []));
                event.currentTarget.value = '';
              }}
            />
            <form onSubmit={submit}>
              <button
                type="button"
                aria-label="更多消息操作"
                aria-expanded={panel}
                onClick={() => {
                  setPicker(false);
                  setPanel((value) => !value);
                }}
              >
                <Plus size={22} />
              </button>
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
                disabled={
                  !!sender.sendingId ||
                  retractBusy ||
                  !uploads.ready ||
                  replyInvalid ||
                  (!draft.state.draft.trim() && !uploads.images.length)
                }
              >
                <Send size={19} />
              </button>
            </form>
          </>
        ) : (
          <p>
            {thread.accessDenied
              ? '当前无法访问这个会话'
              : '你已加入频道，只有当前频道主可以发布消息'}
          </p>
        )}
      </div>
      {viewer && (
        <MessageViewer
          key={`${viewer.messageId}:${viewer.imageId}`}
          messages={thread.accessDenied ? [] : thread.messages}
          target={viewer}
          onClose={() => setViewer(null)}
        />
      )}
      {retractMessage && retractMessage.status !== 'retracted' && (
        <ActionDialog
          title="撤回这条消息？"
          confirmLabel={retractUnknown ? '查询撤回结果' : '确认撤回'}
          danger
          busy={retractBusy}
          onConfirm={() => void retract()}
          onClose={() => setRetractId('')}
        >
          <p>
            {retractMessage.body.slice(0, 100) || `包含${retractMessage.images?.length ?? 0}张图片`}
          </p>
          <p>撤回后正文和图片将不再显示，已另存的副本不受影响。</p>
          <PlatformError message={sendError} />
        </ActionDialog>
      )}
    </div>
  );
}
