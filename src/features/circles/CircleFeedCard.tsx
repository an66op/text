import { useState } from 'react';
import { ArrowUpRight, Heart, MessageCircle, Pin, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { CircleAvatar, CirclePostImage } from './ChannelPage';
import { circlePaths } from './routes';
import { useCircles } from './useCircles';
import type { CirclePost } from './types';

export function CircleFeedCard({
  post,
  ownerId,
  channelName,
}: {
  post: CirclePost;
  ownerId?: string;
  channelName?: string;
}) {
  const { togglePostLike } = useCircles();
  const [error, setError] = useState('');
  const href = circlePaths.post(post.circleId, post.id);
  function like() {
    try {
      togglePostLike(post.circleId, post.id);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法点赞，请重试。');
    }
  }
  return (
    <article className="creator-feed-card">
      <header>
        <CircleAvatar name={post.authorName} src={post.avatar} size={40} />
        <div>
          <strong>
            {post.authorName}
            {post.authorId === ownerId && <b>圈主</b>}
          </strong>
          <span>
            <time dateTime={new Date(post.createdAt).toISOString()}>
              {new Date(post.createdAt).toLocaleDateString('zh-CN', {
                month: 'long',
                day: 'numeric',
              })}
            </time>
            {channelName && ` · ${channelName}`}
          </span>
        </div>
        <span className="creator-post-flags">
          {post.pinned && (
            <span>
              <Pin size={11} />
              置顶
            </span>
          )}
          {post.featured && (
            <span>
              <Sparkles size={11} />
              精华
            </span>
          )}
        </span>
      </header>
      <Link className="creator-feed-content" to={href}>
        <h2>{post.title}</h2>
        <p>{post.text}</p>
        {post.image && <CirclePostImage src={post.image} title={post.title} />}
      </Link>
      <footer>
        <button
          aria-label={`${post.liked ? '取消点赞' : '点赞'}：${post.title}`}
          aria-pressed={post.liked}
          onClick={like}
        >
          <Heart size={19} fill={post.liked ? 'currentColor' : 'none'} />
          <span>{post.likes || '赞'}</span>
        </button>
        <Link to={`${href}#comments`} aria-label={`评论：${post.title}`}>
          <MessageCircle size={19} />
          <span>{post.comments.length || '评论'}</span>
        </Link>
        <Link className="creator-read-post" to={href}>
          展开
          <ArrowUpRight size={17} />
        </Link>
      </footer>
      {post.comments.length > 0 && (
        <Link className="creator-comment-preview" to={`${href}#comments`}>
          <strong>{post.comments[0].authorName}</strong>
          <span>：{post.comments[0].text}</span>
        </Link>
      )}
      {error && (
        <p className="circle-content-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
