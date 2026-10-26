import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronRight, Hash, MessageCircle, Plus, Radio, Search, Users, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import AppTopbar from '@/shared/ui/AppTopbar';
import { apiErrorMessage, isAbort } from '@/shared/api/client';
import { platformApi } from '@/shared/api/platformApi';
import type { Conversation, ConversationKind, PublicUser } from '@/shared/api/types';
import { useAuth } from './useAuth';
import { LoginNotice, PlatformAvatar, PlatformError } from './PlatformUi';
import { shortTime } from './platform-format';
import MessageThread from './messages/MessageThread';
import ConnectionStatus from './messages/ConnectionStatus';
import { useConversationFeed } from './messages/useConversationFeed';
import { accountEpoch } from '@/shared/api/account-guard';
import { usePlatformStream, type StreamEvent } from './messages/usePlatformStream';
import { messagesChanged } from './messages/message-drafts';
import NotificationBell from './notifications/NotificationBell';
import './platform.css';

const kindNames: Record<ConversationKind, string> = {
  direct: '私聊',
  group: '群组',
  channel: '频道',
};

export default function PlatformMessagesPage() {
  const auth = useAuth();
  const [params] = useSearchParams();
  return (
    <section
      className={`platform-page platform-messages-page ${auth.user && params.get('conversation') ? 'is-selected' : ''}`}
    >
      {!auth.user ? (
        <>
          <AppTopbar title="消息" />
          <div className="platform-content">
            <div className="platform-message-welcome">
              <span>
                <MessageCircle size={37} strokeWidth={1.4} />
              </span>
              <h1>把联系留在身边</h1>
              <p>私聊、群组、频道，与你的账号一起同步。</p>
            </div>
            {auth.status === 'checking' ? (
              <p role="status" className="platform-empty">
                正在验证账号…
              </p>
            ) : (
              <LoginNotice returnTo="/messages" text="登录后，查看服务器上的会话" />
            )}
            <PlatformError message={auth.error} retry={() => void auth.refresh()} />
            <Link className="platform-text-link" to="/social/demo">
              查看本机社交演示
            </Link>
          </div>
        </>
      ) : (
        <SignedInMessages key={`${auth.user.id}:${auth.expiresAt}:${accountEpoch()}`} />
      )}
    </section>
  );
}

