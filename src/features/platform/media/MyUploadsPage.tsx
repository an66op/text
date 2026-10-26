import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ImageOff, LockKeyhole, RefreshCw, Search, Trash2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { ApiError, apiErrorMessage, isAbort } from '@/shared/api/client';
import { accountEpoch } from '@/shared/api/account-guard';
import { hostedImageId } from '@/shared/api/media-url';
import PageHeader from '@/shared/ui/PageHeader';
import ActionDialog from '@/shared/ui/ActionDialog';
import { LoginNotice, PlatformError } from '../PlatformUi';
import { shortTime } from '../platform-format';
import { useAuth } from '../useAuth';
import { circlesApi } from '../circles/api';
import { mediaApi } from './media-api';
import type { MyMediaAsset } from './media-model';
import '../platform.css';
import './my-uploads.css';

const PAGE_SIZE = 12;
const size = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MiB`
    : `${Math.max(1, Math.ceil(bytes / 1024))} KiB`;
const postLabels = { pending: '待审核', published: '已发布', hidden: '已隐藏' };
type CircleReference = MyMediaAsset['circlePosts'][number];
type PostCleanup = { imageId: string; post: CircleReference };

function ownCircleReference(image: MyMediaAsset, post: CircleReference, userId: string) {
  return (
    image.owner.id === userId &&
    image.scope === 'circle' &&
    !!image.circleId &&
    post.circleId === image.circleId &&
    !!post.id
  );
}

export default function MyUploadsPage() {
  const auth = useAuth();
  const [params] = useSearchParams();
  const requestedImages = params.getAll('image');
  const imageId =
    requestedImages.length === 1 && /^media_[0-9a-f]{32}$/.test(requestedImages[0])
      ? requestedImages[0]
      : '';
  if (auth.status === 'checking' || auth.status === 'unavailable' || !auth.user)
    return (
      <section className="platform-page my-uploads-page">
        <PageHeader title="我的上传" backTo="/account" />
        <div className="my-uploads-content">
          {auth.status === 'checking' ? (
            <p role="status" className="platform-empty">
              正在验证账号…
            </p>
          ) : auth.status === 'unavailable' ? (
            <PlatformError
              message={auth.error || '账号服务暂时不可达'}
              retry={() => void auth.refresh()}
            />
          ) : (
            <LoginNotice returnTo="/account/uploads" text="登录后，管理服务器保存的上传图片" />
          )}
        </div>
      </section>
    );
  return (
    <OwnedUploads
      key={`${auth.user.id}:${auth.expiresAt}:${auth.user.role}:${auth.user.status}:${accountEpoch()}:${imageId}`}
      userId={auth.user.id}
      initialSearch={imageId}
    />
  );
}

function UploadPreview({ image }: { image: MyMediaAsset }) {
  const [failed, setFailed] = useState(false);
  const id = hostedImageId(image.url);
  const safe = !!id && id === image.id;
  return image.status === 'blocked' || !safe || failed ? (
    <div className="my-upload-preview is-unavailable">
      <ImageOff size={23} />
      <span>
        {image.status === 'blocked'
          ? '已屏蔽，暂不可预览'
          : failed
            ? '预览暂不可用'
            : '图片地址不可预览'}
      </span>
      {safe && image.status !== 'blocked' && (
        <button
          type="button"
          aria-label={`重试预览图片 ${image.id.slice(-8)}`}
          onClick={() => setFailed(false)}
        >
          重试预览
        </button>
      )}
    </div>
  ) : (
    <a
      className="my-upload-preview"
      href={image.url}
      target="_blank"
      rel="noreferrer"
      aria-label={`查看原图 ${image.id.slice(-8)}`}
    >
      <img
        src={image.url}
        alt={`上传图片 ${image.id.slice(-8)}`}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </a>
  );
}

function OwnedUploads({ userId, initialSearch }: { userId: string; initialSearch: string }) {
  const auth = useAuth();
  const [items, setItems] = useState<MyMediaAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState<'' | MyMediaAsset['status']>('');
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<MyMediaAsset | null>(null);
  const [confirmingPost, setConfirmingPost] = useState<PostCleanup | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const [postError, setPostError] = useState('');
  const [postDenied, setPostDenied] = useState(false);
  const [notice, setNotice] = useState('');
  const active = useRef(true);
  const mountedEpoch = useRef(accountEpoch()).current;
  const generation = useRef(0);
  const read = useRef<AbortController | null>(null);
  const removing = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      generation.current += 1;
      removing.current?.abort();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    read.current = controller;
    const current = ++generation.current;
    setLoading(true);
    setItems([]);
    setError('');
    void mediaApi
      .mine(
        { status: status || undefined, q: search, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
        controller.signal,
      )
      .then((result) => {
        if (
          !active.current ||
          mountedEpoch !== accountEpoch() ||
          controller.signal.aborted ||
          current !== generation.current
        )
          return;
        if (result.items.some((image) => image.owner.id !== userId))
          throw new Error('上传列表与当前账号不一致，请重新验证账号');
        setItems(result.items);
        setTotal(result.total);
      })
      .catch((caught) => {
        if (
          active.current &&
          mountedEpoch === accountEpoch() &&
          !controller.signal.aborted &&
          current === generation.current &&
          !isAbort(caught)
        )
          setError(apiErrorMessage(caught));
      })
      .finally(() => {
        if (active.current && mountedEpoch === accountEpoch() && current === generation.current)
          setLoading(false);
        if (read.current === controller) read.current = null;
      });
    return () => {
      controller.abort();
      generation.current += 1;
    };
  }, [userId, mountedEpoch, search, status, page, revision]);
  useEffect(() => {
    if (!confirming || loading || busy) return;
    const latest = items.find((image) => image.id === confirming.id);
    if (!latest || latest.referenceCount !== 0) {
      setConfirming(null);
      setNotice('图片状态已变化，请刷新后重新确认；被帖子引用的图片不能删除。');
    }
  }, [confirming, items, loading, busy]);
  useEffect(() => {
    if (!confirmingPost || loading || busy) return;
    const latest = items.find((image) => image.id === confirmingPost.imageId);
    if (
      !latest?.circlePosts.some(
        (post) => post.id === confirmingPost.post.id && ownCircleReference(latest, post, userId),
      )
    ) {
      setConfirmingPost(null);
      setNotice('圈帖引用已变化，请按服务器最新列表继续清理。');
    }
  }, [confirmingPost, items, loading, busy, userId]);
  const refresh = () => {
    if (active.current && mountedEpoch === accountEpoch() && !removing.current)
      setRevision((value) => value + 1);
  };
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setConfirming(null);
    setConfirmingPost(null);
    setPage(0);
    setSearch(query.trim());
  };
  const remove = async () => {
    if (!active.current || mountedEpoch !== accountEpoch() || removing.current || !confirming)
      return;
    const image = items.find(
      (item) => item.id === confirming.id && item.owner.id === userId && item.referenceCount === 0,
    );
    if (!image) {
      setConfirming(null);
      refresh();
      return;
    }
    generation.current += 1;
    read.current?.abort();
    const controller = new AbortController();
    removing.current = controller;
    const current = generation.current;
    const valid = () =>
      active.current &&
      mountedEpoch === accountEpoch() &&
      !controller.signal.aborted &&
      current === generation.current;
    setBusy(true);
    setRemoveError('');
    try {
      const result = await mediaApi.remove(image.id, controller.signal);
      if (!valid()) return;
      if (result?.ok !== true) throw new Error('服务尚未确认图片已删除，请刷新后重试');
      setItems((previous) => previous.filter((item) => item.id !== image.id));
      setTotal((value) => Math.max(0, value - 1));
      setConfirming(null);
      setNotice(`图片 ${image.id.slice(-8)} 已从服务器删除`);
      if (page > 0 && items.length === 1) setPage((value) => value - 1);
      else setRevision((value) => value + 1);
    } catch (caught) {
      if (valid() && !isAbort(caught)) setRemoveError(apiErrorMessage(caught));
    } finally {
      if (removing.current === controller) removing.current = null;
      if (valid()) {
        setBusy(false);
        setLoading(false);
      }
    }
  };
  const removeCirclePost = async () => {
    if (!active.current || mountedEpoch !== accountEpoch() || removing.current || !confirmingPost)
      return;
    const image = items.find((item) => item.id === confirmingPost.imageId);
    const post = image?.circlePosts.find(
      (item) => item.id === confirmingPost.post.id && ownCircleReference(image, item, userId),
    );
    if (!post) {
      setConfirmingPost(null);
      refresh();
      return;
    }
    generation.current += 1;
    read.current?.abort();
    const controller = new AbortController();
    removing.current = controller;
    const current = generation.current;
    const valid = () =>
      active.current &&
      mountedEpoch === accountEpoch() &&
      !controller.signal.aborted &&
      current === generation.current;
    setBusy(true);
    setPostError('');
    setPostDenied(false);
    setNotice('');
    try {
      const result = await circlesApi.deletePost(post.circleId, post.id, controller.signal);
      if (!valid()) return;
      if (result?.ok !== true) throw new Error('服务尚未确认圈帖已删除，请刷新引用后重试');
      setConfirmingPost(null);
      setNotice('圈帖已删除，原图片仍保留。正在重新读取服务器引用，可继续清理。');
      setRevision((value) => value + 1);
    } catch (caught) {
      if (valid() && !isAbort(caught)) {
        const denied = caught instanceof ApiError && [403, 404].includes(caught.status);
        setPostDenied(denied);
        setPostError(
          denied
            ? `暂时无法清理此圈帖：${apiErrorMessage(caught)}。请刷新引用，确认最新状态。`
            : apiErrorMessage(caught),
        );
      }
    } finally {
      if (removing.current === controller) removing.current = null;
      if (valid()) setBusy(false);
    }
  };
  return (
    <section className="platform-page my-uploads-page">
      <PageHeader
        title="我的上传"
        backTo="/account"
        action={
          <button
            type="button"
            aria-label="刷新我的上传"
            disabled={loading || busy}
            onClick={refresh}
          >
            <RefreshCw size={19} />
          </button>
        }
      />
      <div className="my-uploads-content">
        <p className="my-uploads-intro">服务器保存的图片 · 空间上限 100 张 / 100 MiB</p>
        <p className="my-uploads-help">
          取消或超时的上传也可能已保存，可在这里查找并清理未引用图片。
        </p>
        <form className="platform-search" onSubmit={submitSearch}>
          <Search size={17} />
          <input
            aria-label="搜索我的上传"
            placeholder="搜索图片或引用帖子 ID"
            value={query}
            maxLength={200}
            disabled={busy}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" aria-label="搜索上传" disabled={busy}>
            搜索
          </button>
        </form>
        <div className="my-uploads-toolbar">
          <div aria-label="上传状态筛选">
            {(
              [
                ['', '全部'],
                ['ready', '可用'],
                ['blocked', '屏蔽'],
              ] as const
            ).map(([value, label]) => (
              <button
                type="button"
                key={value}
                aria-pressed={status === value}
                disabled={busy}
                onClick={() => {
                  setConfirming(null);
                  setConfirmingPost(null);
                  setPage(0);
                  setStatus(value);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <span>共 {total} 张</span>
        </div>
        <PlatformError message={auth.error} retry={() => void auth.refresh()} />
        <PlatformError message={error} retry={refresh} />
        {notice && (
          <p className="my-uploads-notice" role="status">
            {notice}
          </p>
        )}
        {loading ? (
          <p className="platform-empty" role="status">
            正在读取服务器上传…
          </p>
        ) : !items.length && !error ? (
          <div className="my-uploads-empty">
            <ImageOff size={28} />
            <h2>{search || status ? '没有符合条件的上传' : '还没有服务器上传'}</h2>
            <button type="button" onClick={refresh}>
              重新读取
            </button>
          </div>
        ) : null}
        <div className="my-uploads-list">
          {!loading &&
            items.map((image) => (
              <article
                className="my-upload-card"
                key={image.id}
                aria-label={`上传 ${image.id.slice(-8)}`}
              >
                <div className="my-upload-summary">
                  <UploadPreview key={`${image.id}:${image.updatedAt}`} image={image} />
                  <div className="my-upload-meta">
                    <h2>图片 {image.id.slice(-8)}</h2>
                    <span className={`my-upload-state is-${image.status}`}>
                      {image.status === 'blocked'
                        ? '已屏蔽'
                        : image.scope === 'circle'
                          ? image.circlePublishedReferenceCount > 0
                            ? '圈内可读'
                            : '圈内私人上传'
                          : image.publishedReferenceCount > 0
                            ? '已有公开引用'
                            : '私人上传'}
                    </span>
                    <p>
                      {image.scope === 'circle' && image.circleId ? (
                        <Link to={`/circles/s/${encodeURIComponent(image.circleId)}`}>
                          圈内上传 ↗
                        </Link>
                      ) : (
                        '世界上传'
                      )}
                    </p>
                    <p>
                      {size(image.bytes)} · {image.width} × {image.height}
                    </p>
                    <p>
                      创建于{' '}
                      <time dateTime={image.createdAt}>
                        {shortTime(image.createdAt) || '时间未知'}
                      </time>
                    </p>
                    <small>
                      {image.referenceCount} 条引用 · {image.publishedReferenceCount} 条世界公开
                      {!!image.circleReferenceCount &&
                        ` · ${image.circleReferenceCount} 条圈内引用`}
                    </small>
                  </div>
                </div>
                {image.note && <p className="my-upload-note">审核说明：{image.note}</p>}
                {image.status === 'ready' && image.scope === 'circle' && (
                  <p className="my-upload-private">
                    <LockKeyhole size={12} />
                    仅绑定所属圈子，成员还需具有引用帖所在频道的访问权限。
                  </p>
                )}
                {image.status === 'ready' &&
                  image.scope === 'world' &&
                  image.publishedReferenceCount === 0 && (
                    <p className="my-upload-private">
                      <LockKeyhole size={12} />
                      没有公开帖引用，仅作为私人上传保存。
                    </p>
                  )}
                {!!image.posts.length && (
                  <div className="my-upload-posts">
                    <span>
                      引用帖子
                      {image.referenceCount > image.posts.length
                        ? `（最近 ${image.posts.length} 条）`
                        : ''}
                    </span>
                    {image.posts.slice(0, 10).map((post) => (
                      <Link key={post.id} to={`/world/p/${encodeURIComponent(post.id)}`}>
                        <small>{postLabels[post.status]}</small>
                        <span>{post.body || '查看帖子'}</span>
                      </Link>
                    ))}
                  </div>
                )}
                {!!image.circlePosts?.length && (
                  <div className="my-upload-posts">
                    <span>圈内引用帖子（最近 {image.circlePosts.length} 条）</span>
                    {image.circlePosts.slice(0, 10).map((post) => (
                      <div className="my-upload-circle-reference" key={post.id}>
                        <Link
                          to={`/circles/s/${encodeURIComponent(post.circleId)}/posts/${encodeURIComponent(post.id)}`}
                        >
                          <small>{postLabels[post.status]}</small>
                          <span>{post.body || '查看圈内帖子'}</span>
                        </Link>
                        {ownCircleReference(image, post, userId) && (
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={`删除圈帖 ${post.id.slice(-8)}`}
                            onClick={() => {
                              setConfirming(null);
                              setPostError('');
                              setPostDenied(false);
                              setConfirmingPost({ imageId: image.id, post });
                            }}
                          >
                            <Trash2 size={12} />
                            删除圈帖
                          </button>
                        )}
                      </div>
                    ))}
                    <p className="my-upload-cleanup-help">
                      即使已离开圈子，也可删除本人圈帖。每张图片最多展示最近 10
                      条引用，删除后会重新读取，可继续清理后续引用。
                    </p>
                  </div>
                )}
                {image.referenceCount === 0 && (
                  <button
                    className="my-upload-delete"
                    type="button"
                    disabled={busy}
                    aria-label={`删除上传 ${image.id.slice(-8)}`}
                    onClick={() => {
                      setRemoveError('');
                      setConfirming(image);
                    }}
                  >
                    <Trash2 size={14} />
                    删除未引用图片
                  </button>
                )}
              </article>
            ))}
        </div>
        {total > PAGE_SIZE && (
          <nav className="my-uploads-pagination" aria-label="上传分页">
            <button
              type="button"
              disabled={loading || busy || page === 0}
              onClick={() => setPage((value) => value - 1)}
            >
              上一页
            </button>
            <span>
              第 {page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))} 页
            </span>
            <button
              type="button"
              disabled={loading || busy || (page + 1) * PAGE_SIZE >= total}
              onClick={() => setPage((value) => value + 1)}
            >
              下一页
            </button>
          </nav>
        )}
      </div>
      {confirming && (
        <ActionDialog
          title="删除这张服务器图片？"
          confirmLabel="确认删除图片"
          busy={busy}
          danger
          onClose={() => setConfirming(null)}
          onConfirm={() => void remove()}
        >
          <p>
            将永久删除图片 {confirming.id.slice(-8)}（{size(confirming.bytes)}
            ）。它当前未被帖子引用，删除后无法恢复。
          </p>
          <PlatformError message={removeError} />
        </ActionDialog>
      )}
      {confirmingPost && (
        <ActionDialog
          title="删除这篇本人圈帖？"
          confirmLabel="确认删除圈帖"
          busy={busy}
          danger
          onClose={() => setConfirmingPost(null)}
          onConfirm={() => void removeCirclePost()}
        >
          <p>
            将永久删除整篇圈帖 {confirmingPost.post.id.slice(-8)}
            及其评论、点赞，并解除这篇帖子的全部图片引用。删除后无法恢复，其他引用帖不会被删除。
          </p>
          <p className="my-upload-cleanup-preview">
            {confirmingPost.post.body.slice(0, 200) || '无文字圈帖'}
          </p>
          <p>原图片会继续保留。服务器确认没有引用后，可另行选择「删除未引用图片」。</p>
          <PlatformError message={postError} />
          {postDenied && (
            <button
              type="button"
              className="my-upload-cleanup-refresh"
              disabled={busy}
              onClick={() => {
                setConfirmingPost(null);
                setNotice('尚未确认圈帖已删除，正在重新读取服务器引用。');
                refresh();
              }}
            >
              刷新引用
            </button>
          )}
        </ActionDialog>
      )}
    </section>
  );
}
