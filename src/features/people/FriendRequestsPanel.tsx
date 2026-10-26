import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Clock3, RefreshCw, UserRoundPlus } from 'lucide-react';
import { Link } from 'react-router';
import { apiErrorMessage } from '@/shared/api/client';
import { PlatformAvatar, PlatformError } from '@/features/platform/PlatformUi';
import { paths } from '@/shared/config/paths';
import { friendshipApi, friendshipsChanged } from './friendship-api';
import type { FriendRequest, RequestAction, RequestDirection } from './friendship-types';
import { useFriendshipList } from './useFriendshipList';

const requestKey = (request: FriendRequest) => request.id;
export default function FriendRequestsPanel({
  incoming,
  outgoing,
}: {
  incoming: number | null;
  outgoing: number | null;
}) {
  const [direction, setDirection] = useState<RequestDirection>('incoming');
  return (
    <section aria-label="好友申请">
      <div className="friendship-request-tabs" aria-label="申请方向">
        {(['incoming', 'outgoing'] as const).map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={direction === value}
            className={direction === value ? 'active' : ''}
            onClick={() => setDirection(value)}
          >
            {value === 'incoming' ? '收到' : '发出'}
            <small>{(value === 'incoming' ? incoming : outgoing) ?? '—'}</small>
          </button>
        ))}
      </div>
      <RequestResults
        key={direction}
        direction={direction}
        count={direction === 'incoming' ? incoming : outgoing}
      />
    </section>
  );
}

function RequestResults({
  direction,
  count,
}: {
  direction: RequestDirection;
  count: number | null;
}) {
  const load = useCallback(
    (offset: number, signal: AbortSignal) => friendshipApi.requests(direction, offset, signal),
    [direction],
  );
  const list = useFriendshipList(load, requestKey, 30000);
  const previousCount = useRef(count);
  const refresh = list.refresh;
  useEffect(() => {
    if (count !== null && count !== previousCount.current) {
      previousCount.current = count;
      refresh();
    }
  }, [count, refresh]);
  const [feedback, setFeedback] = useState({ error: '', message: '' });
  return (
    <>
      <div className="friendship-request-toolbar">
        <span>待处理 {list.total}</span>
        <button
          type="button"
          className="friendship-text-button"
          aria-label="刷新好友申请"
          disabled={list.loading}
          onClick={list.refresh}
        >
          <RefreshCw size={13} />
          刷新
        </button>
      </div>
      <PlatformError
        message={list.error || feedback.error}
        retry={list.error ? list.refresh : undefined}
      />
      {feedback.message && (
        <p className="friendship-feedback" role="status">
          <Check size={14} />
          {feedback.message}
        </p>
      )}
      {list.loading && !list.items.length ? (
        <p className="people-empty" role="status">
          正在读取申请…
        </p>
      ) : list.items.length ? (
        <div className="friendship-request-list">
          {list.items.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              direction={direction}
              onFeedback={setFeedback}
            />
          ))}
        </div>
      ) : (
        !list.error && (
          <div className="people-empty">
            {direction === 'incoming' ? (
              <UserRoundPlus size={30} strokeWidth={1.4} />
            ) : (
              <Clock3 size={30} strokeWidth={1.4} />
            )}
            <h2>{direction === 'incoming' ? '暂时没有待处理申请' : '暂时没有等待中的申请'}</h2>
            <p>
              {direction === 'incoming'
                ? '新的朋友向你发出邀请时，会出现在这里。'
                : '在成员资料中添加好友，等待对方确认。'}
            </p>
          </div>
        )
      )}
      {list.items.length < list.total && !list.error && (
        <button
          type="button"
          className="people-load-more"
          disabled={list.loading}
          onClick={list.more}
        >
          {list.loading ? '正在加载…' : '更多申请'}
        </button>
      )}
    </>
  );
}

function RequestCard({
  request,
  direction,
  onFeedback,
}: {
  request: FriendRequest;
  direction: RequestDirection;
  onFeedback: (value: { error: string; message: string }) => void;
}) {
  const person = direction === 'incoming' ? request.from : request.to;
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const active = useRef(true);
  const dispatching = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const respond = async (action: RequestAction) => {
    if (dispatching.current || completed) return;
    dispatching.current = true;
    setBusy(true);
    onFeedback({ error: '', message: '' });
    try {
      const result = await friendshipApi.respond(request.id, action);
      if (!active.current) return;
      const expected = { accept: 'accepted', decline: 'declined', cancel: 'cancelled' }[action];
      if (result.id !== request.id || result.status !== expected)
        throw new Error('申请状态尚未更新，请刷新后重试');
      setCompleted(true);
      onFeedback({
        error: '',
        message:
          action === 'accept'
            ? `已与 ${person.name} 成为好友`
            : action === 'decline'
              ? `已拒绝 ${person.name} 的申请`
              : `已撤销发给 ${person.name} 的申请`,
      });
      friendshipsChanged();
    } catch (caught) {
      if (active.current) onFeedback({ error: apiErrorMessage(caught), message: '' });
    } finally {
      dispatching.current = false;
      if (active.current) setBusy(false);
    }
  };
  return (
    <article className="friendship-request-card">
      <Link className="friendship-request-person" to={paths.user(person.handle)}>
        <PlatformAvatar user={person} />
        <span>
          <strong>{person.name}</strong>
          <small>@{person.handle}</small>
        </span>
        <time dateTime={request.createdAt}>
          {new Date(request.createdAt).toLocaleDateString('zh-CN', {
            month: 'numeric',
            day: 'numeric',
          })}
        </time>
      </Link>
      <p className="friendship-request-note">
        {request.note ||
          (direction === 'incoming'
            ? '想和你成为好友，一起发现更多共鸣。'
            : '等待对方确认好友申请。')}
      </p>
      <div className="friendship-request-actions">
        {direction === 'incoming' ? (
          <>
            <button
              type="button"
              className="friendship-secondary"
              disabled={busy || completed}
              onClick={() => void respond('decline')}
              aria-label={`拒绝${person.name}的申请`}
            >
              拒绝
            </button>
            <button
              type="button"
              className="friendship-primary"
              disabled={busy || completed}
              onClick={() => void respond('accept')}
              aria-label={`接受${person.name}的申请`}
            >
              {busy ? '处理中…' : '接受'}
            </button>
          </>
        ) : (
          <>
            <span>
              <Clock3 size={12} />
              等待验证
            </span>
            <button
              type="button"
              className="friendship-secondary"
              disabled={busy || completed}
              onClick={() => void respond('cancel')}
              aria-label={`撤销发给${person.name}的申请`}
            >
              {busy ? '处理中…' : '撤销申请'}
            </button>
          </>
        )}
      </div>
    </article>
  );
}
