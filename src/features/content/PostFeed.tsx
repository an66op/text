import { useMemo } from 'react';
import { useContent } from './useContent';
import { visiblePosts } from './content-model';
import PostCard from './components/PostCard';
import type { FeedTab, FeedVariant } from './types';

export default function PostFeed({
  variant = 'moments',
  query = '',
  tab = '推荐',
  author,
}: {
  variant?: FeedVariant;
  query?: string;
  tab?: FeedTab;
  author?: string;
}) {
  const { posts, likes } = useContent();
  const visible = useMemo(
    () =>
      visiblePosts(
        posts.filter((post) =>
          author
            ? author === '__self__'
              ? post.owner === true
              : post.name === author && !post.owner
            : variant === 'world'
              ? post.target === 'world' || post.kind === '世界'
              : post.target !== 'world' && post.kind !== '世界',
        ),
        query,
        tab,
        likes,
      ),
    [posts, query, tab, likes, variant, author],
  );
  return (
    <div className={variant === 'moments' ? 'messenger-moments' : 'world-feed'}>
      {visible.map((post) => (
        <PostCard key={post.id} post={post} variant={variant} />
      ))}
      {visible.length === 0 && <div className="empty">这里还没有动态，分享一段生活吧。</div>}
    </div>
  );
}
