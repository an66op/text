import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowUpRight,
  ChevronDown,
  Flag,
  Globe2,
  Heart,
  ImagePlus,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { Link } from 'react-router';
import AppTopbar from '@/shared/ui/AppTopbar';
import { apiErrorMessage, isAbort } from '@/shared/api/client';
import { platformApi } from '@/shared/api/platformApi';
import type { PlatformComment, PlatformPost } from '@/shared/api/types';
import { useAuth } from './useAuth';
import { loginPath } from './auth-paths';
import { LoginNotice, PlatformAvatar, PlatformError } from './PlatformUi';
import { imageUrl, shortTime } from './platform-format';
import './platform.css';

const topics = ['全部', '生活', '设计', '科技', 'Web3', '游戏'];
const serviceTopics: Record<string, string> = { 生活: '城市生活', 设计: '设计灵感' };

export default function ServerWorldPage() {
  const { user, status } = useAuth();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [topic, setTopic] = useState('全部');
  const [posts, setPosts] = useState<PlatformPost[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [compose, setCompose] = useState(false);
  const request = useRef(0);
  const viewerId = useRef(user?.id);
  viewerId.current = user?.id;
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(query.trim());
      setPage(0);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    const generation = ++request.current;
    setLoading(true);
    setError('');
    void platformApi
      .posts(
        {
          q: search,
          topic: topic === '全部' ? undefined : (serviceTopics[topic] ?? topic),
          limit: 20,
          offset: page * 20,
        },
        controller.signal,
      )
      .then((result) => {
        if (generation !== request.current) return;
        setPosts((previous) =>
          page
            ? [
                ...previous.filter((post) => !result.items.some((next) => next.id === post.id)),
                ...result.items,
              ]
            : result.items,
        );
        setTotal(result.total);
      })
      .catch((caught) => {
        if (generation === request.current && !isAbort(caught)) {
          setError(apiErrorMessage(caught));
          if (!page) setPosts([]);
        }
      })
      .finally(() => {
        if (generation === request.current) setLoading(false);
      });
    return () => {
      controller.abort();
      request.current += 1;
    };
  }, [search, topic, page, revision, user?.id]);
  const reload = useCallback(() => {
    setPage(0);
    setRevision((value) => value + 1);
  }, []);
  const replace = (post: PlatformPost) => {
    if (viewerId.current !== user?.id) return;
    setPosts((previous) => previous.map((item) => (item.id === post.id ? post : item)));
  };
  return (
    <section className="platform-page platform-world-page">
      <AppTopbar
        title="世界"
        actions={
          <>
            {user ? (
              <button
                aria-label="发布世界帖子"
                type="button"
                onClick={() => setCompose((value) => !value)}
              >
                <Plus size={23} />
              </button>
            ) : (
              <Link to={loginPath('/world')} aria-label="登录账号">
                <ArrowUpRight size={21} />
              </Link>
            )}
          </>
        }
      />
      <div className="platform-content">
        <div className="platform-world-intro">
          <span>
            <Globe2 size={14} />
            共鸣社区
          </span>
          <Link to="/world/demo">
            本机内容
            <ArrowUpRight size={13} />
          </Link>
        </div>
        <label className="platform-search">
          <Search size={18} />
          <input
            aria-label="搜索世界帖子"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索想法、话题与生活"
          />
          {query && (
            <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}>
              <X size={16} />
            </button>
          )}
        </label>
        <div className="platform-topics" aria-label="世界话题">
          {topics.map((item) => (
            <button
              type="button"
              className={topic === item ? 'active' : ''}
              aria-pressed={topic === item}
              key={item}
              onClick={() => {
                setPage(0);
                setTopic(item);
              }}
            >
              {item}
            </button>
          ))}
        </div>
        {compose && user && (
          <WorldComposer
            key={user.id}
            onClose={() => setCompose(false)}
            onPublished={() => {
              setCompose(false);
              setQuery('');
              setSearch('');
              setTopic('全部');
              reload();
            }}
          />
        )}
        {!user && status !== 'checking' && (
          <LoginNotice returnTo="/world" text="世界已向你敞开，登录后分享自己的声音" />
        )}
        <PlatformError message={error} retry={reload} />
        <div className="platform-feed-heading">
          <span>{search ? `搜索「${search}」` : '发现新的共鸣'}</span>
          <button type="button" aria-label="刷新世界" disabled={loading} onClick={reload}>
            <RefreshCw size={15} />
          </button>
        </div>
        {loading && page === 0 ? (
          <div className="platform-feed-loading" role="status">
            {[1, 2, 3].map((item) => (
              <div key={item}>
                <i />
                <span />
                <span />
              </div>
            ))}
            <span className="sr-only">正在加载世界帖子</span>
          </div>
        ) : posts.length ? (
          <div className="platform-posts">
            {posts.map((post) => (
              <WorldPost
                key={`${user?.id ?? 'guest'}:${post.id}`}
                post={post}
                onReplace={replace}
                onDeleted={reload}
              />
            ))}
          </div>
        ) : (
          !error && (
            <div className="platform-empty">
              <Globe2 size={37} strokeWidth={1.3} />
              <h2>{search || topic !== '全部' ? '还没有找到这份共鸣' : '世界等待第一个声音'}</h2>
              <p>
                {search || topic !== '全部'
                  ? '换个关键词或话题试试。'
                  : '发布一个想法，让新的连接从这里开始。'}
              </p>
              {user && (
                <button className="platform-primary" type="button" onClick={() => setCompose(true)}>
                  分享第一个想法
                </button>
              )}
            </div>
          )
        )}
        {posts.length < total && !error && (
          <button
            className="platform-load-more"
            type="button"
            disabled={loading}
            onClick={() => setPage((value) => value + 1)}
          >
            {loading ? (
              '加载中…'
            ) : (
              <>
                继续探索
                <ChevronDown size={16} />
              </>
            )}
          </button>
        )}
      </div>
    </section>
  );
}

