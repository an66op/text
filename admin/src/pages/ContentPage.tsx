import { useState } from 'react';
import { Eye, FileText, MessageSquare, RefreshCw, ThumbsUp } from 'lucide-react';
import { api, errorMessage, queryString } from '../api';
import { dateTime, number, postStatusLabels, safeImageUrl } from '../format';
import type { Page, Post, PostStatus } from '../types';
import { PAGE_SIZE, useListParams } from '../use-list-params';
import { useResource } from '../use-resource';
import {
  Avatar,
  Badge,
  ConfirmAction,
  Dialog,
  Empty,
  ErrorState,
  Loading,
  Notice,
  PageHeading,
  Pagination,
  SearchForm,
} from '../ui';

function ContentDetail({
  post,
  onClose,
  onSaved,
}: {
  post: Post;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<PostStatus>(post.status);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (busy || status === post.status) return;
    setBusy(true);
    setError('');
    try {
      await api<Post>(`/admin/posts/${encodeURIComponent(post.id)}`, {
        method: 'PATCH',
        body: { status },
      });
      onSaved();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="内容审核"
      description={`内容 ID · ${post.id}`}
      onClose={onClose}
      busy={busy}
      wide
    >
      <div className="post-detail-author">
        <Avatar name={post.author.name} src={post.author.avatar} />
        <div>
          <strong>{post.author.name}</strong>
          <small>
            @{post.author.handle} · {dateTime(post.createdAt)}
          </small>
        </div>
        <Badge
          tone={
            post.status === 'published' ? 'good' : post.status === 'pending' ? 'warning' : 'neutral'
          }
        >
          {postStatusLabels[post.status]}
        </Badge>
      </div>
      {post.topic && <span className="topic-tag"># {post.topic}</span>}
      <p className="post-body">{post.body}</p>
      {post.images.some((src) => safeImageUrl(src)) && (
        <div className="post-image-grid">
          {post.images
            .filter((src) => safeImageUrl(src))
            .map((src, index) => (
              <a
                key={src + index}
                href={safeImageUrl(src)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <img src={safeImageUrl(src)} alt={`帖子图片 ${index + 1}`} loading="lazy" />
              </a>
            ))}
        </div>
      )}
      <div className="post-detail-stats">
        <span>
          <ThumbsUp size={15} />
          {number(post.likeCount)} 赞
        </span>
        <span>
          <MessageSquare size={15} />
          {number(post.commentCount)} 评论
        </span>
      </div>
      <div className="section-separator" />
      <label className="field">
        审核结果
        <select
          value={status}
          disabled={confirming}
          onChange={(event) => setStatus(event.target.value as PostStatus)}
        >
          <option value="published">已发布 · 社区可见</option>
          <option value="pending">待审核 · 暂不公开</option>
          <option value="hidden">已隐藏 · 暂不公开</option>
        </select>
      </label>
      <p className="field-hint">
        隐藏和待审核的内容不会出现在公开内容流。恢复发布后可重新被社区浏览。
      </p>
      {confirming ? (
        <ConfirmAction
          title="确认内容状态"
          description={`将这篇内容从「${postStatusLabels[post.status]}」改为「${postStatusLabels[status]}」。操作立即生效并记录审计。`}
          confirmLabel="确认审核"
          danger={status !== 'published'}
          busy={busy}
          error={error}
          onConfirm={() => void save()}
          onCancel={() => {
            setConfirming(false);
            setError('');
          }}
        />
      ) : (
        <div className="form-actions">
          <button className="button button-quiet" onClick={onClose}>
            关闭
          </button>
          <button
            className="button button-primary"
            disabled={status === post.status}
            onClick={() => setConfirming(true)}
          >
            检查并提交
          </button>
        </div>
      )}
    </Dialog>
  );
}

export default function ContentPage() {
  const { q, status, offset, detail, update } = useListParams();
  const { data, loading, error, reload } = useResource<Page<Post>>(
    `/admin/posts${queryString({ q, status, offset, limit: PAGE_SIZE })}`,
  );
  const [notice, setNotice] = useState('');
  const selected = data?.items.find((post) => post.id === detail);
  return (
    <>
      <PageHeading
        eyebrow="CONTENT"
        title="内容审核"
        description="完整阅读，再做判断。每一次可见性变更都有记录。"
        actions={
          <button className="button" onClick={reload} disabled={loading}>
            <RefreshCw size={16} />
            刷新
          </button>
        }
      />
      {notice && (
        <Notice tone="success" onDismiss={() => setNotice('')}>
          {notice}
        </Notice>
      )}
      <section className="panel">
        <div className="list-toolbar">
          <SearchForm
            value={q}
            placeholder="搜索内容、作者或话题"
            onSearch={(value) => update('q', value)}
          />
          <label className="single-filter">
            状态
            <select
              aria-label="筛选内容状态"
              value={status}
              onChange={(event) => update('status', event.target.value)}
            >
              <option value="">全部内容</option>
              <option value="pending">待审核</option>
              <option value="published">已发布</option>
              <option value="hidden">已隐藏</option>
            </select>
          </label>
        </div>
        <div className="list-summary">
          <span>内容队列</span>
          {data && <span>{number(data.total)} 篇内容</span>}
        </div>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : (
          data && (
            <>
              {data.items.length ? (
                <div className="table-scroll">
                  <table>
                    <caption className="sr-only">内容列表</caption>
                    <thead>
                      <tr>
                        <th>内容</th>
                        <th>作者</th>
                        <th>状态</th>
                        <th>互动</th>
                        <th>发布时间</th>
                        <th className="align-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((post) => (
                        <tr key={post.id}>
                          <td>
                            <div className="post-preview">
                              {safeImageUrl(post.images[0] || '') ? (
                                <img src={safeImageUrl(post.images[0])} alt="" />
                              ) : (
                                <span className="post-placeholder">
                                  <FileText size={19} />
                                </span>
                              )}
                              <div>
                                <strong>{post.body}</strong>
                                <small>
                                  {post.topic ? `# ${post.topic}` : '无话题'} · {post.images.length}{' '}
                                  张图片
                                </small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="user-cell compact">
                              <Avatar name={post.author.name} src={post.author.avatar} />
                              <div>
                                <strong>{post.author.name}</strong>
                                <small>@{post.author.handle}</small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <Badge
                              tone={
                                post.status === 'published'
                                  ? 'good'
                                  : post.status === 'pending'
                                    ? 'warning'
                                    : 'neutral'
                              }
                            >
                              {postStatusLabels[post.status]}
                            </Badge>
                          </td>
                          <td className="muted nowrap">
                            {post.likeCount} 赞 · {post.commentCount} 评
                          </td>
                          <td className="muted nowrap">{dateTime(post.createdAt)}</td>
                          <td className="align-right">
                            <button
                              className="row-button"
                              onClick={() => update('detail', post.id)}
                              aria-label={`审核 ${post.body.slice(0, 20)}`}
                            >
                              <Eye size={15} />
                              审核
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty icon={<FileText size={25} />} />
              )}
              <Pagination
                total={data.total}
                offset={offset}
                count={data.items.length}
                limit={PAGE_SIZE}
                onChange={(value) => update('offset', String(value))}
              />
            </>
          )
        )}
      </section>
      {selected && (
        <ContentDetail
          key={selected.id + selected.status}
          post={selected}
          onClose={() => update('detail', '')}
          onSaved={() => {
            setNotice('审核结果已保存，内容可见性已更新。');
            update('detail', '');
            reload();
          }}
        />
      )}
      {detail && data && !selected && !loading && (
        <Dialog title="未找到内容" onClose={() => update('detail', '')}>
          <Empty
            title="这篇内容不在当前列表"
            description="记录可能已变更或被删除，关闭详情并刷新列表后重试。"
          />
        </Dialog>
      )}
    </>
  );
}
