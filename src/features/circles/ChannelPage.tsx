import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  CalendarDays,
  Check,
  ChevronRight,
  ExternalLink,
  Heart,
  ImageOff,
  LockKeyhole,
  MessageCircle,
  Plus,
  Send,
  Settings2,
  Volume2,
} from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router';
import { ChannelIcon } from './CircleIcons';
import { sampleEvents, sampleResources } from './fixtures';
import { circlePaths } from './routes';
import type { CirclePost } from './types';
import { canManage, useCircles } from './useCircles';

export function CircleAvatar({
  name,
  src,
  size = 40,
}: {
  name: string;
  src?: string;
  size?: number;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return (
    <span className="circle-content-avatar" style={{ width: size, height: size }}>
      {src && failedSrc !== src ? (
        <img src={src} alt={name} onError={() => setFailedSrc(src)} />
      ) : (
        <span aria-label={name}>{name.slice(0, 1)}</span>
      )}
    </span>
  );
}

export function CirclePostImage({ src, title }: { src: string; title: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const safe = /^https?:\/\//i.test(src);
  return safe && failedSrc !== src ? (
    <img
      className="circle-post-image"
      src={src}
      alt={title}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
    />
  ) : (
    <div className="circle-post-image-fallback">
      <ImageOff size={25} />
      <span>图片暂时无法显示</span>
    </div>
  );
}

export function CircleAccessState({
  title,
  description,
  circleId,
  joined = false,
}: {
  title: string;
  description: string;
  circleId?: string;
  joined?: boolean;
}) {
  return (
    <div className="circle-content-empty">
      <span className="circle-content-empty-icon">
        <LockKeyhole size={28} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      <Link
        className="primary"
        to={
          circleId
            ? joined
              ? circlePaths.home(circleId)
              : circlePaths.join(circleId)
            : circlePaths.list
        }
      >
        {circleId ? (joined ? '返回圈子首页' : '加入这个圈子') : '返回圈子列表'}
      </Link>
    </div>
  );
}

export function CirclePostCard({
  post,
  announcement = false,
}: {
  post: CirclePost;
  announcement?: boolean;
}) {
  return (
    <Link className="circle-post-card" to={circlePaths.post(post.circleId, post.id)}>
      {post.image && <CirclePostImage src={post.image} title={post.title} />}
      <div className="circle-post-card-body">
        <div className="circle-content-author">
          <CircleAvatar name={post.authorName} src={post.avatar} size={30} />
          <span>{post.authorName}</span>
          <time dateTime={new Date(post.createdAt).toISOString()}>
            {new Date(post.createdAt).toLocaleDateString('zh-CN', {
              month: 'long',
              day: 'numeric',
            })}
          </time>
        </div>
        {announcement && <span className="circle-content-badge">圈子公告</span>}
        <h2>{post.title}</h2>
        <p>{post.text}</p>
        <div className="circle-post-card-foot">
          <span>
            <Heart size={15} />
            {post.likes}
          </span>
          <span>
            <MessageCircle size={15} />
            {post.comments.length} 条回复
          </span>
          <ChevronRight size={17} />
        </div>
      </div>
    </Link>
  );
}

export default function ChannelPage() {
  const { circleId = '', channelId = '' } = useParams();
  return <ChannelContent key={JSON.stringify([circleId, channelId])} />;
}

function ChannelContent() {
  const { circleId = '', channelId = '' } = useParams();
  const {
    getCircle,
    getChannels,
    canViewChannel,
    getMessages,
    getPosts,
    sendMessage,
    markRead,
    toggleEvent,
    isAttending,
  } = useCircles();
  const circle = getCircle(circleId);
  const channel = getChannels(circleId).find((item) => item.id === channelId);
  const allowed = !!circle?.joined && !!channel && canViewChannel(circleId, channelId);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const marked = useRef('');
  const messageEnd = useRef<HTMLDivElement>(null);
  const messages = channel?.type === 'text' && allowed ? getMessages(circleId, channelId) : [];
  useEffect(() => {
    const key = JSON.stringify([circleId, channelId]);
    if (!allowed || marked.current === key) return;
    marked.current = key;
    try {
      markRead(circleId, channelId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '未能更新未读状态，请稍后重试。');
    }
  }, [allowed, circleId, channelId, markRead]);
  useEffect(() => {
    messageEnd.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [messages.length]);
  if (!circle)
    return (
      <CircleAccessState title="圈子不存在" description="这个圈子可能已解散，或链接已经失效。" />
    );
  if (!channel)
    return (
      <CircleAccessState
        title="频道不存在"
        description="这个频道可能已删除，回到圈子看看其他频道吧。"
        circleId={circleId}
        joined={circle.joined}
      />
    );
  if (!allowed)
    return (
      <CircleAccessState
        title={circle.joined ? '这是管理团队的频道' : '加入圈子，参与频道'}
        description={
          circle.joined
            ? '只有圈主和管理员可以查看这里的内容。你仍可访问其他成员频道。'
            : `加入「${circle.name}」后，就能与大家聊天、分享和参加活动。`
        }
        circleId={circleId}
        joined={circle.joined}
      />
    );
  if (channel.type === 'voice')
    return <Navigate to={circlePaths.voice(circleId, channelId)} replace />;
  const posts = getPosts(circleId, channelId);
  const canPublish =
    channel.type === 'forum' || (channel.type === 'announcement' && canManage(circle));
  function submitMessage(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    try {
      sendMessage(circleId, channelId, draft);
      setDraft('');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '消息发送失败，请重试。');
    }
  }
  function attend(eventId: string) {
    try {
      toggleEvent(circleId, eventId, channelId);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '报名状态未能保存，请重试。');
    }
  }
  return (
    <section className={`circle-content channel-content-${channel.type}`}>
      <header className="circle-content-header">
        <span className="circle-content-channel-icon">
          <ChannelIcon type={channel.type} size={25} />
        </span>
        <div>
          <h1>{channel.name}</h1>
          <p>{channel.description}</p>
        </div>
        {canManage(circle) && (
          <Link
            className="circle-content-settings"
            aria-label="频道设置"
            to={circlePaths.editChannel(circleId, channelId)}
          >
            <Settings2 size={20} />
          </Link>
        )}
        {canPublish && (
          <Link className="circle-content-publish" to={circlePaths.compose(circleId, channelId)}>
            <Plus size={18} />
            <span>{channel.type === 'announcement' ? '发布公告' : '发布帖子'}</span>
          </Link>
        )}
      </header>
      {error && (
        <p className="circle-content-error" role="alert">
          {error}
        </p>
      )}
      {channel.type === 'text' && (
        <>
          <div className="circle-message-list" aria-label="频道消息" role="log">
            <div className="circle-message-welcome">
              <span>
                <ChannelIcon type="text" size={30} />
              </span>
              <h2>从一句你好开始</h2>
              <p>这里是 #{channel.name}，每个新想法都值得被听见。</p>
            </div>
            {messages.map((message) => (
              <article
                className={`circle-message ${message.authorId === 'me' ? 'is-self' : ''}`}
                key={message.id}
              >
                <CircleAvatar name={message.authorName} src={message.avatar} />
                <div>
                  <div className="circle-message-meta">
                    <strong>{message.authorName}</strong>
                    <time dateTime={new Date(message.createdAt).toISOString()}>
                      {new Date(message.createdAt).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </div>
                  <p>{message.text}</p>
                </div>
              </article>
            ))}
            <div ref={messageEnd} />
          </div>
          <form className="circle-message-composer" onSubmit={submitMessage}>
            <label className="sr-only" htmlFor="circle-message-draft">
              发送到 {channel.name}
            </label>
            <textarea
              id="circle-message-draft"
              placeholder={`发送消息到 #${channel.name}`}
              value={draft}
              maxLength={2000}
              rows={1}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  event.nativeEvent.keyCode !== 229
                ) {
                  event.preventDefault();
                  submitMessage(event);
                }
              }}
            />
            <button type="submit" disabled={!draft.trim()} aria-label="发送消息">
              <Send size={20} />
            </button>
          </form>
        </>
      )}
      {(channel.type === 'forum' || channel.type === 'announcement') && (
        <div className="circle-content-body">
          <div className="circle-content-section-meta">
            <span>
              {channel.type === 'announcement' ? '来自管理团队的消息' : '分享灵感，留下生活的切片'}
            </span>
            <b>
              {posts.length} 篇{channel.type === 'announcement' ? '公告' : '帖子'}
            </b>
          </div>
          {posts.length ? (
            <div
              className={`circle-post-grid ${channel.type === 'announcement' ? 'is-announcements' : ''}`}
            >
              {posts.map((post) => (
                <CirclePostCard
                  key={post.id}
                  post={post}
                  announcement={channel.type === 'announcement'}
                />
              ))}
            </div>
          ) : (
            <div className="circle-content-empty">
              <MessageCircle size={32} />
              <h2>{channel.type === 'announcement' ? '还没有公告' : '第一篇帖子，等你来写'}</h2>
              <p>
                {canPublish ? '把想分享的内容留在这里，大家会看见。' : '新的圈子消息会出现在这里。'}
              </p>
              {canPublish && (
                <Link className="primary" to={circlePaths.compose(circleId, channelId)}>
                  开始发布
                </Link>
              )}
            </div>
          )}
        </div>
      )}
      {channel.type === 'events' && (
        <div className="circle-content-body">
          <div className="circle-content-section-meta">
            <span>把线上相遇，变成一起出发</span>
            <b>{sampleEvents.length} 个活动</b>
          </div>
          <div className="circle-events-list">
            {sampleEvents.map((event, index) => {
              const attending = isAttending(circleId, event.id, channelId);
              return (
                <article className="circle-event-card" key={`${circleId}/${event.id}`}>
                  <div className={`circle-event-art circle-event-art-${index % 3}`}>
                    <CalendarDays size={40} />
                    <span>TOGETHER / 一起发生</span>
                  </div>
                  <div className="circle-event-body">
                    <span className="circle-content-badge">圈子活动</span>
                    <h2>{event.title}</h2>
                    <p>{event.description}</p>
                    <div className="circle-event-details">
                      <span>
                        <CalendarDays size={15} />
                        {event.date}
                      </span>
                      <span>{event.location}</span>
                    </div>
                    <button
                      className={attending ? 'secondary' : 'primary'}
                      aria-pressed={attending}
                      onClick={() => attend(event.id)}
                    >
                      {attending ? (
                        <>
                          <Check size={16} />
                          已报名 · 点击取消
                        </>
                      ) : (
                        '报名参加'
                      )}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
      {channel.type === 'resources' && (
        <div className="circle-content-body">
          <div className="circle-content-section-meta">
            <span>好用的工具和值得收藏的内容</span>
            <b>{sampleResources.length} 份资料</b>
          </div>
          <div className="circle-resource-list">
            {sampleResources.map((resource, index) => {
              const local = /^\/(?!\/)/.test(resource.href);
              const content = (
                <>
                  <span className={`circle-resource-icon tone-${index % 3}`}>
                    <ChannelIcon type="resources" size={27} />
                  </span>
                  <div>
                    <h2>{resource.title}</h2>
                    <p>{resource.description}</p>
                    <span>
                      {local
                        ? '站内精选 · 点击浏览'
                        : (() => {
                            try {
                              return new URL(resource.href).hostname;
                            } catch {
                              return '链接暂不可用';
                            }
                          })()}
                    </span>
                  </div>
                  {local ? <ChevronRight size={18} /> : <ExternalLink size={18} />}
                </>
              );
              return local ? (
                <Link
                  className="circle-resource-card"
                  to={resource.href}
                  key={`${circleId}/${resource.id}`}
                >
                  {content}
                </Link>
              ) : (
                <a
                  className="circle-resource-card"
                  href={/^https?:\/\//i.test(resource.href) ? resource.href : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  key={`${circleId}/${resource.id}`}
                >
                  {content}
                </a>
              );
            })}
          </div>
          <p className="circle-resource-note">收藏圈子里的好内容，让灵感随时可寻。</p>
        </div>
      )}
      {channel.type === 'announcement' && !canManage(circle) && (
        <p className="circle-content-readonly">
          <Volume2 size={15} />
          仅管理团队可以发布公告，你可以在详情里参与讨论。
        </p>
      )}
    </section>
  );
}