function WorldComposer({ onClose, onPublished }: { onClose: () => void; onPublished: () => void }) {
  const [text, setText] = useState('');
  const [topic, setTopic] = useState('生活');
  const [image, setImage] = useState('');
  const [showImage, setShowImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || busy) return;
    if (image.trim() && !imageUrl(image)) {
      setError('请输入有效的 http 或 https 图片链接');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await platformApi.publishPost({
        body: text.trim(),
        topic: serviceTopics[topic] ?? topic,
        images: image.trim() ? [imageUrl(image)] : [],
      });
      onPublished();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="platform-world-compose" onSubmit={(event) => void submit(event)}>
      <div className="platform-compose-title">
        <strong>分享此刻</strong>
        <button type="button" aria-label="关闭发布" onClick={onClose} disabled={busy}>
          <X size={18} />
        </button>
      </div>
      <textarea
        aria-label="世界帖子内容"
        required
        rows={4}
        maxLength={5000}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="一个想法，一次发现，一段日常…"
        autoFocus
      />
      {showImage && (
        <input
          className="platform-image-input"
          aria-label="帖子图片链接"
          type="url"
          maxLength={1000}
          value={image}
          onChange={(event) => setImage(event.target.value)}
          placeholder="https:// 图片链接"
        />
      )}
      <div className="platform-compose-tools">
        <button
          type="button"
          aria-label="添加图片链接"
          onClick={() => setShowImage((value) => !value)}
        >
          <ImagePlus size={20} />
        </button>
        <label className="sr-only" htmlFor="world-topic">
          帖子话题
        </label>
        <select id="world-topic" value={topic} onChange={(event) => setTopic(event.target.value)}>
          {topics.slice(1).map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <small>{text.length}/5000</small>
        <button className="platform-primary" type="submit" disabled={busy || !text.trim()}>
          {busy ? '发布中…' : '发布'}
          <Send size={15} />
        </button>
      </div>
      <PlatformError message={error} />
    </form>
  );
}

export function WorldPost({
  post,
  onReplace,
  onDeleted,
}: {
  post: PlatformPost;
  onReplace: (post: PlatformPost) => void;
  onDeleted: () => void;
}) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reported, setReported] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const canDelete = user?.id === post.author.id || user?.role === 'admin';
  const like = async () => {
    if (!user || busy) return;
    setBusy(true);
    setError('');
    try {
      onReplace(await platformApi.likePost(post.id, !post.liked));
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await platformApi.deletePost(post.id);
      onDeleted();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  const report = async (event: FormEvent) => {
    event.preventDefault();
    if (!reason.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await platformApi.reportPost(post.id, reason.trim());
      setReported(true);
      setReportOpen(false);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="platform-post">
      <header>
        <PlatformAvatar user={post.author} />
        <div>
          <Link to={`/u/${encodeURIComponent(post.author.handle)}`}>
            <strong>{post.author.name}</strong>
          </Link>
          <small>
            @{post.author.handle} ·{' '}
            <Link to={`/world/p/${encodeURIComponent(post.id)}`} aria-label="打开动态详情">
              <time dateTime={post.createdAt}>{shortTime(post.createdAt)}</time>
            </Link>
          </small>
        </div>
        {post.topic && <span className="platform-topic-tag">{post.topic}</span>}
      </header>
      <p className="platform-post-body">{post.body}</p>
      {post.images.length > 0 && (
        <div className={`platform-post-images ${post.images.length === 1 ? 'single' : ''}`}>
          {post.images
            .filter((src) => imageUrl(src))
            .slice(0, 4)
            .map((src, index) => (
              <a href={imageUrl(src)} target="_blank" rel="noreferrer" key={`${src}:${index}`}>
                <img
                  src={imageUrl(src)}
                  alt={`帖子图片 ${index + 1}`}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              </a>
            ))}
        </div>
      )}
      <div className="platform-post-actions">
        {user ? (
          <button
            type="button"
            className={post.liked ? 'liked' : ''}
            aria-label={post.liked ? '取消点赞' : '点赞'}
            aria-pressed={post.liked}
            disabled={busy}
            onClick={() => void like()}
          >
            <Heart size={18} fill={post.liked ? 'currentColor' : 'none'} />
            {post.likeCount || '喜欢'}
          </button>
        ) : (
          <Link to={loginPath('/world')} aria-label="登录后点赞">
            <Heart size={18} />
            {post.likeCount || '喜欢'}
          </Link>
        )}
        <button
          type="button"
          onClick={() => setCommentsOpen((value) => !value)}
          aria-expanded={commentsOpen}
        >
          <MessageCircle size={18} />
          {post.commentCount || '评论'}
        </button>
        {user && !canDelete && (
          <button
            type="button"
            aria-label="举报帖子"
            disabled={reported}
            onClick={() => {
              setReportOpen((value) => !value);
              setError('');
            }}
          >
            <Flag size={16} />
            {reported ? '已举报' : ''}
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            aria-label="删除帖子"
            onClick={() => setDeleteConfirm((value) => !value)}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
      <PlatformError message={error} />
      {deleteConfirm && (
        <div className="platform-inline-confirm">
          <p>删除这条帖子？评论也会一并删除。</p>
          <button type="button" disabled={busy} onClick={() => setDeleteConfirm(false)}>
            取消
          </button>
          <button
            className="platform-danger"
            type="button"
            disabled={busy}
            onClick={() => void remove()}
          >
            {busy ? '删除中…' : '确认删除'}
          </button>
        </div>
      )}
      {reportOpen && (
        <form className="platform-report-form" onSubmit={(event) => void report(event)}>
          <label>
            举报原因
            <textarea
              required
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="请具体说明问题，运营团队会审核"
              rows={2}
            />
          </label>
          <div>
            <button type="button" onClick={() => setReportOpen(false)}>
              取消
            </button>
            <button className="platform-primary" type="submit" disabled={busy || !reason.trim()}>
              提交举报
            </button>
          </div>
        </form>
      )}
      {commentsOpen && (
        <WorldComments
          post={post}
          onComment={() => onReplace({ ...post, commentCount: post.commentCount + 1 })}
        />
      )}
    </article>
  );
}

function WorldComments({ post, onComment }: { post: PlatformPost; onComment: () => void }) {
  const { user } = useAuth();
  const [comments, setComments] = useState<PlatformComment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void platformApi
      .comments(post.id, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setComments(result.items);
          setTotal(result.total);
        }
      })
      .catch((caught) => {
        if (!isAbort(caught)) setError(apiErrorMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [post.id, revision]);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const comment = await platformApi.comment(post.id, text.trim());
      setComments((previous) => [...previous, comment]);
      setTotal((value) => value + 1);
      setText('');
      onComment();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="platform-comments" aria-label="帖子评论">
      {loading ? (
        <p role="status">正在加载评论…</p>
      ) : comments.length ? (
        <>
          {comments.map((comment) => (
            <article key={comment.id}>
              <PlatformAvatar user={comment.author} />
              <div>
                <strong>
                  {comment.author.name}
                  <time dateTime={comment.createdAt}>{shortTime(comment.createdAt)}</time>
                </strong>
                <p>{comment.body}</p>
              </div>
            </article>
          ))}
          {total > comments.length && (
            <small>
              显示 {comments.length} / {total} 条评论
            </small>
          )}
        </>
      ) : (
        !error && <p className="platform-comment-empty">还没有评论，留下第一句吧。</p>
      )}
      <PlatformError message={error} retry={() => setRevision((value) => value + 1)} />
      {user ? (
        <form className="platform-comment-compose" onSubmit={(event) => void send(event)}>
          <input
            aria-label="评论内容"
            value={text}
            maxLength={2000}
            onChange={(event) => setText(event.target.value)}
            placeholder="友善交流，让共鸣继续…"
          />
          <button type="submit" aria-label="发送评论" disabled={busy || !text.trim()}>
            <Send size={17} />
          </button>
        </form>
      ) : (
        <Link className="platform-text-link" to={loginPath('/world')}>
          登录后参与评论
        </Link>
      )}
    </section>
  );
}
