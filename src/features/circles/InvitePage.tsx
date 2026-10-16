import { useId, useRef, useState, type FormEvent } from 'react';
import { Copy, Link as LinkIcon, LockKeyhole, Users } from 'lucide-react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { useToast } from '@/shared/ui/useToast';
import { circlePaths } from './routes';
import { useCircles } from './useCircles';
import { CircleManageUnavailable } from './CircleManageUnavailable';
import type { Circle } from './types';

export function CircleInvitePage() {
  const { circleId = '' } = useParams();
  const { getCircle } = useCircles();
  const circle = getCircle(circleId);
  if (!circle) return <CircleManageUnavailable title="邀请成员" />;
  if (!circle.joined)
    return (
      <CircleManageUnavailable
        title="邀请成员"
        circleId={circleId}
        message="加入圈子后可以邀请朋友。"
      />
    );
  return <InviteContent key={circleId} circle={circle} />;
}

function InviteContent({ circle }: { circle: Circle }) {
  const notify = useToast();
  const linkInput = useRef<HTMLTextAreaElement>(null);
  const [copyHint, setCopyHint] = useState('');
  const inviteUrl = new URL(circlePaths.join(circle.id), window.location.origin);
  inviteUrl.searchParams.set('code', circle.inviteCode);
  const url = inviteUrl.toString();
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      setCopyHint('邀请链接已复制');
      notify('邀请链接已复制');
    } catch {
      linkInput.current?.focus();
      linkInput.current?.select();
      linkInput.current?.setSelectionRange(0, url.length);
      setCopyHint('链接已选中，请长按复制，或按 ⌘C / Ctrl+C。');
    }
  };
  return (
    <div className="circle-page circle-manage-page">
      <PageHeader title="邀请成员" backTo={circlePaths.home(circle.id)} />
      <div className="circle-page-body">
        <section className="circle-invite-identity">
          <span>{circle.icon}</span>
          <h1>{circle.name}</h1>
          <p>
            <Users size={15} />
            {circle.memberCount} 位成员
            {circle.visibility === 'invite' && (
              <>
                <span>·</span>
                <LockKeyhole size={14} />
                邀请加入
              </>
            )}
          </p>
        </section>
        <section className="circle-manage-card circle-invite-card">
          <span className="circle-invite-link-icon">
            <LinkIcon size={24} />
          </span>
          <h2>邀请链接</h2>
          <p>朋友可以通过链接查看圈子并加入。</p>
          <textarea
            ref={linkInput}
            className="field circle-invite-url"
            aria-label="邀请链接"
            readOnly
            value={url}
            rows={3}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button className="primary circle-manage-submit" onClick={() => void copy()}>
            <Copy size={18} />
            复制邀请链接
          </button>
          {copyHint && (
            <p className="circle-copy-hint" role="status">
              {copyHint}
            </p>
          )}
        </section>
        <section className="circle-manage-card circle-invite-code">
          <div>
            <h2>邀请码</h2>
            <p>也可以在加入页面填写此邀请码。</p>
          </div>
          <strong>{circle.inviteCode}</strong>
        </section>
        <Link className="circle-back-link" to={circlePaths.home(circle.id)}>
          返回圈子
        </Link>
      </div>
    </div>
  );
}

export function CircleJoinPage() {
  const { circleId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const { getCircle } = useCircles();
  const circle = getCircle(circleId);
  if (!circle)
    return (
      <CircleManageUnavailable title="加入圈子" message="这个圈子不存在，邀请链接可能已经失效。" />
    );
  if (circle.joined) return <Navigate to={circlePaths.home(circleId)} replace />;
  return (
    <JoinContent
      key={`${circleId}:${searchParams.toString()}`}
      circle={circle}
      initialCode={searchParams.get('code') || ''}
    />
  );
}

function JoinContent({ circle, initialCode }: { circle: Circle; initialCode: string }) {
  const { joinCircle } = useCircles();
  const navigate = useNavigate();
  const notify = useToast();
  const fieldId = useId();
  const [code, setCode] = useState(initialCode);
  const invalidInitialCode =
    initialCode.trim() && initialCode.trim().toUpperCase() !== circle.inviteCode.toUpperCase();
  const [error, setError] = useState(
    invalidInitialCode ? '邀请链接中的邀请码无效，请检查后重试。' : '',
  );
  const [joining, setJoining] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const candidate = code.trim().toUpperCase();
    if (circle.visibility === 'invite' && !candidate) {
      setError('请输入邀请码。');
      return;
    }
    if (candidate && candidate !== circle.inviteCode.toUpperCase()) {
      setError('邀请码无效，请检查后重试。');
      return;
    }
    setJoining(true);
    try {
      joinCircle(circle.id, candidate || undefined);
      notify(`已加入${circle.name}`);
      navigate(circlePaths.home(circle.id), { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '加入失败，请重试。');
      setJoining(false);
    }
  };
  return (
    <div className="circle-page circle-manage-page">
      <PageHeader title="加入圈子" backTo={circlePaths.home(circle.id)} />
      <div className="circle-page-body">
        <div className="circle-join-cover" style={{ backgroundImage: `url(${circle.cover})` }}>
          <span>{circle.icon}</span>
        </div>
        <section className="circle-join-intro">
          <span className="circle-join-category">{circle.category}</span>
          <h1>{circle.name}</h1>
          <p>{circle.description}</p>
          <div>
            <Users size={16} />
            {circle.memberCount} 位成员<span>·</span>
            <i />
            {circle.onlineCount} 在线
          </div>
        </section>
        <form className="circle-manage-card circle-join-form" onSubmit={submit}>
          <h2>{circle.visibility === 'invite' ? '使用邀请码加入' : '加入公开圈子'}</h2>
          <p>
            {circle.visibility === 'invite'
              ? '这个圈子需要有效的邀请码。'
              : '加入后即可参与圈子内的聊天、讨论与活动。'}
          </p>
          <label className="circle-manage-label" htmlFor={`${fieldId}-code`}>
            邀请码{circle.visibility === 'public' && <small>（选填）</small>}
          </label>
          <input
            id={`${fieldId}-code`}
            className="field circle-code-input"
            value={code}
            maxLength={64}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder={circle.visibility === 'invite' ? '输入邀请码' : '公开圈子无需邀请码'}
            onChange={(event) => {
              setCode(event.target.value);
              setError('');
            }}
          />
          {error && (
            <p className="circle-manage-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary circle-manage-submit"
            disabled={joining || (circle.visibility === 'invite' && !code.trim())}
          >
            {joining ? '正在加入…' : '加入圈子'}
          </button>
          {circle.visibility === 'public' && code && (
            <button
              className="circle-back-link"
              type="button"
              onClick={() => {
                setCode('');
                setError('');
              }}
            >
              清除邀请码，直接加入
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
