import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { PlatformError } from '../PlatformUi';
import { circlesApi } from './api';
import type { Circle, JoinResult } from './types';
import { circlePaths } from './paths';
import { useMutation } from './useMutation';
import { useResource } from './useResource';
import { AuthGate } from './Ui';
export default function JoinPage() {
  const location = useLocation();
  return (
    <AuthGate title="加入圈子">
      <Join key={`${location.pathname}:${location.hash}`} />
    </AuthGate>
  );
}
function Join() {
  const { circleId = '' } = useParams(),
    location = useLocation(),
    navigate = useNavigate();
  const initialToken = new URLSearchParams(location.hash.slice(1)).get('invite') || '';
  const [token, setToken] = useState(initialToken),
    [note, setNote] = useState(''),
    [preview, setPreview] = useState<Circle | null>(null),
    [joined, setJoined] = useState<JoinResult | null>(null);
  const circle = useResource(circleId, (signal) => circlesApi.circle(circleId, signal));
  const mutation = useMutation();
  const value = preview || circle.data;
  return (
    <section className="platform-page sc-page">
      <PageHeader title="加入圈子" backTo={circlePaths.home(circleId)} />
      <div className="sc-content">
        {value ? (
          <div className="sc-join-intro">
            <span>{value.icon || '✦'}</span>
            <h1>{value.name}</h1>
            <p>{value.description}</p>
            <small>
              {value.memberCount} 位成员 ·{' '}
              {value.joinPolicy === 'approval' ? '审核加入' : '直接加入'}
            </small>
          </div>
        ) : (
          <p className="sc-muted">私密圈子请先使用邀请预览介绍。有效邀请也仍遵守圈方的审核规则。</p>
        )}
        {!value && !initialToken && <PlatformError message={circle.error} retry={circle.refresh} />}
        <PlatformError message={mutation.error} />
        {value && value.status !== 'active' && (
          <p className="sc-notice">
            {value.status === 'archived'
              ? '圈子已归档，暂不接受加入。'
              : '圈子已暂停，暂不接受加入。'}
          </p>
        )}
        {value?.membership === 'banned' && (
          <p className="sc-notice">当前账号已被圈方封禁，邀请不能绕过此限制。</p>
        )}
        {joined?.status === 'pending' || value?.membership === 'pending' ? (
          <div className="sc-notice" role="status">
            <h2>申请已提交，等待圈方审核</h2>
            <p>申请取消不会退还已使用的邀请次数。</p>
            <Link to="/circles?tab=requests">查看我的申请</Link>
          </div>
        ) : value?.membership === 'active' ? (
          <Link className="sc-primary" to={circlePaths.home(circleId)}>
            已加入，进入圈子
          </Link>
        ) : (
          <form
            className="sc-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!value || value.membership === 'banned' || value.status !== 'active') return;
              const result = await mutation.run((signal) =>
                circlesApi.join(
                  circleId,
                  { note: note.trim(), ...(token.trim() ? { inviteToken: token.trim() } : {}) },
                  signal,
                ),
              );
              if (result) {
                if (result.status === 'joined')
                  navigate(circlePaths.home(circleId), { replace: true });
                else setJoined(result);
              }
            }}
          >
            <label>
              邀请凭证{value?.visibility !== 'private' && '（可选）'}
              <input
                autoComplete="off"
                maxLength={200}
                value={token}
                disabled={mutation.busy}
                onChange={(event) => {
                  setToken(event.target.value);
                  setPreview(null);
                }}
                placeholder="邀请链接中的凭证"
              />
            </label>
            <button
              className="sc-secondary"
              type="button"
              disabled={mutation.busy || !token.trim()}
              onClick={async () => {
                const next = await mutation.run(async (signal) => {
                  const result = await circlesApi.previewInvite(token.trim(), signal);
                  if (result.id !== circleId)
                    throw new Error('邀请属于其它圈子，请使用完整的原邀请链接');
                  return result;
                });
                if (next) setPreview(next);
              }}
            >
              预览邀请
            </button>
            <label>
              申请说明
              <textarea
                maxLength={300}
                rows={3}
                value={note}
                disabled={mutation.busy}
                onChange={(event) => setNote(event.target.value)}
                placeholder="介绍一下自己与共同兴趣"
              />
            </label>
            <button
              className="sc-primary"
              type="submit"
              disabled={
                mutation.busy ||
                !value ||
                value.membership === 'banned' ||
                value.status !== 'active' ||
                (value.visibility === 'private' && !token.trim())
              }
            >
              {mutation.busy
                ? '正在提交…'
                : value?.membership === 'banned'
                  ? '当前账号已被封禁'
                  : value?.joinPolicy === 'approval'
                    ? '提交入圈申请'
                    : '加入圈子'}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
