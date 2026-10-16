import { Bookmark, Heart, MessageCircle, MoreHorizontal, Send } from 'lucide-react';
import { Link } from 'react-router';
import { paths } from '@/shared/config/paths';
import { useProfile } from '@/features/profile/useProfile';
import { useToast } from '@/shared/ui/useToast';
import { useContent } from '../useContent';
import { postAvatar } from '../fixtures';
import { contentRoutes, ownPost } from '../domain';
import type { FeedVariant, Post } from '../types';

export default function PostCard({
  post,
  variant = 'moments',
}: {
  post: Post;
  variant?: FeedVariant;
}) {
  const { profile } = useProfile();
  const { likes, bookmarks, follows, comments, replies, toggleLike, toggleBookmark, toggleFollow } =
    useContent();
  const notify = useToast();
  const own = ownPost(post);
  const author = own ? profile.name : post.name;
  const liked = likes.includes(post.id);
  const saved = bookmarks.includes(post.id);
  const images = post.images?.length ? post.images : post.image ? [post.image] : [];
  async function share() {
    try {
      await navigator.clipboard.writeText(
        new URL(paths.post(post.id), window.location.origin).href,
      );
      notify('动态链接已复制');
    } catch {
      notify('请从详情页地址栏分享链接');
    }
  }
  return (
    <article className={`post ${variant === 'world' ? 'tweet' : ''}`}>
      <div className="post-head">
        <Link to={contentRoutes.author(own ? 'me' : author)} aria-label={`查看${author}主页`}>
          <img
            className="avatar"
            src={own && profile.avatar ? profile.avatar : postAvatar(own ? 4 : post.id - 1)}
            alt={`${author}的头像`}
            loading="lazy"
          />
        </Link>
        <div>
          <Link className="post-author" to={contentRoutes.author(own ? 'me' : author)}>
            <strong>{author}</strong>
          </Link>
          <small>
            {post.tag}
            {post.id < 1000 && <span> · 2 小时前</span>}
          </small>
        </div>
        {!own && (
          <button
            className={`follow ${follows.includes(author) ? 'active' : ''}`}
            onClick={() => toggleFollow(author)}
          >
            {follows.includes(author) ? '已关注' : '+ 关注'}
          </button>
        )}
        <Link aria-label="动态操作" className="icon" to={contentRoutes.postActions(post.id)}>
          <MoreHorizontal size={19} />
        </Link>
      </div>
      <Link className="post-text-link" to={paths.post(post.id)}>
        <p className="post-text">{post.text}</p>
      </Link>
      {images.length > 0 && (
        <Link
          className={images.length > 1 ? 'post-photo-grid' : 'post-image'}
          aria-label="查看动态详情"
          to={paths.post(post.id)}
        >
          {images.slice(0, 9).map((image, index) => (
            <img
              key={`${index}-${image.slice(-20)}`}
              src={image}
              alt={`动态配图 ${index + 1}`}
              loading="lazy"
            />
          ))}
        </Link>
      )}
      {post.location && <small className="post-location">{post.location}</small>}
      <div className="post-foot">
        <button
          aria-label="点赞动态"
          aria-pressed={liked}
          className={liked ? 'liked' : ''}
          onClick={() => toggleLike(post.id)}
        >
          <Heart size={19} fill={liked ? 'currentColor' : 'none'} />
          {(post.likes + Number(liked)).toLocaleString()}
        </button>
        <Link aria-label="查看评论" to={paths.post(post.id)}>
          <MessageCircle size={19} />
          {2 + (comments[post.id]?.length ?? 0) + (replies[post.id]?.length ?? 0)}
        </Link>
        <button onClick={() => void share()}>
          <Send size={18} />
          分享
        </button>
        <button
          aria-label="收藏动态"
          aria-pressed={saved}
          className={`save ${saved ? 'liked' : ''}`}
          onClick={() => toggleBookmark(post.id)}
        >
          <Bookmark size={19} fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>
    </article>
  );
}
