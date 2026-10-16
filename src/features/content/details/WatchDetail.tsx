import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Bookmark, Heart, Send } from 'lucide-react';
import { useProfile } from '@/features/profile/useProfile';
import { usePreferences } from '@/features/profile/preferences';
import { useToast } from '@/shared/ui/useToast';
import { paths } from '@/shared/config/paths';
import { useContent } from '../useContent';
import { contentRoutes, seededComments, stableNumber } from '../domain';
import { catalog, demoVideo, postAvatar } from '../fixtures';
import type { CatalogItem } from '../types';

export default function WatchDetail({ item }: { item: CatalogItem }) {
  const { profile } = useProfile();
  const [preferences] = usePreferences();
  const {
    follows,
    likes,
    bookmarks,
    comments,
    liveMessages,
    videoProgress,
    toggleFollow,
    toggleLike,
    toggleBookmark,
    addComment,
    addLiveMessage,
    saveVideoProgress,
  } = useContent();
  const [episode, setEpisode] = useState(videoProgress[item.id]?.episode ?? 1);
  const [draft, setDraft] = useState('');
  const [bullet, setBullet] = useState('');
  const [bulletEnabled, setBulletEnabled] = useState(true);
  const [tab, setTab] = useState('简介');
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSaved = useRef(0);
  const notify = useToast();
  const live = item.module === '直播';
  const author = item.author ?? (live ? item.desc.split(' · ')[0] : '山野来信');
  const number = stableNumber(item.id);
  function save() {
    const seconds = videoRef.current?.currentTime ?? 0;
    lastSaved.current = seconds;
    saveVideoProgress(item.id, episode, seconds);
  }
  async function share() {
    try {
      await navigator.clipboard.writeText(
        new URL(paths.watch(item.id), window.location.origin).href,
      );
      notify('观看链接已复制');
    } catch {
      notify('请从地址栏分享观看链接');
    }
  }
  return (
    <div className={`watch-page ${live ? 'live-room' : ''}`}>
      <div className="video-demo">
        <video
          ref={videoRef}
          key={episode}
          controls
          autoPlay={preferences['自动播放预览'] ?? true}
          playsInline
          poster={item.img}
          src={demoVideo}
          aria-label={item.title}
          onLoadedMetadata={() => {
            const progress = videoProgress[item.id];
            if (
              !live &&
              progress?.episode === episode &&
              videoRef.current &&
              progress.seconds < videoRef.current.duration
            )
              videoRef.current.currentTime = progress.seconds;
          }}
          onTimeUpdate={() => {
            if (!live && Math.abs((videoRef.current?.currentTime ?? 0) - lastSaved.current) >= 2)
              save();
          }}
          onPause={() => {
            if (!live) save();
          }}
          onEnded={() => {
            if (!live) save();
          }}
        />
        {bulletEnabled && bullet && (
          <span className="bullet" key={bullet}>
            {bullet}
          </span>
        )}
        {live && <span className="live-badge">● 直播体验</span>}
      </div>
      <small className="media-disclosure">
        CC0 演示素材{live ? ' · 聊天消息保存在本机' : ` · 第 ${episode} 集 · 自动记录播放进度`}
      </small>
      <div className="content-page watch-info">
        <h2>{item.title}</h2>
        <p className="content-note">{item.desc}</p>
        <div className="watch-author">
          <Link to={contentRoutes.author(author)}>
            <img src={postAvatar(0)} alt={author} />
            <strong>{author}</strong>
          </Link>
          <button
            className={follows.includes(author) ? 'secondary' : 'primary'}
            onClick={() => toggleFollow(author)}
          >
            {follows.includes(author) ? '已关注' : '+ 关注'}
          </button>
        </div>
        <div className="watch-actions">
          <button aria-pressed={likes.includes(number)} onClick={() => toggleLike(number)}>
            <Heart size={19} fill={likes.includes(number) ? 'currentColor' : 'none'} />
            喜欢{likes.includes(number) ? ' · 1' : ''}
          </button>
          <button aria-pressed={bookmarks.includes(number)} onClick={() => toggleBookmark(number)}>
            <Bookmark size={19} fill={bookmarks.includes(number) ? 'currentColor' : 'none'} />
            {bookmarks.includes(number) ? '已收藏' : '收藏'}
          </button>
          <button onClick={() => void share()}>
            <Send size={18} />
            分享
          </button>
          <button
            className={bulletEnabled ? 'text-primary' : ''}
            onClick={() => setBulletEnabled(!bulletEnabled)}
          >
            弹幕 {bulletEnabled ? '开' : '关'}
          </button>
        </div>
        {live ? (
          <section className="live-chat">
            <h3>聊天室 · {3 + (liveMessages[item.id]?.length ?? 0)} 条消息</h3>
            <div className="live-chat-scroll">
              <p>
                <strong>北岛</strong>晚上好，今天也来这里放松一下。
              </p>
              <p>
                <strong>Mia</strong>这个画面好舒服！
              </p>
              <p>
                <strong>阿川</strong>一起看风景，记得喝水。
              </p>
              {(liveMessages[item.id] ?? []).map((message, index) => (
                <p key={`${index}-${message}`}>
                  <strong>{profile.name}</strong>
                  {message}
                </p>
              ))}
            </div>
            <form
              className="inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!draft.trim()) return;
                addLiveMessage(item.id, draft);
                setBullet(draft.trim());
                setDraft('');
              }}
            >
              <input
                aria-label="直播聊天内容"
                placeholder="和主播、伙伴聊一聊…"
                maxLength={200}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <button className="primary" disabled={!draft.trim()}>
                发送
              </button>
            </form>
          </section>
        ) : (
          <>
            <h3>选集 · 共 6 集</h3>
            <div className="episode-list">
              {[1, 2, 3, 4, 5, 6].map((value) => (
                <button
                  key={value}
                  className={episode === value ? 'selected-episode' : ''}
                  aria-label={`第 ${value} 集`}
                  aria-pressed={episode === value}
                  onClick={() => {
                    save();
                    setEpisode(value);
                    saveVideoProgress(item.id, value, 0);
                    lastSaved.current = 0;
                    setBullet('');
                  }}
                >
                  {value}
                </button>
              ))}
            </div>
            <form
              className="inline-form watch-bullet-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!draft.trim()) return;
                setBullet(draft.trim());
                setBulletEnabled(true);
                setDraft('');
              }}
            >
              <input
                aria-label="弹幕内容"
                placeholder="发一条友善的弹幕…"
                maxLength={100}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <button className="primary" disabled={!draft.trim()}>
                发送弹幕
              </button>
            </form>
            <div className="feed-tabs">
              {['简介', '评论'].map((label) => (
                <button
                  key={label}
                  className={tab === label ? 'active' : ''}
                  onClick={() => setTab(label)}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === '简介' ? (
              <p className="book-introduction">
                跟随镜头走过山海和城市，寻找那些值得停留的瞬间。一部关于生活与发现的影像记录。各集使用公开演示素材，选集与播放进度独立保存。
              </p>
            ) : (
              <VideoComments
                id={number}
                comments={comments[number] ?? []}
                name={profile.name}
                addComment={addComment}
              />
            )}
          </>
        )}
        <h3>{live ? '更多直播间' : '接着看'}</h3>
        <div className="watch-recommendations">
          {catalog[live ? '直播' : '视频']
            .filter((other) => other.id !== item.id)
            .slice(0, 3)
            .map((other) => (
              <Link key={other.id} to={paths.watch(other.id)}>
                <img src={other.img} alt={other.title} />
                <strong>{other.title}</strong>
              </Link>
            ))}
        </div>
      </div>
    </div>
  );
}
function VideoComments({
  id,
  comments,
  name,
  addComment,
}: {
  id: number;
  comments: string[];
  name: string;
  addComment: (id: number, text: string) => void;
}) {
  const [draft, setDraft] = useState('');
  return (
    <section className="comment-thread">
      {seededComments.map((comment) => (
        <p className="comment" key={comment.key}>
          <strong>{comment.author}</strong>
          {comment.text}
        </p>
      ))}
      {comments.map((comment, index) => (
        <p className="comment" key={`${index}-${comment}`}>
          <strong>{name}</strong>
          {comment}
        </p>
      ))}
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          addComment(id, draft);
          setDraft('');
        }}
      >
        <input
          aria-label="视频评论内容"
          maxLength={500}
          placeholder="写下观后感…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button className="primary" disabled={!draft.trim()}>
          发送
        </button>
      </form>
    </section>
  );
}
