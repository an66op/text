import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Check,
  Clock3,
  RefreshCw,
  UserRoundCheck,
  UserRoundMinus,
  UserRoundPlus,
} from 'lucide-react';
import type { PublicUser } from '@/shared/api/types';
import { apiErrorMessage } from '@/shared/api/client';
import { PlatformError } from '@/features/platform/PlatformUi';
import { useAuth } from '@/features/platform/useAuth';
import { friendshipApi, friendshipsChanged } from './friendship-api';
import type { RequestAction } from './friendship-types';
import { useRelationship } from './useRelationship';
import FriendRemovalDialog from './FriendRemovalDialog';
import './friendship.css';

export default function FriendshipActions({ person }: { person: PublicUser }) {
  const { user } = useAuth();
  if (!user || user.id === person.id) return null;
  return <RelationshipActions key={`${user.id}:${person.id}`} person={person} userId={user.id} />;
}

function RelationshipActions({ person, userId }: { person: PublicUser; userId: string }) {
  const relation = useRelationship(person.id);
  const [requesting, setRequesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const active = useRef(true);
  const dispatching = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const mutate = async (action: 'request' | 'remove' | RequestAction) => {
    if (dispatching.current || relation.loading || !relation.relationship) return;
    dispatching.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (action === 'request') {
        const result = await friendshipApi.request(person.id, note.trim());
        if (result.from.id !== userId || result.to.id !== person.id || result.status !== 'pending')
          throw new Error('申请结果与当前成员不一致，请重新读取关系');
      } else if (action === 'remove') await friendshipApi.remove(person.id);
      else {
        const request = relation.relationship.request;
        if (!request) throw new Error('申请已变化，请刷新关系后重试');
        const result = await friendshipApi.respond(request.id, action);
        const expected = { accept: 'accepted', decline: 'declined', cancel: 'cancelled' }[action];
        if (result.id !== request.id || result.status !== expected)
          throw new Error('申请状态尚未更新，请重新读取关系');
      }
      if (!active.current) return;
      setRequesting(false);
      setRemoving(false);
      setNote('');
      setMessage(
        action === 'request'
          ? '好友申请已发送，等待对方确认'
          : action === 'accept'
            ? `已与 ${person.name} 成为好友`
            : action === 'decline'
              ? '已拒绝这条好友申请'
              : action === 'cancel'
                ? '好友申请已撤销'
                : `已移除与 ${person.name} 的好友关系`,
      );
      friendshipsChanged();
    } catch (caught) {
      if (active.current) {
        setError(apiErrorMessage(caught));
        relation.refresh();
      }
    } finally {
      dispatching.current = false;
      if (active.current) setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void mutate('request');
  };
  const value = relation.relationship;
  const request = value?.request;
  return (
    <section className="friendship-profile" aria-label="好友关系">
      <div className="friendship-profile-heading">
        <span>好友关系</span>
        <button
          className="friendship-text-button"
          type="button"
          aria-label="刷新好友关系"
          disabled={busy || relation.loading}
          onClick={relation.refresh}
        >
          <RefreshCw size={13} />
        </button>
      </div>
      {relation.loading && !value && (
        <p className="friendship-relation-status" role="status">
          正在确认好友关系…
        </p>
      )}
      <PlatformError
        message={relation.error || (!removing ? error : '')}
        retry={relation.error ? relation.refresh : undefined}
      />
      {message && (
        <p className="friendship-feedback" role="status">
          <Check size={14} />
          {message}
        </p>
      )}
      {value?.status === 'none' && (
        <>
          <p className="friendship-relation-status">社区成员 · 尚未成为好友</p>
          {!requesting && (
            <button
              className="friendship-add-button"
              type="button"
              disabled={busy || relation.loading}
              onClick={() => {
                setError('');
                setMessage('');
                setRequesting(true);
              }}
            >
              <UserRoundPlus size={17} />
              添加好友
            </button>
          )}
        </>
      )}
      {value?.status === 'outgoing' && (
        <div className="friendship-relation-row">
          <span>
            <Clock3 size={15} />
            等待对方验证
          </span>
          <button
            className="friendship-text-button"
            type="button"
            disabled={busy || relation.loading || !request}
            onClick={() => void mutate('cancel')}
          >
            {busy ? '处理中…' : '撤销申请'}
          </button>
        </div>
      )}
      {value?.status === 'incoming' && (
        <>
          <p className="friendship-relation-status">对方向你发出了好友申请</p>
          {request?.note && <p className="friendship-profile-note">{request.note}</p>}
          <div className="friendship-profile-request-actions">
            <button
              className="friendship-secondary"
              type="button"
              disabled={busy || relation.loading || !request}
              onClick={() => void mutate('decline')}
            >
              拒绝申请
            </button>
            <button
              className="friendship-primary"
              type="button"
              disabled={busy || relation.loading || !request}
              onClick={() => void mutate('accept')}
            >
              {busy ? '处理中…' : '接受申请'}
            </button>
          </div>
        </>
      )}
      {value?.status === 'friends' && (
        <div className="friendship-relation-row">
          <span>
            <UserRoundCheck size={16} />
            已是好友
          </span>
          <button
            className="friendship-text-button"
            type="button"
            disabled={busy || relation.loading}
            onClick={() => {
              setError('');
              setRemoving(true);
            }}
          >
            <UserRoundMinus size={14} />
            移除好友
          </button>
        </div>
      )}
      {requesting && value?.status === 'none' && (
        <form className="friendship-request-form" onSubmit={submit}>
          <label>
            申请说明
            <textarea
              aria-label="申请说明"
              rows={3}
              maxLength={300}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="一句自我介绍，让对方更容易记住你"
            />
          </label>
          <div>
            <small>{note.length}/300</small>
            <button
              type="button"
              className="friendship-secondary"
              disabled={busy}
              onClick={() => setRequesting(false)}
            >
              取消
            </button>
            <button
              type="submit"
              className="friendship-primary"
              disabled={busy || relation.loading}
            >
              {busy ? '发送中…' : '发送申请'}
            </button>
          </div>
        </form>
      )}
      {removing && (
        <FriendRemovalDialog
          person={person}
          busy={busy}
          error={error}
          onCancel={() => setRemoving(false)}
          onConfirm={() => void mutate('remove')}
        />
      )}
    </section>
  );
}
