import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  CircleDot,
  Eye,
  FileText,
  LockKeyhole,
  MessageSquare,
  RefreshCw,
  ThumbsUp,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { accountEpoch, expectedAccount } from '../../../src/shared/api/account-guard';
import { hostedImageId } from '../../../src/shared/api/media-url';
import { api, errorMessage, queryString } from '../api';
import {
  circlePostStatusLabels,
  circleStatusLabels,
  dateTime,
  number,
  safeImageUrl,
} from '../format';
import type { AdminCircle, AdminCirclePost, Page, PostStatus } from '../types';
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
import CircleGovernanceTabs from './CircleGovernanceTabs';

function useGovernanceMutation<T>(path: string, onSaved: (value: T) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);
  const save = async (status: string, note: string) => {
    if (request.current || !note.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    const account = expectedAccount(),
      epoch = accountEpoch();
    const current = () =>
      active.current && account === expectedAccount() && epoch === accountEpoch();
    setBusy(true);
    setError('');
    try {
      const result = await api<T>(path, {
        method: 'PATCH',
        body: { status, note: note.trim() },
        signal: controller.signal,
      });
      if (current()) onSaved(result);
    } catch (error) {
      if (active.current)
        setError(
          current() ? errorMessage(error) : '登录会话已变化，请重新验证并刷新记录后再操作。',
        );
    } finally {
      request.current = null;
      if (active.current) setBusy(false);
    }
  };
  return { busy, error, save, clearError: () => setError('') };
}

