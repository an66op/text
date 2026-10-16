import { Bookmark, ChevronLeft, ChevronRight, Heart, MessageCircle, Share2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { useContent } from '../useContent';
import { demoVideo, postAvatar, shortVideos } from '../fixtures';
import { usePreferences } from '@/features/profile/preferences';
import { useToast } from '@/shared/ui/useToast';
import { paths } from '@/shared/config/paths';
import { contentRoutes } from '../domain';

export default function ShortVideoFeed({ query }: { query: string }) {
  const [params, setParams] = useSearchParams();
  const { likes, bookmarks, comments, replies, follows, toggleLike, toggleBookmark, toggleFollow } =
    useContent();
  const [preferences] = usePreferences();
  const notify = useToast();
  const visible = shortVideos.filter((video) =>
    `${video.author} ${video.text}`.includes(query.trim()),
  );
  const index = Math.max(
    0,
    visible.findIndex((item) => item.id === Number(params.get('video'))),
  );
  const video = visible[index];
  if (!video) return <div className="empty">没有找到相关短视频。</div>;
  const liked = likes.includes(video.id);
  const saved = bookmarks.includes(video.id);
  function select(offset: number) {
    const selected = visible[(index + offset + visible.length) % visible.length];
    setParams({ video: String(selected.id) }, { replace: true });
  }
  return (
    <div className="short-video" style={{ backgroundImage: `url(${video.image})` }}>
      <video
        className="short-player"
        key={video.id}
        controls
        autoPlay={preferences['自动播放预览'] ?? true}
        muted
        loop
        playsInline
        poster={video.image}
        src={demoVideo}
        aria-label={`${video.author}的短视频`}
      />
      <small className="short-media-note">
        CC0 演示素材 · {index + 1} / {visible.length}
      </small>
      <div className="short-caption">
        <Link to={contentRoutes.author(video.author)}>
          <h2>@{video.author}</h2>
        </Link>
        <p>{video.text}</p>
        <span>♫ 山海之间 · 原声</span>
      </div>
      <aside>
        <Link aria-label={`查看${video.author}主页`} to={contentRoutes.author(video.author)}>
          <img className="avatar" src={postAvatar(index)} alt={video.author} />
        </Link>
        <button
          aria-label="关注短视频作者"
          aria-pressed={follows.includes(video.author)}
          onClick={() => toggleFollow(video.author)}
        >
          {follows.includes(video.author) ? '已关注' : '+ 关注'}
        </button>
        <button aria-label="点赞短视频" aria-pressed={liked} onClick={() => toggleLike(video.id)}>
          <Heart fill={liked ? '#fb7185' : 'none'} />
          {(video.likes + Number(liked)).toLocaleString()}
        </button>
        <Link aria-label="短视频评论" to={contentRoutes.shortComments(video.id)}>
          <MessageCircle />
          {2 + (comments[video.id]?.length ?? 0) + (replies[video.id]?.length ?? 0)}
        </Link>
        <button
          aria-label="收藏短视频"
          aria-pressed={saved}
          onClick={() => toggleBookmark(video.id)}
        >
          <Bookmark fill={saved ? 'white' : 'none'} />
          {saved ? '已收藏' : '收藏'}
        </button>
        <button
          aria-label="分享短视频"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                new URL(`${paths.shorts}?video=${video.id}`, window.location.origin).href,
              );
              notify('短视频链接已复制');
            } catch {
              notify('从地址栏复制链接即可分享');
            }
          }}
        >
          <Share2 />
          分享
        </button>
      </aside>
      <div className="short-switch">
        <button aria-label="上一条短视频" onClick={() => select(-1)}>
          <ChevronLeft size={18} />
          上一条
        </button>
        <button onClick={() => select(1)}>
          下一条
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
