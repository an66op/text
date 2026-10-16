import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Heart, ImagePlus, MessageCircle, Pin, PinOff, Send, Star, X } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { CircleAccessState, CircleAvatar, CirclePostImage } from './ChannelPage';
import { circlePaths } from './routes';
import { canManage, useCircles } from './useCircles';

const presetImages = [
  'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1000&q=80',
  'https://images.unsplash.com/photo-1472396961693-142e6e269027?auto=format&fit=crop&w=1000&q=80',
  'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1000&q=80',
];

export function CirclePostPage() {
  const { circleId = '', postId = '' } = useParams();
  return <CirclePostContent key={JSON.stringify([circleId, postId])} />;
}

function CirclePostContent() {
  const { circleId = '', postId = '' } = useParams();
  const { hash } = useLocation();
  const {
    getCircle,
    getChannels,
    getPosts,
    canViewChannel,
    addComment,
    togglePostLike,
    setPostFeatured,
    setPostPinned,
  } = useCircles();
  const circle = getCircle(circleId);
  const post = getPosts(circleId).find((item) => item.id === postId && item.circleId === circleId);
  const channel = getChannels(circleId).find((item) => item.id === post?.channelId);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [managementNotice, setManagementNotice] = useState('');
  const commentsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (hash !== '#comments') return;
    const frame = window.requestAnimationFrame(() => {
      commentsRef.current?.scrollIntoView?.({ block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hash, postId]);
  const backTo = channel
    ? circlePaths.channel(circleId, channel.id)
    : circle
      ? circlePaths.home(circleId)
      : circlePaths.list;
  function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!comment.trim()) return;
    try {
      addComment(circleId, postId, comment);
      setComment('');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '评论未能发布，请重试。');
    }
  }
  function like() {
    try {
      togglePostLike(circleId, postId);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '点赞状态未能保存，请重试。');
    }
  }
  function managePost(kind: 'featured' | 'pinned') {
    if (!post || !circle?.joined || !canManage(circle)) return;
    try {
      if (kind === 'featured') {
        setPostFeatured(circleId, postId, !post.featured);
        setManagementNotice(post.featured ? '已取消精华。' : '已设为精华。');
      } else {
        setPostPinned(circleId, postId, !post.pinned);
        setManagementNotice(post.pinned ? '已取消置顶。' : '已置顶这条动态。');
      }
      setError('');
    } catch (cause) {
      setManagementNotice('');
      setError(cause instanceof Error ? cause.message : '动态管理操作未能保存，请重试。');
    }
  }
  return (
    <section className="circle-page circle-post-page">
      <PageHeader
        title={channel?.type === 'announcement' ? '公告详情' : '动态详情'}
        backTo={backTo}
      />
      {!circle ? (
        <CircleAccessState title="圈子不存在" description="这个圈子可能已解散，或链接已经失效。" />
      ) : !circle.joined ? (
        <CircleAccessState
          title="加入圈子，查看完整内容"
          description={`这是「${circle.name}」成员的分享，加入后就能参与讨论。`}
          circleId={circleId}
        />
      ) : !post || !channel ? (
        <CircleAccessState
          title="帖子不存在"
          description="这篇帖子可能已经删除，去频道看看其他内容吧。"
          circleId={circleId}
          joined
        />
      ) : !canViewChannel(circleId, channel.id) ? (
        <CircleAccessState
          title="暂时无法查看这篇帖子"
          description="这篇帖子发布在管理团队的专属频道。"
          circleId={circleId}
          joined
        />
      ) : (
        <div className="circle-page-body">
          <div className="creator-post-context">
            <Link className="circle-post-channel" to={backTo}>
              #{channel.name}
            </Link>
            {post.pinned && (
              <span className="creator-post-badge is-pinned">
                <Pin size={12} />
                置顶
              </span>
            )}
            {post.featured && (
              <span className="creator-post-badge is-featured">
                <Star size={12} fill="currentColor" />
                精华
              </span>
            )}
          </div>
          <article className="circle-post-detail">
            <div className="circle-content-author">
              <CircleAvatar name={post.authorName} src={post.avatar} />
              <div>
                <strong>{post.authorName}</strong>
                <time dateTime={new Date(post.createdAt).toISOString()}>
                  {new Date(post.createdAt).toLocaleString('zh-CN', {
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </div>
            </div>
            <h1>{post.title}</h1>
            <p className="circle-post-text">{post.text}</p>
            {post.image && <CirclePostImage src={post.image} title={post.title} />}
            <div className="circle-post-actions">
              <button
                className={post.liked ? 'is-liked' : ''}
                onClick={like}
                aria-pressed={post.liked}
                aria-label={post.liked ? '取消点赞' : '点赞'}
              >
                <Heart size={20} fill={post.liked ? 'currentColor' : 'none'} />
                {post.likes} 人喜欢
              </button>
              <span>
                <MessageCircle size={19} />
                {post.comments.length} 条回复
              </span>
            </div>
            {canManage(circle) && (
              <div className="creator-post-manage" role="group" aria-label="动态管理">
                <span className="creator-post-manage-label">动态管理</span>
                <div className="creator-post-tools">
                  <button
                    type="button"
                    className={post.featured ? 'is-active is-featured' : ''}
                    aria-pressed={!!post.featured}
                    onClick={() => managePost('featured')}
                  >
                    <Star size={15} fill={post.featured ? 'currentColor' : 'none'} />
                    {post.featured ? '取消精华' : '设为精华'}
                  </button>
                  <button
                    type="button"
                    className={post.pinned ? 'is-active' : ''}
                    aria-pressed={!!post.pinned}
                    onClick={() => managePost('pinned')}
                  >
                    {post.pinned ? <PinOff size={15} /> : <Pin size={15} />}
                    {post.pinned ? '取消置顶' : '置顶动态'}
                  </button>
                </div>
                {managementNotice && (
                  <p className="creator-post-manage-notice" role="status">
                    {managementNotice}
                  </p>
                )}
              </div>
            )}
          </article>
          {error && (
            <p className="circle-content-error" role="alert">
              {error}
            </p>
          )}
          <section className="circle-post-comments" id="comments" ref={commentsRef}>
            <h2>
              一起聊聊 <span>{post.comments.length}</span>
            </h2>
            {post.comments.length ? (
              post.comments.map((item) => (
                <article className="circle-post-comment" key={item.id}>
                  <CircleAvatar name={item.authorName} src={item.avatar} size={35} />
                  <div>
                    <strong>{item.authorName}</strong>
                    <p>{item.text}</p>
                    <time dateTime={new Date(item.createdAt).toISOString()}>
                      {new Date(item.createdAt).toLocaleString('zh-CN', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </div>
                </article>
              ))
            ) : (
              <p className="circle-post-no-comments">还没有回复，留下你的第一句回应吧。</p>
            )}
          </section>
          <form className="circle-comment-composer" onSubmit={submitComment}>
            <label className="sr-only" htmlFor="circle-comment">
              写下评论
            </label>
            <textarea
              id="circle-comment"
              placeholder="分享你的想法…"
              rows={2}
              maxLength={1000}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
            <button className="primary" disabled={!comment.trim()} type="submit">
              <Send size={17} />
              发布评论
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

export function CircleComposePage() {
  const { circleId = '', channelId = '' } = useParams();
  return <CircleComposeContent key={JSON.stringify([circleId, channelId])} />;
}

function CircleComposeContent() {
  const { circleId = '', channelId = '' } = useParams();
  const { getCircle, getChannels, canViewChannel, addPost } = useCircles();
  const circle = getCircle(circleId);
  const channel = getChannels(circleId).find((item) => item.id === channelId);
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [image, setImage] = useState('');
  const [imagePicker, setImagePicker] = useState(false);
  const [error, setError] = useState('');
  const backTo = channel
    ? circlePaths.channel(circleId, channelId)
    : circle
      ? circlePaths.home(circleId)
      : circlePaths.list;
  const isAnnouncement = channel?.type === 'announcement';
  const publishable = channel?.type === 'forum' || (isAnnouncement && canManage(circle));
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !text.trim()) {
      setError('请填写标题和正文后再发布。');
      return;
    }
    if (image.trim() && !/^https?:\/\//i.test(image.trim())) {
      setError('图片地址需要以 https:// 或 http:// 开头。');
      return;
    }
    try {
      const id = addPost(circleId, channelId, {
        title: title.trim(),
        text: text.trim(),
        ...(image.trim() ? { image: image.trim() } : {}),
      });
      navigate(circlePaths.post(circleId, id), { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '发布失败，草稿已保留，请重试。');
    }
  }
  return (
    <section className="circle-page circle-compose-page">
      <PageHeader title={isAnnouncement ? '发布公告' : '发布帖子'} backTo={backTo} />
      {!circle ? (
        <CircleAccessState title="圈子不存在" description="这个圈子可能已解散，或链接已经失效。" />
      ) : !circle.joined ? (
        <CircleAccessState
          title="加入圈子后再分享"
          description="成为圈子的一员，就可以把你的想法分享给大家。"
          circleId={circleId}
        />
      ) : !channel ? (
        <CircleAccessState
          title="频道不存在"
          description="请回到圈子，选择一个可以发布内容的频道。"
          circleId={circleId}
          joined
        />
      ) : !canViewChannel(circleId, channelId) || !publishable ? (
        <CircleAccessState
          title="这个频道暂不能发布帖子"
          description={
            isAnnouncement
              ? '公告由圈主和管理员发布，你可以在帖子详情参与讨论。'
              : '请在论坛频道发布帖子，或在聊天频道发送消息。'
          }
          circleId={circleId}
          joined
        />
      ) : (
        <form className="circle-page-body circle-compose-form" onSubmit={submit}>
          <div className="circle-compose-destination">
            <span>{circle.icon}</span>
            <div>
              <strong>{circle.name}</strong>
              <p>发布到 #{channel.name}</p>
            </div>
          </div>
          <label className="circle-compose-title-label" htmlFor="circle-post-title">
            标题
          </label>
          <input
            id="circle-post-title"
            className="circle-compose-title"
            placeholder="给这次分享起个标题"
            maxLength={80}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <div className="circle-compose-count">{title.length}/80</div>
          <label className="sr-only" htmlFor="circle-post-text">
            正文
          </label>
          <textarea
            id="circle-post-text"
            className="circle-compose-text"
            placeholder="此刻的发现、想法，或值得分享的日常…"
            maxLength={10000}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          {image && (
            <div className="circle-compose-preview">
              <CirclePostImage src={image} title="帖子图片预览" />
              <button type="button" aria-label="移除图片" onClick={() => setImage('')}>
                <X size={17} />
              </button>
            </div>
          )}
          <div className="circle-compose-tools">
            <button
              className="secondary"
              type="button"
              aria-expanded={imagePicker}
              onClick={() => setImagePicker(!imagePicker)}
            >
              <ImagePlus size={19} />
              {image ? '更换配图' : '添加配图'}
            </button>
            <span>一张图片，让分享更生动</span>
          </div>
          {imagePicker && (
            <div className="circle-compose-image-picker">
              <label htmlFor="circle-image-url">图片链接（可选）</label>
              <input
                id="circle-image-url"
                type="url"
                placeholder="https://example.com/photo.jpg"
                value={image}
                onChange={(event) => setImage(event.target.value)}
              />
              <p>或选一张灵感配图</p>
              <div>
                {presetImages.map((src, index) => (
                  <button
                    className={image === src ? 'selected' : ''}
                    type="button"
                    key={src}
                    aria-label={`选择配图 ${index + 1}`}
                    aria-pressed={image === src}
                    onClick={() => setImage(src)}
                  >
                    <img src={src} alt={`风景配图 ${index + 1}`} loading="lazy" />
                    {image === src && <Check size={18} />}
                  </button>
                ))}
              </div>
            </div>
          )}
          {error && (
            <p className="circle-content-error" role="alert">
              {error}
            </p>
          )}
          <div className="circle-compose-submit">
            <p>让交流保持友善，让每种想法被尊重。</p>
            <button className="primary" type="submit" disabled={!title.trim() || !text.trim()}>
              <Send size={17} />
              {isAnnouncement ? '发布公告' : '发布帖子'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