function GovernanceForm({
  label,
  initial,
  options,
  title,
  describe,
  busy,
  error,
  onSave,
  onCancel,
  clearError,
}: {
  label: string;
  initial: string;
  options: { value: string; label: string }[];
  title: string;
  describe: (status: string) => string;
  busy: boolean;
  error: string;
  onSave: (status: string, note: string) => void;
  onCancel: () => void;
  clearError: () => void;
}) {
  const [status, setStatus] = useState(initial);
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <label className="field">
        {label}
        <select
          value={status}
          disabled={confirming}
          onChange={(event) => setStatus(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        处理说明 <span className="required">必填</span>
        <textarea
          value={note}
          disabled={confirming}
          rows={4}
          maxLength={1000}
          onChange={(event) => setNote(event.target.value)}
          placeholder="记录核实依据、处置原因与后续处理要求。"
        />
        <small className="character-count">{note.length} / 1000</small>
      </label>
      <p className="field-hint">可保留原状态补充说明；每次提交均保存说明并记录平台审计。</p>
      {confirming ? (
        <ConfirmAction
          title={title}
          description={describe(status)}
          confirmLabel="确认保存处理结果"
          danger={status === 'suspended' || status === 'hidden'}
          busy={busy}
          error={error}
          onConfirm={() => onSave(status, note)}
          onCancel={() => {
            setConfirming(false);
            clearError();
          }}
        />
      ) : (
        <div className="form-actions">
          <button className="button button-quiet" onClick={onCancel}>
            关闭
          </button>
          <button
            className="button button-primary"
            disabled={!note.trim()}
            onClick={() => setConfirming(true)}
          >
            检查处理结果
          </button>
        </div>
      )}
    </>
  );
}

function PreviousNote({ children }: { children: ReactNode }) {
  return (
    <div className="circle-previous-note">
      <h3>最近平台处理说明</h3>
      <p>{children || '尚无平台处理说明'}</p>
    </div>
  );
}

function CircleDetail({
  circle,
  onClose,
  onSaved,
}: {
  circle: AdminCircle;
  onClose: () => void;
  onSaved: (circle: AdminCircle) => void;
}) {
  const { busy, error, save, clearError } = useGovernanceMutation(
    `/admin/circles/${encodeURIComponent(circle.id)}`,
    onSaved,
  );
  const cover = safeImageUrl(circle.cover);
  return (
    <Dialog
      title="圈子治理详情"
      description={`圈子 ID · ${circle.id}`}
      onClose={onClose}
      busy={busy}
      wide
    >
      {cover && <img className="circle-cover" src={cover} alt={`${circle.name}封面`} />}
      <div className="circle-detail-title">
        <span className="circle-icon">{circle.icon || <CircleDot size={24} />}</span>
        <div>
          <h3>{circle.name}</h3>
          <p>{circle.category || '未分类'}</p>
        </div>
        <Badge
          tone={
            circle.status === 'suspended'
              ? 'danger'
              : circle.status === 'active'
                ? 'good'
                : 'neutral'
          }
        >
          {circleStatusLabels[circle.status]}
        </Badge>
      </div>
      <p className="circle-description">{circle.description || '暂无圈子介绍'}</p>
      <dl className="detail-grid">
        <div>
          <dt>圈主</dt>
          <dd>
            <div className="user-cell compact">
              <Avatar name={circle.owner.name} src={circle.owner.avatar} />
              <div>
                <strong>{circle.owner.name}</strong>
                <small>@{circle.owner.handle}</small>
              </div>
            </div>
          </dd>
        </div>
        <div>
          <dt>圈主 ID</dt>
          <dd className="mono break-all">{circle.owner.id}</dd>
        </div>
        <div>
          <dt>圈子可见性</dt>
          <dd>
            {circle.visibility === 'private'
              ? '私密圈子 · 介绍受邀请与成员权限限制'
              : '公开圈子 · 公开介绍，正文仍需成员权限'}
          </dd>
        </div>
        <div>
          <dt>加入策略</dt>
          <dd>
            {circle.visibility === 'private' ? '有效邀请后，' : ''}
            {circle.joinPolicy === 'approval' ? '提交申请审核' : '直接加入'}
          </dd>
        </div>
        <div>
          <dt>成员 / 频道 / 帖子</dt>
          <dd>
            {number(circle.memberCount)} 位成员 · {number(circle.channelCount)} 个频道 ·{' '}
            {number(circle.postCount)} 篇帖子
          </dd>
        </div>
        <div>
          <dt>创建时间</dt>
          <dd>{dateTime(circle.createdAt)}</dd>
        </div>
        <div>
          <dt>最近更新</dt>
          <dd>{dateTime(circle.updatedAt)}</dd>
        </div>
      </dl>
      <div className="circle-detail-links">
        <Link className="button" to={`/circles/posts?circleId=${encodeURIComponent(circle.id)}`}>
          审核圈内帖子 <ArrowUpRight size={15} />
        </Link>
        <Link className="button" to={`/circles/events?circleId=${encodeURIComponent(circle.id)}`}>
          审核圈内活动 <ArrowUpRight size={15} />
        </Link>
        <Link className="text-link" to={`/audit?q=${encodeURIComponent(circle.id)}`}>
          查看治理审计 <ArrowUpRight size={14} />
        </Link>
      </div>
      <PreviousNote>{circle.moderationNote}</PreviousNote>
      <div className="section-separator" />
      <Notice tone="info">
        这是平台独立治理入口。运营身份不授予圈内成员、管理员或圈主权限；恢复圈子不会修改成员关系，也不会自动发布待审核或隐藏帖子。
      </Notice>
      {circle.status === 'archived' ? (
        <>
          <Notice tone="info">
            圈主已归档此圈子，平台治理只读。暂停与归档是不同状态，不能通过平台恢复解除归档。
          </Notice>
          <div className="form-actions">
            <button className="button" onClick={onClose}>
              关闭
            </button>
          </div>
        </>
      ) : (
        <GovernanceForm
          label="圈子状态"
          initial={circle.status}
          options={[
            { value: 'active', label: '正常 · 允许成员按权限访问' },
            { value: 'suspended', label: '暂停 · 停止普通圈内内容访问' },
          ]}
          title="确认圈子治理"
          describe={(status) =>
            `圈子「${circle.name}」（${circle.id}）从「${circleStatusLabels[circle.status]}」保存为「${circleStatusLabels[status as 'active' | 'suspended']}」。${status === 'suspended' ? '普通端将不能读取频道、帖子、评论及他人的圈内图片，平台审核入口仍可查看。' : '只恢复按当前成员及频道权限访问，不自动加入成员或发布帖子。'}处理说明一并记录审计。`
          }
          busy={busy}
          error={error}
          onSave={(status, note) => void save(status, note)}
          onCancel={onClose}
          clearError={clearError}
        />
      )}
    </Dialog>
  );
}

export default function CirclesPage() {
  const { q, status, offset, detail, update } = useListParams();
  const { data, loading, error, reload } = useResource<Page<AdminCircle>>(
    `/admin/circles${queryString({ q, status, offset, limit: PAGE_SIZE })}`,
  );
  const [notice, setNotice] = useState('');
  const selected = data?.items.find((circle) => circle.id === detail);
  return (
    <>
      <PageHeading
        eyebrow="CIRCLE GOVERNANCE"
        title="圈子治理"
        description="通过独立运营权限核实圈子状态、处置依据与内容边界。"
        actions={
          <button className="button" disabled={loading} onClick={reload}>
            <RefreshCw size={16} />
            刷新
          </button>
        }
      />
      <CircleGovernanceTabs />
      <Notice tone="info">
        平台治理可查看公开与私密圈子的运营记录。进入此页面不会加入圈子，也不会获得普通圈内接口权限。
      </Notice>
      {notice && (
        <Notice tone="success" onDismiss={() => setNotice('')}>
          {notice}
        </Notice>
      )}
      <section className="panel">
        <div className="list-toolbar">
          <SearchForm
            value={q}
            placeholder="搜索圈子名称、ID 或圈主标识"
            onSearch={(value) => update('q', value)}
          />
          <label className="single-filter">
            状态
            <select
              aria-label="筛选圈子状态"
              value={status}
              onChange={(event) => update('status', event.target.value)}
            >
              <option value="">全部圈子</option>
              <option value="active">正常</option>
              <option value="suspended">已暂停</option>
              <option value="archived">已归档</option>
            </select>
          </label>
        </div>
        <div className="list-summary">
          <span>平台圈子目录</span>
          {data && <span>{number(data.total)} 个圈子</span>}
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
                    <caption className="sr-only">圈子治理列表</caption>
                    <thead>
                      <tr>
                        <th>圈子</th>
                        <th>圈主</th>
                        <th>状态</th>
                        <th>成员 / 频道</th>
                        <th>可见性 / 加入</th>
                        <th>创建时间</th>
                        <th className="align-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((circle) => (
                        <tr key={circle.id}>
                          <td>
                            <div className="circle-cell">
                              <span className="circle-icon">
                                {circle.icon || <CircleDot size={20} />}
                              </span>
                              <div>
                                <strong>{circle.name}</strong>
                                <small className="mono">{circle.id}</small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="user-cell compact">
                              <Avatar name={circle.owner.name} src={circle.owner.avatar} />
                              <div>
                                <strong>{circle.owner.name}</strong>
                                <small>@{circle.owner.handle}</small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <Badge
                              tone={
                                circle.status === 'suspended'
                                  ? 'danger'
                                  : circle.status === 'active'
                                    ? 'good'
                                    : 'neutral'
                              }
                            >
                              {circleStatusLabels[circle.status]}
                            </Badge>
                          </td>
                          <td className="nowrap muted">
                            {number(circle.memberCount)} 人 · {number(circle.channelCount)} 频道
                          </td>
                          <td>
                            <div className="stacked-cell">
                              <span>
                                {circle.visibility === 'private' ? '私密圈子' : '公开介绍'}
                              </span>
                              <small>
                                {circle.joinPolicy === 'approval' ? '申请审核' : '直接加入'}
                                {circle.visibility === 'private' ? ' · 需邀请' : ''}
                              </small>
                            </div>
                          </td>
                          <td className="muted nowrap">{dateTime(circle.createdAt)}</td>
                          <td className="align-right">
                            <button
                              className="row-button"
                              onClick={() => update('detail', circle.id)}
                              aria-label={`治理圈子 ${circle.name}`}
                            >
                              <Eye size={15} />
                              {circle.status === 'archived' ? '查看' : '治理'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  icon={<CircleDot size={25} />}
                  description="暂无符合条件的服务端圈子，可调整状态或搜索词。"
                />
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
      {selected && !loading && !error && (
        <CircleDetail
          key={`${selected.id}:${selected.updatedAt}`}
          circle={selected}
          onClose={() => update('detail', '')}
          onSaved={(circle) => {
            setNotice(`圈子治理已保存为「${circleStatusLabels[circle.status]}」，说明已记录审计。`);
            update('detail', '');
            reload();
          }}
        />
      )}
      {detail && data && !selected && !loading && !error && (
        <Dialog title="未找到圈子" onClose={() => update('detail', '')}>
          <Empty
            title="此圈子不在当前列表"
            description="记录可能已变更或被当前筛选隐藏，请关闭详情并调整筛选或刷新。"
          />
        </Dialog>
      )}
    </>
  );
}

function CirclePostDetail({
  post,
  onClose,
  onSaved,
}: {
  post: AdminCirclePost;
  onClose: () => void;
  onSaved: (post: AdminCirclePost) => void;
}) {
  const { busy, error, save, clearError } = useGovernanceMutation(
    `/admin/circle-posts/${encodeURIComponent(post.id)}`,
    onSaved,
  );
  const mediaIds = Array.from(new Set(post.images.map(hostedImageId).filter(Boolean)));
  return (
    <Dialog
      title="圈帖审核详情"
      description={`圈帖 ID · ${post.id}`}
      onClose={onClose}
      busy={busy}
      wide
    >
      <Notice tone="info">
        当前通过平台审核权限读取圈帖，包括私密圈子与管理频道内容。此视图不代表你是圈内成员；「圈内已发布」也不授予世界或匿名访问。
      </Notice>
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
          {circlePostStatusLabels[post.status]}
        </Badge>
      </div>
      <div className="circle-post-origin">
        <Link
          to={`/circles?q=${encodeURIComponent(post.circleId)}&detail=${encodeURIComponent(post.circleId)}`}
        >
          {post.circleName} <ArrowUpRight size={13} />
        </Link>
        <span> / {post.channelName}</span>
        {post.pinned && <Badge>置顶</Badge>}
        {post.featured && <Badge tone="purple">精华</Badge>}
      </div>
      <h3 className="circle-post-title">{post.title}</h3>
      <p className="post-body">{post.body}</p>
      <div className="post-image-grid">
        {post.images
          .filter((src) => safeImageUrl(src))
          .map((src, index) => (
            <a
              key={`${src}:${index}`}
              href={safeImageUrl(src)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <img src={safeImageUrl(src)} alt={`圈帖图片 ${index + 1}`} loading="lazy" />
            </a>
          ))}
      </div>
      {mediaIds.length > 0 && (
        <div className="content-media-links">
          {mediaIds.map((id, index) => (
            <Link
              key={id}
              className="text-link"
              to={`/media?q=${encodeURIComponent(id)}&detail=${encodeURIComponent(id)}`}
            >
              管理圈内图片 {index + 1}
            </Link>
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
      <dl className="detail-grid">
        <div>
          <dt>圈子 ID</dt>
          <dd className="mono break-all">{post.circleId}</dd>
        </div>
        <div>
          <dt>频道 ID</dt>
          <dd className="mono break-all">{post.channelId}</dd>
        </div>
        <div>
          <dt>最近更新</dt>
          <dd>{dateTime(post.updatedAt)}</dd>
        </div>
      </dl>
      <PreviousNote>{post.moderationNote}</PreviousNote>
      <div className="section-separator" />
      <Notice tone="info">
        发布前服务端会重新检查圈子、频道与绑定图片。暂停或归档圈不能发布新内容；公告频道仅圈主或圈管理员发布主帖，已发布公告可由当前有权限的成员点赞、评论。
      </Notice>
      <GovernanceForm
        label="圈帖状态"
        initial={post.status}
        options={[
          { value: 'published', label: '圈内已发布 · 按成员及频道权限读取' },
          { value: 'pending', label: '待审核 · 暂不向其他成员展示' },
          { value: 'hidden', label: '隐藏 · 暂不向其他成员展示' },
        ]}
        title="确认圈帖审核"
        describe={(status) =>
          `圈帖「${post.title || post.id}」（${post.id}），位于「${post.circleName} / ${post.channelName}」，从「${circlePostStatusLabels[post.status]}」保存为「${circlePostStatusLabels[status as PostStatus]}」。${status === 'published' ? '仅恢复当前成员和频道权限下的可见性，不是公开到世界；服务端会重查圈子、频道和图片状态。' : '暂不向其他普通成员展示，平台审核仍可查看。'}说明一并记录平台审计。`
        }
        busy={busy}
        error={error}
        onSave={(status, note) => void save(status, note)}
        onCancel={onClose}
        clearError={clearError}
      />
    </Dialog>
  );
}

export function CirclePostsPage() {
  const { q, status, offset, detail, update } = useListParams();
  const [params] = useSearchParams();
  const circleId = params.get('circleId') || '';
  const { data, loading, error, reload } = useResource<Page<AdminCirclePost>>(
    `/admin/circle-posts${queryString({ circleId, status, q, offset, limit: PAGE_SIZE })}`,
  );
  const [notice, setNotice] = useState('');
  const selected = data?.items.find((post) => post.id === detail);
  return (
    <>
      <PageHeading
        eyebrow="CIRCLE CONTENT"
        title="圈帖审核"
        description="核实圈内内容，保留独立的平台处置依据。"
        actions={
          <button className="button" onClick={reload} disabled={loading}>
            <RefreshCw size={16} />
            刷新
          </button>
        }
      />
      <CircleGovernanceTabs />
      <Notice tone="info">
        <LockKeyhole size={14} />{' '}
        以平台运营权限查看圈帖，范围包含私密圈子与管理频道。平台身份不会自动成为圈子成员，已发布圈帖仍受成员与频道权限控制。
      </Notice>
      {notice && (
        <Notice tone="success" onDismiss={() => setNotice('')}>
          {notice}
        </Notice>
      )}
      <section className="panel">
        <div className="list-toolbar circle-toolbar">
          <SearchForm
            value={q}
            placeholder="搜索圈帖标题、正文、ID 或作者"
            onSearch={(value) => update('q', value)}
          />
          <label className="single-filter">
            状态
            <select
              aria-label="筛选圈帖状态"
              value={status}
              onChange={(event) => update('status', event.target.value)}
            >
              <option value="">全部圈帖</option>
              <option value="pending">待审核</option>
              <option value="published">圈内已发布</option>
              <option value="hidden">已隐藏</option>
            </select>
          </label>
        </div>
        <form
          className="circle-id-filter"
          onSubmit={(event) => {
            event.preventDefault();
            update(
              'circleId',
              String(new FormData(event.currentTarget).get('circleId') || '').trim(),
            );
          }}
        >
          <label>
            圈子 ID
            <input
              key={circleId}
              name="circleId"
              aria-label="筛选圈子 ID"
              defaultValue={circleId}
              placeholder="输入圈子 ID，可留空查看全部"
              maxLength={80}
            />
          </label>
          <button className="button" type="submit">
            筛选圈子
          </button>
          {circleId && (
            <button className="text-link" type="button" onClick={() => update('circleId', '')}>
              清除圈子筛选
            </button>
          )}
        </form>
        <div className="list-summary">
          <span>圈内内容审核队列</span>
          {data && <span>{number(data.total)} 篇圈帖</span>}
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
                    <caption className="sr-only">圈帖审核列表</caption>
                    <thead>
                      <tr>
                        <th>圈帖</th>
                        <th>圈子 / 频道</th>
                        <th>作者</th>
                        <th>状态</th>
                        <th>发布时间</th>
                        <th className="align-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((post) => (
                        <tr key={post.id}>
                          <td>
                            <div className="post-preview">
                              <span className="post-placeholder">
                                <FileText size={19} />
                              </span>
                              <div>
                                <strong>{post.title || post.body}</strong>
                                <small className="mono">{post.id}</small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="stacked-cell">
                              <span>{post.circleName}</span>
                              <small>{post.channelName}</small>
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
                              {circlePostStatusLabels[post.status]}
                            </Badge>
                          </td>
                          <td className="muted nowrap">{dateTime(post.createdAt)}</td>
                          <td className="align-right">
                            <button
                              className="row-button"
                              onClick={() => update('detail', post.id)}
                              aria-label={`审核圈帖 ${post.title || post.id}`}
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
                <Empty
                  icon={<FileText size={25} />}
                  description="没有符合条件的圈帖，可调整圈子、状态或搜索词。"
                />
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
      {selected && !loading && !error && (
        <CirclePostDetail
          key={`${selected.id}:${selected.updatedAt}`}
          post={selected}
          onClose={() => update('detail', '')}
          onSaved={(post) => {
            setNotice(
              `圈帖已保存为「${circlePostStatusLabels[post.status]}」，处理说明已记录审计。`,
            );
            update('detail', '');
            reload();
          }}
        />
      )}
      {detail && data && !selected && !loading && !error && (
        <Dialog title="未找到圈帖" onClose={() => update('detail', '')}>
          <Empty
            title="此圈帖不在当前列表"
            description="记录可能已变更或被当前筛选隐藏，请关闭详情并调整筛选或刷新。"
          />
        </Dialog>
      )}
    </>
  );
}
