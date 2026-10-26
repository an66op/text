import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRightLeft, Crown, LogOut, Plus, Radio, UserMinus, UsersRound } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, apiErrorMessage } from '@/shared/api/client';
import type { Conversation, PublicUser } from '@/shared/api/types';
import { paths } from '@/shared/config/paths';
import ActionDialog from '@/shared/ui/ActionDialog';
import PageHeader from '@/shared/ui/PageHeader';
import { useAuth } from '../useAuth';
import { LoginNotice, PlatformAvatar, PlatformError } from '../PlatformUi';
import { usePlatformStream } from '../messages/usePlatformStream';
import { messagesChanged } from '../messages/message-drafts';
import { conversationApi } from './conversation-api';
import { useConversationDetails } from './useConversationDetails';
import MemberPicker from './MemberPicker';
import '../platform.css';
import './conversation-details.css';

type Confirmation = { kind: 'remove' | 'transfer'; person: PublicUser } | { kind: 'leave' };

export default function ConversationDetailsPage() {
  const { conversationId = '' } = useParams();
  const auth = useAuth();
  return (
    <section className="conversation-details-page">
      <PageHeader title="聊天信息" backTo={paths.social} />
      {auth.status === 'checking' ? (
        <p className="conversation-loading" role="status">
          正在验证账号…
        </p>
      ) : auth.user ? (
        <ConversationSettings key={`${auth.user.id}:${conversationId}`} id={conversationId} />
      ) : (
        <div className="conversation-details-content">
          <LoginNotice
            returnTo={paths.conversationDetails(conversationId)}
            text="登录后查看这段对话"
          />
          <PlatformError message={auth.error} retry={() => void auth.refresh()} />
        </div>
      )}
    </section>
  );
}