function SignedInMessages() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('conversation') ?? '';
  const feed = useConversationFeed(user!.id);
  const [messageUpdate, setMessageUpdate] = useState(0);
  const [lastEvent, setLastEvent] = useState<StreamEvent>();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | ConversationKind>(() =>
    params.get('type') === 'groups'
      ? 'group'
      : params.get('type') === 'channels'
        ? 'channel'
        : 'all',
  );
  const streamStatus = usePlatformStream(user!.id, (event) => {
    if (event.type === 'message.retracted' && event.conversationId && event.messageId)
      feed.retract(event.conversationId, event.messageId);
    setLastEvent(event);
    feed.refresh(event.type !== 'message.created' && event.type !== 'conversation.read');
    if (
      event.type !== 'conversation.read' &&
      (!event.conversationId || event.conversationId === selectedId)
    )
      setMessageUpdate((value) => value + 1);
  });
  const selected = feed.items.find((item) => item.id === selectedId);
  const visible = feed.items.filter(
    (item) =>
      (kind === 'all' || item.kind === kind) &&
      `${item.title} ${item.lastMessage?.status === 'retracted' ? '消息已撤回' : (item.lastMessage?.body ?? '')}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const choose = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set('conversation', id);
    else next.delete('conversation');
    setParams(next);
    setCreating(false);
  };
  return (
    <>
      <AppTopbar
        title="消息"
        leading={<NotificationBell />}
        actions={
          <button type="button" aria-label="创建会话" onClick={() => setCreating(true)}>
            <Plus size={23} />
          </button>
        }
      />
      <div className={`platform-messages-layout ${selectedId ? 'has-conversation' : ''}`}>
        <aside className="platform-conversations">
          <div className="platform-message-mode">
            <ConnectionStatus status={streamStatus} />
            <Link to="/social/demo">
              本机演示
              <ChevronRight size={13} />
            </Link>
          </div>
          <label className="platform-search">
            <Search size={17} />
            <input
              aria-label="搜索服务器会话"
              placeholder="搜索消息或联系人"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="platform-conversation-filters" aria-label="通讯类型">
            {(['all', 'direct', 'group', 'channel'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={kind === value ? 'active' : ''}
                aria-pressed={kind === value}
                onClick={() => setKind(value)}
              >
                {value === 'all' ? '全部' : kindNames[value]}
              </button>
            ))}
          </div>
          <PlatformError message={feed.error} retry={() => feed.refresh()} />
          {feed.loading ? (
            <p className="platform-empty" role="status">
              正在加载会话…
            </p>
          ) : visible.length ? (
            <div className="platform-conversation-list">
              {visible.map((item) => (
                <button
                  type="button"
                  className={selectedId === item.id ? 'active' : ''}
                  aria-current={selectedId === item.id ? 'page' : undefined}
                  key={item.id}
                  onClick={() => choose(item.id)}
                >
                  <span className={`platform-conversation-icon ${item.kind}`}>
                    {item.kind === 'channel' ? (
                      <Radio size={22} />
                    ) : item.kind === 'group' ? (
                      <Users size={22} />
                    ) : (
                      <MessageCircle size={22} />
                    )}
                  </span>
                  <span className="platform-conversation-copy">
                    <span>
                      <strong>{item.title || kindNames[item.kind]}</strong>
                      <time>{item.lastMessage ? shortTime(item.lastMessage.createdAt) : ''}</time>
                    </span>
                    <small>
                      {item.lastMessage?.status === 'retracted'
                        ? '消息已撤回'
                        : item.lastMessage?.body ||
                          (item.lastMessage?.images?.length
                            ? '[图片]'
                            : `${kindNames[item.kind]} · ${item.members.length} 位成员`)}
                    </small>
                  </span>
                  {!!item.unreadCount && (
                    <b className="platform-unread" aria-label={`${item.unreadCount} 条未读消息`}>
                      {item.unreadCount > 99 ? '99+' : item.unreadCount}
                    </b>
                  )}
                </button>
              ))}
            </div>
          ) : (
            !feed.error && (
              <div className="platform-empty">
                <MessageCircle size={30} />
                <h2>{query ? '没有找到会话' : '从一句你好开始'}</h2>
                <p>{query ? '试试其他关键词。' : '创建私聊、群组或自己的频道。'}</p>
                <button
                  className="platform-secondary"
                  type="button"
                  onClick={() => setCreating(true)}
                >
                  创建会话
                </button>
              </div>
            )
          )}
        </aside>
        <div className="platform-conversation-detail">
          {selected ? (
            <MessageThread
              key={`${user!.id}:${selected.id}`}
              conversation={selected}
              onBack={() => choose('')}
              onSent={() => feed.refresh(false)}
              onRead={feed.read}
              updateVersion={messageUpdate}
              streamEvent={lastEvent}
              streamStatus={streamStatus}
            />
          ) : selectedId && !feed.loading && !feed.error ? (
            <div className="platform-empty">
              <h2>会话不可访问</h2>
              <p>会话可能不存在，或者你不是这个会话的成员。</p>
              <button className="platform-secondary" type="button" onClick={() => choose('')}>
                返回会话列表
              </button>
            </div>
          ) : (
            <div className="platform-thread-placeholder">
              <span>
                <Hash size={36} strokeWidth={1.3} />
              </span>
              <h2>每一次交流，都有回响</h2>
              <p>选择一个会话，或创建新的连接。</p>
              <small>{user?.name} · 会话保存在服务器</small>
            </div>
          )}
        </div>
      </div>
      {creating && (
        <div
          className="platform-create-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="创建会话"
        >
          <CreateConversation
            onClose={() => setCreating(false)}
            onCreated={(item) => {
              feed.upsert(item);
              choose(item.id);
              feed.refresh();
              messagesChanged();
            }}
          />
        </div>
      )}
    </>
  );
}

function CreateConversation({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (item: Conversation) => void;
}) {
  const { user } = useAuth();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const [kind, setKind] = useState<ConversationKind>('direct');
  const [title, setTitle] = useState('');
  const [directory, setDirectory] = useState<PublicUser[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void platformApi
      .directory(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted)
          setDirectory(result.items.filter((item) => item.id !== user?.id));
      })
      .catch((caught) => {
        if (!isAbort(caught)) setError(apiErrorMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision, user?.id]);
  const candidates = directory.filter((item) =>
    `${item.name} ${item.handle}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (kind === 'direct' && members.length !== 1) {
      setError('请选择一位联系人');
      return;
    }
    if (kind === 'group' && !members.length) {
      setError('请至少选择一位成员');
      return;
    }
    if (kind !== 'direct' && !title.trim()) {
      setError('请输入名称');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const conversation = await platformApi.createConversation({
        kind,
        memberIds: members,
        title:
          kind === 'direct'
            ? (directory.find((item) => item.id === members[0])?.name ?? '私聊')
            : title.trim(),
      });
      if (active.current) onCreated(conversation);
    } catch (caught) {
      if (active.current) setError(apiErrorMessage(caught));
    } finally {
      if (active.current) setBusy(false);
    }
  };
  return (
    <form className="platform-create-conversation" onSubmit={(event) => void submit(event)}>
      <header>
        <h2>新的连接</h2>
        <button type="button" aria-label="取消创建会话" onClick={onClose}>
          <X size={21} />
        </button>
      </header>
      <div className="platform-create-kinds">
        {(['direct', 'group', 'channel'] as const).map((value) => (
          <button
            className={kind === value ? 'active' : ''}
            aria-pressed={kind === value}
            type="button"
            key={value}
            onClick={() => {
              setKind(value);
              setMembers([]);
              setError('');
            }}
          >
            {value === 'direct' ? (
              <MessageCircle size={20} />
            ) : value === 'group' ? (
              <Users size={20} />
            ) : (
              <Radio size={20} />
            )}
            {kindNames[value]}
          </button>
        ))}
      </div>
      <p className="platform-create-hint">
        {kind === 'direct'
          ? '选择一个人，开始你们的对话。'
          : kind === 'group'
            ? '每位成员都可以交流、发送消息。'
            : '创建者负责发布，成员一起订阅阅读。'}
      </p>
      {kind !== 'direct' && (
        <label className="platform-create-name">
          {kindNames[kind]}名称
          <input
            required
            maxLength={80}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={kind === 'group' ? '例如：周末徒步计划' : '例如：独立创作手记'}
          />
        </label>
      )}
      <label className="platform-search">
        <Search size={17} />
        <input
          aria-label="搜索账号目录"
          placeholder="名字或账号"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="platform-directory-label">
        <span>{kind === 'channel' ? '邀请成员（可选）' : '选择成员'}</span>
        <small>已选 {members.length}</small>
      </div>
      {loading ? (
        <p className="platform-empty" role="status">
          正在加载账号目录…
        </p>
      ) : (
        <div className="platform-directory">
          {candidates.map((item) => (
            <label key={item.id}>
              <PlatformAvatar user={item} />
              <span>
                <strong>{item.name}</strong>
                <small>@{item.handle}</small>
              </span>
              <input
                type={kind === 'direct' ? 'radio' : 'checkbox'}
                name="conversation-member"
                checked={members.includes(item.id)}
                onChange={() =>
                  setMembers((previous) =>
                    kind === 'direct'
                      ? [item.id]
                      : previous.includes(item.id)
                        ? previous.filter((id) => id !== item.id)
                        : [...previous, item.id],
                  )
                }
              />
            </label>
          ))}
          {!candidates.length && <p className="platform-empty">没有找到可邀请的账号。</p>}
        </div>
      )}
      <PlatformError
        message={error}
        retry={loading ? undefined : () => setRevision((value) => value + 1)}
      />
      <button
        className="platform-primary"
        type="submit"
        disabled={busy || loading || (kind === 'direct' ? members.length !== 1 : !title.trim())}
      >
        {busy ? '正在创建…' : `创建${kindNames[kind]}`}
        <ChevronRight size={17} />
      </button>
    </form>
  );
}
