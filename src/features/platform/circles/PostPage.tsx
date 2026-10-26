import { useState } from 'react';
import { Heart, Pin, Sparkles } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import ActionDialog from '@/shared/ui/ActionDialog';
import { useAuth } from '../useAuth';
import { PlatformAvatar, PlatformError } from '../PlatformUi';
import { shortTime } from '../platform-format';
import CirclePage from './CirclePage';
import { circlesApi } from './api';
import { useCircle } from './circle-context';
import { circlePaths } from './paths';
import { isManager, type Post } from './types';
import { useMutation } from './useMutation';
import { useResource } from './useResource';
import { PostImages } from './Feed';
import { Empty, Pagination } from './Ui';

export default function PostPage() {
  return (
    <CirclePage title="帖子">
      <PostContent />
    </CirclePage>
  );
}
function PostContent() {
  const { circle, deny } = useCircle(),
    auth = useAuth(),
    navigate = useNavigate();
  const { postId = '' } = useParams();
  const [comment, setComment] = useState(''),
    [reason, setReason] = useState(''),
    [reporting, setReporting] = useState(false),
    [removing, setRemoving] = useState(false),
    [notice, setNotice] = useState(''),
    [page, setPage] = useState(0);
  const post = useResource(postId, (signal) => circlesApi.post(circle.id, postId, signal), deny);
  const channels = useResource(circle.id, (signal) => circlesApi.channels(circle.id, signal), deny);
  const comments = useResource(
    `${postId}:${page}`,
    (signal) => circlesApi.comments(circle.id, postId, { limit: 20, offset: page * 20 }, signal),
    deny,
    post.data?.status === 'published',
  );
  const mutation = useMutation(deny),
    value = post.data;
  if (!value)
    return (
      <>
        <PlatformError message={post.error} retry={post.refresh} />
        {post.loading && <Empty>正在读取帖子…</Empty>}
      </>
    );
  const channel = channels.data?.items.find((item) => item.id === value.channelId);
  const writable = circle.status === 'active' && !!channel && !channel.archived;
  const interact = writable && value.status === 'published';
  const manage = async (change: Partial<Pick<Post, 'status' | 'featured' | 'pinned'>>) => {
    const next = await mutation.run((signal) =>
      circlesApi.updatePost(circle.id, postId, change, signal),
    );
    if (next) {
      post.replace(next);
      setNotice('帖子状态已由服务器更新');
    }
  };
  return (
    <>
      <div className="sc-post-context">
        <Link to={circlePaths.channel(circle.id, value.channelId)}>
          #{channel?.name || '所属频道'}
        </Link>
        {value.featured && (
          <span>
            <Sparkles size={12} />
            精华
          </span>
        )}
        {value.pinned && (
          <span>
            <Pin size={12} />
            置顶
          </span>
        )}
      </div>
      {value.status !== 'published' && (
        <p className="sc-notice">
          {value.status === 'pending'
            ? '此帖正在等待圈方审核，仅作者与圈管理可见。'
            : '此帖已隐藏，仅作者与圈管理可见。'}
        </p>
      )}
      {channel?.archived && <p className="sc-notice">频道已归档，内容仅供阅读。</p>}
      <article className="sc-post-detail">
        <div className="sc-host">
          <PlatformAvatar user={value.author} />
          <div>
            <strong>{value.author.name}</strong>
            <small>{shortTime(value.createdAt)}</small>
          </div>
        </div>
        <h1>{value.title}</h1>
        <p>{value.body}</p>
        <PostImages images={value.images} />
        {interact && (
          <div className="sc-post-actions">
            <button
              type="button"
              aria-label={value.liked ? '取消点赞' : '点赞'}
              aria-pressed={value.liked}
              disabled={mutation.busy}
              onClick={async () => {
                const next = await mutation.run((signal) =>
                  circlesApi.like(circle.id, postId, !value.liked, signal),
                );
                if (next) post.replace(next);
              }}
            >
              <Heart size={18} fill={value.liked ? 'currentColor' : 'none'} />
              {value.likeCount} 人喜欢
            </button>
            <span>{value.commentCount} 条评论</span>
            <button type="button" onClick={() => setReporting((open) => !open)}>
              举报
            </button>
          </div>
        )}
      </article>
      <PlatformError message={mutation.error || post.error || channels.error} />
      {notice && (
        <p className="sc-success" role="status">
          {notice}
        </p>
      )}
      {isManager(circle) && writable && (
        <section className="sc-management-tools" aria-label="帖子治理">
          <strong>帖子管理</strong>
          <div>
            <button disabled={mutation.busy} onClick={() => void manage({ status: 'published' })}>
              审核发布
            </button>
            <button disabled={mutation.busy} onClick={() => void manage({ status: 'hidden' })}>
              隐藏帖子
            </button>
            <button
              disabled={mutation.busy}
              onClick={() => void manage({ featured: !value.featured })}
            >
              {value.featured ? '取消精华' : '设为精华'}
            </button>
            <button disabled={mutation.busy} onClick={() => void manage({ pinned: !value.pinned })}>
              {value.pinned ? '取消置顶' : '置顶帖子'}
            </button>
          </div>
        </section>
      )}
      {(value.author.id === auth.user?.id || isManager(circle)) && (
        <button
          type="button"
          className="sc-danger sc-delete-post"
          onClick={() => setRemoving(true)}
        >
          删除帖子
        </button>
      )}
      {reporting && interact && (
        <form
          className="sc-form sc-card"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!reason.trim()) return;
            const result = await mutation.run((signal) =>
              circlesApi.report(postId, reason.trim(), signal),
            );
            if (result) {
              setReporting(false);
              setNotice('举报已提交，等待平台核查');
            }
          }}
        >
          <label>
            举报原因
            <textarea
              required
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button disabled={mutation.busy || !reason.trim()} className="sc-primary">
            提交举报
          </button>
        </form>
      )}
      {value.status === 'published' && (
        <section className="sc-comments" id="comments">
          <h2>一起聊聊</h2>
          <PlatformError message={comments.error} retry={comments.refresh} />
          {comments.loading ? (
            <Empty>正在读取评论…</Empty>
          ) : comments.data?.items.length ? (
            comments.data.items.map((entry) => (
              <article key={entry.id}>
                <PlatformAvatar user={entry.author} />
                <div>
                  <strong>{entry.author.name}</strong>
                  <p>{entry.body}</p>
                  <small>{shortTime(entry.createdAt)}</small>
                </div>
              </article>
            ))
          ) : (
            !comments.error && <Empty>还没有评论，留下第一句回应。</Empty>
          )}
          <Pagination
            page={page}
            total={comments.data?.total ?? 0}
            disabled={comments.loading}
            onPage={setPage}
          />
          {interact && (
            <form
              className="sc-comment-compose"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!comment.trim()) return;
                if (
                  await mutation.run((signal) =>
                    circlesApi.comment(circle.id, postId, comment.trim(), signal),
                  )
                ) {
                  setComment('');
                  comments.refresh();
                  post.refresh();
                }
              }}
            >
              <input
                aria-label="圈帖评论内容"
                maxLength={2000}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="友善交流，分享想法…"
              />
              <button type="submit" disabled={mutation.busy || !comment.trim()}>
                发送
              </button>
            </form>
          )}
        </section>
      )}
      {removing && (
        <ActionDialog
          title={`删除「${value.title}」？`}
          confirmLabel="确认删除帖子"
          busy={mutation.busy}
          danger
          onClose={() => setRemoving(false)}
          onConfirm={async () => {
            const result = await mutation.run((signal) =>
              circlesApi.deletePost(circle.id, postId, signal),
            );
            if (result?.ok) navigate(circlePaths.home(circle.id), { replace: true });
          }}
        >
          <p>将删除这篇帖子和评论，并释放图片引用。图片文件仍可在“我的上传”管理。</p>
          <PlatformError message={mutation.error} />
        </ActionDialog>
      )}
    </>
  );
}