function ConversationSettings({ id }: { id: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const resource = useConversationDetails(user!.id, id);
  const [picker, setPicker] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const active = useRef(true);
  const inFlight = useRef(false);
  const current = resource.data?.conversation;
  const confirmationAllowed =
    !!current &&
    !!confirmation &&
    current.kind !== 'direct' &&
    (confirmation.kind === 'leave'
      ? current.ownerId !== user!.id
      : current.ownerId === user!.id &&
        current.members.includes(confirmation.person.id) &&
        confirmation.person.id !== user!.id);
  usePlatformStream(user!.id, (event) => {
    if (
      ['resync', 'conversation.updated', 'conversation.created', 'membership.revoked'].includes(
        event.type,
      ) &&
      (!event.conversationId || event.conversationId === id)
    )
      resource.refresh();
  });
  useEffect(() => {
    if (confirmation && !confirmationAllowed) {
      setConfirmation(null);
      setActionError('成员或管理身份已变化，请重新选择操作');
    }
  }, [confirmation, confirmationAllowed]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const run = async (key: string, operation: () => Promise<Conversation>, message: string) => {
    if (inFlight.current || !active.current) return;
    inFlight.current = true;
    setBusy(key);
    setActionError('');
    setNotice('');
    try {
      const next = await operation();
      if (!active.current) return;
      if (next.id !== id)
        throw new ApiError('返回的会话信息不一致，请刷新重试', 'INVALID_RESPONSE', 502);
      resource.accept(next);
      setConfirmation(null);
      setPicker(false);
      setNotice(message);
      messagesChanged();
      resource.refresh();
    } catch (caught) {
      if (active.current) {
        setActionError(apiErrorMessage(caught));
        resource.refresh();
      }
    } finally {
      inFlight.current = false;
      if (active.current) setBusy('');
    }
  };
  const leave = async () => {
    if (inFlight.current || !active.current) return;
    inFlight.current = true;
    setBusy('leave');
    setActionError('');
    try {
      await conversationApi.leave(id);
      messagesChanged();
      if (active.current) navigate(paths.social, { replace: true });
    } catch (caught) {
      if (active.current) {
        setActionError(apiErrorMessage(caught));
        resource.refresh();
      }
    } finally {
      inFlight.current = false;
      if (active.current) setBusy('');
    }
  };
  const openConfirmation = (next: Confirmation) => {
    setActionError('');
    setConfirmation(next);
  };
  if (resource.loading && !resource.data)
    return (
      <p className="conversation-loading" role="status">
        正在加载聊天信息…
      </p>
    );
  if (!resource.data)
    return (
      <div className="conversation-details-content">
        <PlatformError
          message={resource.error || '暂时无法读取聊天信息'}
          retry={resource.refresh}
        />
        {resource.denied && (
          <p className="conversation-subtle">你可能已退出或被移出，请回到消息列表查看。</p>
        )}
        <Link className="conversation-back" to={paths.social}>
          返回消息
        </Link>
      </div>
    );
  const { conversation, memberProfiles } = resource.data;
  const isDirect = conversation.kind === 'direct';
  const isOwner = conversation.ownerId === user!.id;
  const canManage = !isDirect && isOwner && !resource.denied;
  const name =
    conversation.kind === 'channel' ? '频道' : conversation.kind === 'group' ? '群组' : '私聊';
  return (
    <div className="conversation-details-content">
      <section className="conversation-identity">
        <div className={`conversation-identity-icon ${conversation.kind}`}>
          {conversation.kind === 'channel' ? (
            <Radio size={29} strokeWidth={1.5} />
          ) : (
            <UsersRound size={29} strokeWidth={1.5} />
          )}
        </div>
        <h1>{conversation.title}</h1>
        <p>
          {name}
          <span>·</span>
          {conversation.members.length} 位成员
        </p>
        <Link to={`${paths.social}?conversation=${encodeURIComponent(id)}`}>回到对话</Link>
      </section>
      <PlatformError message={resource.error} retry={resource.refresh} />
      {(!confirmation || !confirmationAllowed) && <PlatformError message={actionError} />}
      {notice && (
        <p role="status" className="conversation-notice">
          {notice}
        </p>
      )}
      {canManage && (
        <TitleEditor
          key={`${conversation.ownerId}:${conversation.title}`}
          title={conversation.title}
          busy={!!busy}
          onSave={(title) =>
            void run('title', () => conversationApi.rename(id, title), `${name}名称已更新`)
          }
        />
      )}
      <section className="conversation-member-section">
        <div className="conversation-section-heading">
          <h2>
            成员 <small>{conversation.members.length}</small>
          </h2>
          {canManage && (
            <button
              type="button"
              disabled={!!busy || conversation.members.length >= 200}
              onClick={() => setPicker((value) => !value)}
            >
              <Plus size={16} /> 添加
            </button>
          )}
        </div>
        {picker && canManage && (
          <MemberPicker
            existingIds={conversation.members}
            busy={!!busy}
            onClose={() => setPicker(false)}
            onAdd={(ids) => void run('add', () => conversationApi.add(id, ids), '成员已添加')}
          />
        )}
        <div className="conversation-members">
          {memberProfiles.map((person) => (
            <div className="conversation-member" key={person.id}>
              <Link to={paths.user(person.handle)}>
                <PlatformAvatar user={person} />
                <span>
                  <strong>
                    {person.name}
                    {person.id === user!.id && <small>我</small>}
                  </strong>
                  <small>@{person.handle}</small>
                </span>
              </Link>
              {!isDirect && person.id === conversation.ownerId && (
                <span className="conversation-owner">
                  <Crown size={12} /> {name === '频道' ? '频道主' : '群主'}
                </span>
              )}
              {canManage && person.id !== user!.id && (
                <div className="conversation-member-actions">
                  <button
                    type="button"
                    disabled={!!busy}
                    aria-label={`转交给${person.name}`}
                    onClick={() => openConfirmation({ kind: 'transfer', person })}
                  >
                    <ArrowRightLeft size={16} />
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    aria-label={`移除${person.name}`}
                    onClick={() => openConfirmation({ kind: 'remove', person })}
                  >
                    <UserMinus size={17} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        {!isDirect && (
          <p className="conversation-subtle">
            {conversation.kind === 'channel'
              ? '频道由频道主发布，订阅成员可阅读。'
              : '成员可以在群组内自由交流。'}
            {isOwner ? '你可以管理成员或转交身份。' : '成员与名称由创建者管理。'}
          </p>
        )}
      </section>
      {!isDirect && (
        <section className="conversation-leave-section">
          {isOwner ? (
            <p className="conversation-subtle">
              离开前，请先在成员右侧将{name === '频道' ? '频道主' : '群主'}身份转交给另一位成员。
            </p>
          ) : (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => openConfirmation({ kind: 'leave' })}
            >
              <LogOut size={16} /> 退出{name}
            </button>
          )}
        </section>
      )}
      {confirmation && confirmationAllowed && (
        <ActionDialog
          title={
            confirmation.kind === 'remove'
              ? '移除成员'
              : confirmation.kind === 'transfer'
                ? `转交${name}`
                : `退出${name}`
          }
          confirmLabel={
            confirmation.kind === 'remove'
              ? '确认移除'
              : confirmation.kind === 'transfer'
                ? '确认转交'
                : '确认退出'
          }
          danger={confirmation.kind !== 'transfer'}
          busy={!!busy}
          onClose={() => {
            setConfirmation(null);
            setActionError('');
          }}
          onConfirm={() => {
            if (!confirmationAllowed) return;
            if (confirmation.kind === 'leave') void leave();
            else if (confirmation.kind === 'remove')
              void run(
                'remove',
                () => conversationApi.remove(id, confirmation.person.id),
                '该成员已移除',
              );
            else
              void run(
                'transfer',
                () => conversationApi.transfer(id, confirmation.person.id),
                '管理身份已转交',
              );
          }}
        >
          <p>
            {confirmation.kind === 'remove'
              ? `将「${confirmation.person.name}」移出「${conversation.title}」后，对方将无法再查看和发送此会话的消息。`
              : confirmation.kind === 'transfer'
                ? `将「${conversation.title}」交给「${confirmation.person.name}」管理。转交后，你会成为普通成员。`
                : `退出「${conversation.title}」后，你将无法再查看此会话的消息。再次加入需要管理者添加。`}
          </p>
          <PlatformError message={actionError} />
        </ActionDialog>
      )}
    </div>
  );
}

function TitleEditor({
  title: initial,
  busy,
  onSave,
}: {
  title: string;
  busy: boolean;
  onSave: (title: string) => void;
}) {
  const [title, setTitle] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy && title.trim() && title.trim() !== initial) onSave(title.trim());
  };
  return (
    <form className="conversation-title-editor" onSubmit={submit}>
      <label htmlFor="conversation-title">聊天名称</label>
      <div>
        <input
          id="conversation-title"
          maxLength={80}
          disabled={busy}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button type="submit" disabled={busy || !title.trim() || title.trim() === initial}>
          保存
        </button>
      </div>
    </form>
  );
}
