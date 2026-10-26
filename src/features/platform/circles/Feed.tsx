import { useState } from 'react';
import { Heart, MessageCircle, Pin, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { hostedImageId } from '@/shared/api/media-url';
import { PlatformAvatar, PlatformError } from '../PlatformUi';
import { shortTime } from '../platform-format';
import { circlesApi } from './api';
import { useCircle } from './circle-context';
import { circlePaths } from './paths';
import { useMutation } from './useMutation';
import { useResource } from './useResource';
import { Empty, Pagination } from './Ui';
import type { Channel, Post } from './types';

export default function Feed({ channel, channels }: { channel?: Channel; channels?: Channel[] }) {
  const { circle, deny } = useCircle();
  const [view, setView] = useState('all'),
    [page, setPage] = useState(0);
  const list = useResource(
    `${circle.id}:${channel?.id}:${view}:${page}`,
    (signal) =>
      circlesApi.posts(
        circle.id,
        { channelId: channel?.id, view, limit: 20, offset: page * 20 },
        signal,
      ),
    deny,
  );
  return (
    <section className="sc-feed" aria-label="圈内动态">
      <div className="sc-tabs sc-feed-tabs" role="tablist" aria-label="动态筛选">
        {(
          [
            ['all', '全部'],
            ['featured', '精华'],
            ['owner', '圈主'],
            ['photos', '图片'],
          ] as const
        ).map(([id, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={view === id}
            key={id}
            onClick={() => {
              setView(id);
              setPage(0);
            }}
          >
            {label}
          </button>
        ))}
        <button
          className="sc-text-button"
          type="button"
          onClick={list.refresh}
          aria-label="刷新圈内动态"
        >
          刷新
        </button>
      </div>
      <PlatformError message={list.error} retry={list.refresh} />
      {list.loading ? (
        <Empty>正在读取圈内动态…</Empty>
      ) : list.data?.items.length ? (
        list.data.items.map((post) => (
          <FeedCard
            key={post.id}
            post={post}
            writable={
              circle.status === 'active' &&
              !(channel || channels?.find((entry) => entry.id === post.channelId))?.archived &&
              !!(channel || channels?.some((entry) => entry.id === post.channelId))
            }
            replace={(updated) => {
              if (list.data)
                list.replace({
                  ...list.data,
                  items: list.data.items.map((item) => (item.id === updated.id ? updated : item)),
                });
            }}
          />
        ))
      ) : (
        !list.error && <Empty>还没有这类分享，从一个灵感开始。</Empty>
      )}
      <Pagination
        page={page}
        total={list.data?.total ?? 0}
        disabled={list.loading}
        onPage={setPage}
      />
    </section>
  );
}
export function PostImages({ images }: { images: string[] }) {
  return images.length ? (
    <div className={`sc-post-images ${images.length === 1 ? 'single' : ''}`}>
      {images
        .filter((src) => !!hostedImageId(src))
        .slice(0, 9)
        .map((src, index) => (
          <a href={src} key={`${src}:${index}`} target="_blank" rel="noreferrer">
            <img src={src} alt={`圈内图片 ${index + 1}`} loading="lazy" />
          </a>
        ))}
    </div>
  ) : null;
}
export function FeedCard({
  post,
  replace,
  writable,
}: {
  post: Post;
  replace: (post: Post) => void;
  writable: boolean;
}) {
  const { circle, deny } = useCircle();
  const mutation = useMutation(deny);
  return (
    <article className="sc-feed-card">
      <header>
        <PlatformAvatar user={post.author} />
        <div>
          <strong>
            {post.author.name}
            {post.author.id === circle.owner.id && <b>圈主</b>}
          </strong>
          <small>{shortTime(post.createdAt)}</small>
        </div>
        <span className="sc-post-badges">
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
      <Link to={circlePaths.post(circle.id, post.id)} className="sc-post-copy">
        <h2>{post.title}</h2>
        <p>{post.body}</p>
      </Link>
      <PostImages images={post.images} />
      <footer>
        <button
          type="button"
          aria-label={`${post.liked ? '取消点赞' : '点赞'}：${post.title}`}
          aria-pressed={post.liked}
          disabled={mutation.busy || !writable}
          onClick={async () => {
            const next = await mutation.run((signal) =>
              circlesApi.like(circle.id, post.id, !post.liked, signal),
            );
            if (next) replace(next);
          }}
        >
          <Heart size={17} fill={post.liked ? 'currentColor' : 'none'} />
          {post.likeCount || '喜欢'}
        </button>
        <Link to={`${circlePaths.post(circle.id, post.id)}#comments`}>
          <MessageCircle size={17} />
          {post.commentCount || '评论'}
        </Link>
        <Link to={circlePaths.post(circle.id, post.id)}>展开 ↗</Link>
      </footer>
      <PlatformError message={mutation.error} />
    </article>
  );
}
