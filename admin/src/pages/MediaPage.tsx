import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Eye, ImageOff, Images, RefreshCw } from 'lucide-react';
import { Link } from 'react-router';
import { accountEpoch, expectedAccount } from '../../../src/shared/api/account-guard';
import { api, errorMessage, queryString } from '../api';
import {
  dateTime,
  fileSize,
  mediaStatusLabels,
  number,
  postStatusLabels,
  safeImageUrl,
} from '../format';
import type { AdminMediaAsset, MediaStatus, Page } from '../types';
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

function MediaPreview({ asset, compact = false }: { asset: AdminMediaAsset; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  const src = safeImageUrl(asset.url);
  if (!src || failed) {
    return (
      <div
        className={
          compact ? 'media-thumbnail media-preview-failed' : 'media-preview media-preview-failed'
        }
      >
        <ImageOff size={compact ? 21 : 30} aria-hidden="true" />
        {!compact && (
          <>
            <p>{src ? '图片预览暂时无法加载' : '图片地址无法安全预览'}</p>
            {src && (
              <button className="button" onClick={() => setFailed(false)}>
                <RefreshCw size={14} /> 重试图片预览
              </button>
            )}
          </>
        )}
      </div>
    );
  }
  const image = (
    <img
      src={src}
      alt={compact ? '' : '托管图片预览'}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
  return compact ? (
    <span className="media-thumbnail">{image}</span>
  ) : (
    <a
      className="media-preview"
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="在新窗口查看原图"
    >
      {image}
      <span>
        查看原图 <ArrowUpRight size={13} />
      </span>
    </a>
  );
}

function MediaDetail({
  asset,
  onClose,
  onSaved,
}: {
  asset: AdminMediaAsset;
  onClose: () => void;
  onSaved: (asset: AdminMediaAsset) => void;
}) {
  const [status, setStatus] = useState<MediaStatus>(asset.status);
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
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
  const save = async () => {
    if (request.current || !note.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    const account = expectedAccount();
    const epoch = accountEpoch();
    const current = () =>
      active.current && account === expectedAccount() && epoch === accountEpoch();
    setBusy(true);
    setError('');
    try {
      const updated = await api<AdminMediaAsset>(`/admin/media/${encodeURIComponent(asset.id)}`, {
        method: 'PATCH',
        body: { status, note: note.trim() },
        signal: controller.signal,
      });
      if (current()) onSaved(updated);
    } catch (error) {
      if (active.current) {
        setError(
          current() ? errorMessage(error) : '登录会话已变化，请重新验证并刷新图片状态后再操作。',
        );
      }
    } finally {
      request.current = null;
      // An account epoch can advance even if a sign-out attempt fails. A still
      // mounted dialog must remain closable without accepting the old receipt.
      if (active.current) setBusy(false);
    }
  };

  return (
    <Dialog
      title="图片审核"
      description={`图片 ID · ${asset.id}`}
      onClose={onClose}
      busy={busy}
      wide
    >
      <div className="media-detail-heading">
        <div className="user-cell compact">
          <Avatar name={asset.owner.name} src={asset.owner.avatar} />
          <div>
            <strong>{asset.owner.name}</strong>
            <small>@{asset.owner.handle}</small>
          </div>
        </div>
        <Badge tone={asset.status === 'blocked' ? 'danger' : 'good'}>
          {mediaStatusLabels[asset.status]}
        </Badge>
      </div>
      <MediaPreview key={`${asset.id}:${asset.updatedAt}`} asset={asset} />
      <dl className="detail-grid media-metadata">
        <div>
          <dt>文件类型 / 大小</dt>
          <dd>
            {asset.contentType} · {fileSize(asset.bytes)}
          </dd>
        </div>
        <div>
          <dt>图片尺寸</dt>
          <dd>
            {number(asset.width)} × {number(asset.height)} px
          </dd>
        </div>
        <div>
          <dt>上传时间</dt>
          <dd>{dateTime(asset.createdAt)}</dd>
        </div>
        <div>
          <dt>最近更新</dt>
          <dd>{dateTime(asset.updatedAt)}</dd>
        </div>
        <div>
          <dt>上传者 ID</dt>
          <dd className="mono break-all">{asset.owner.id}</dd>
        </div>
        <div>
          <dt>引用情况</dt>
          <dd>
            {number(asset.referenceCount)} 篇帖子 · {number(asset.publishedReferenceCount)} 篇已发布
          </dd>
        </div>
      </dl>
      {asset.note && (
        <div className="media-previous-note">
          <h3>最近处理说明</h3>
          <p>{asset.note}</p>
        </div>
      )}
      <section className="media-references" aria-label="引用帖子">
        <h3>
          引用帖子 <span>{number(asset.referenceCount)}</span>
        </h3>
        <p>共 {number(asset.referenceCount)} 篇，预览最近最多 10 篇；每篇正文最多展示 200 字。</p>
        {asset.posts.length ? (
          <ul>
            {asset.posts.map((post) => (
              <li key={post.id}>
                <Link
                  to={`/content?q=${encodeURIComponent(post.id)}&detail=${encodeURIComponent(post.id)}`}
                >
                  <div>
                    <p>{post.body || '图片帖子'}</p>
                    <small className="mono">{post.id}</small>
                  </div>
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
                  <ArrowUpRight size={15} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="media-no-references">
            {asset.referenceCount
              ? '当前没有可展示的引用预览，请刷新后重试。'
              : '这张图片尚未被帖子引用。'}
          </p>
        )}
      </section>
      <div className="section-separator" />
      <Notice tone="info">
        可用表示图片可以被引用，托管图片的投稿仍需单独审核。屏蔽后普通用户无法读取图片，已发布的引用帖子会同时隐藏，待审核帖子保持待审核。恢复图片不会自动恢复帖子。
      </Notice>
      <label className="field">
        图片状态
        <select
          value={status}
          disabled={confirming}
          onChange={(event) => setStatus(event.target.value as MediaStatus)}
        >
          <option value="ready">可用 · 允许引用</option>
          <option value="blocked">已屏蔽 · 阻止普通读取与发布</option>
        </select>
      </label>
      <label className="field">
        处理说明 <span className="required">必填</span>
        <textarea
          value={note}
          disabled={confirming}
          onChange={(event) => setNote(event.target.value)}
          rows={4}
          maxLength={1000}
          placeholder="说明核实依据、图片处置结果及关联帖子的处理要求。"
        />
        <small className="character-count">{note.length} / 1000</small>
      </label>
      <p className="field-hint">可保留当前状态并更新说明。每次提交均保存说明并记录审计。</p>
      {confirming ? (
        <ConfirmAction
          title={status === 'blocked' ? '确认屏蔽图片' : '确认图片可用'}
          description={`图片 ${asset.id}：从「${mediaStatusLabels[asset.status]}」保存为「${mediaStatusLabels[status]}」。${status === 'blocked' ? '服务端将同时隐藏全部已发布的引用帖子，待审核帖子保持待审核。' : '图片可被引用，现有帖子保持原状态，不会自动恢复发布。'}处理说明将一并保存。`}
          confirmLabel={status === 'blocked' ? '确认屏蔽并保存' : '确认可用并保存'}
          danger={status === 'blocked'}
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
            disabled={!note.trim()}
            onClick={() => setConfirming(true)}
          >
            检查图片处理
          </button>
        </div>
      )}
    </Dialog>
  );
}

export default function MediaPage() {
  const { q, status, offset, detail, update } = useListParams();
  const { data, loading, error, reload } = useResource<Page<AdminMediaAsset>>(
    `/admin/media${queryString({ q, status, offset, limit: PAGE_SIZE })}`,
  );
  const [notice, setNotice] = useState('');
  const selected = data?.items.find((asset) => asset.id === detail);
  return (
    <>
      <PageHeading
        eyebrow="MEDIA LIBRARY"
        title="图片管理"
        description="核实托管图片与引用关系，记录每一次处置依据。"
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
            placeholder="搜索图片 ID、上传者或引用帖子 ID"
            onSearch={(value) => update('q', value)}
          />
          <label className="single-filter">
            状态
            <select
              aria-label="筛选图片状态"
              value={status}
              onChange={(event) => update('status', event.target.value)}
            >
              <option value="">全部图片</option>
              <option value="ready">可用</option>
              <option value="blocked">已屏蔽</option>
            </select>
          </label>
        </div>
        <div className="list-summary">
          <span>托管图片</span>
          {data && <span>{number(data.total)} 张图片</span>}
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
                  <table className="media-table">
                    <caption className="sr-only">托管图片列表</caption>
                    <thead>
                      <tr>
                        <th>图片</th>
                        <th>上传者</th>
                        <th>状态</th>
                        <th>引用帖子</th>
                        <th>上传时间</th>
                        <th className="align-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((asset) => (
                        <tr key={asset.id}>
                          <td>
                            <div className="media-file-cell">
                              <MediaPreview
                                key={`${asset.id}:${asset.updatedAt}`}
                                asset={asset}
                                compact
                              />
                              <div>
                                <strong className="mono">{asset.id}</strong>
                                <small>
                                  {asset.contentType.replace(/^image\//, '').toUpperCase()} ·{' '}
                                  {fileSize(asset.bytes)}
                                </small>
                                <small>
                                  {number(asset.width)} × {number(asset.height)} px
                                </small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="user-cell compact">
                              <Avatar name={asset.owner.name} src={asset.owner.avatar} />
                              <div>
                                <strong>{asset.owner.name}</strong>
                                <small>@{asset.owner.handle}</small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <Badge tone={asset.status === 'blocked' ? 'danger' : 'good'}>
                              {mediaStatusLabels[asset.status]}
                            </Badge>
                          </td>
                          <td className="media-reference-count">
                            <strong>{number(asset.referenceCount)} 篇</strong>
                            <small>{number(asset.publishedReferenceCount)} 篇已发布</small>
                          </td>
                          <td className="muted nowrap">{dateTime(asset.createdAt)}</td>
                          <td className="align-right">
                            <button
                              className="row-button"
                              onClick={() => update('detail', asset.id)}
                              aria-label={`审核图片 ${asset.id}`}
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
                  icon={<Images size={25} />}
                  description="暂无符合条件的托管图片。试试其他搜索词或状态。"
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
        <MediaDetail
          key={`${selected.id}:${selected.updatedAt}`}
          asset={selected}
          onClose={() => update('detail', '')}
          onSaved={(asset) => {
            setNotice(
              `图片已保存为「${mediaStatusLabels[asset.status]}」，处理说明与审计记录已更新。`,
            );
            update('detail', '');
            reload();
          }}
        />
      )}
      {detail && data && !selected && !loading && !error && (
        <Dialog title="未找到图片" onClose={() => update('detail', '')}>
          <Empty
            title="这张图片不在当前列表"
            description="记录可能已变更或被筛选隐藏。关闭详情，调整搜索或刷新后重试。"
          />
        </Dialog>
      )}
    </>
  );
}
