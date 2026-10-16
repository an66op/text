import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Bell,
  BellOff,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  ImagePlus,
  MessageCircle,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  Send,
  X,
} from 'lucide-react';
import { Link } from 'react-router';
import { socialPaths } from './routes';
import { useSocialChannels } from './useSocialChannels';
import { broadcastReactions } from './social-channels-model';
import ChannelMedia from './ChannelMedia';

export default function ChannelTimeline({
  channelId,
  profileName,
}: {
  channelId: string;
  profileName: string;
}) {
  const { channels, setSubscription, publish, toggleReaction, setMuted, pinPost, markViewed } =
    useSocialChannels();
  const channel = channels.find((item) => item.id === channelId);
  const [draft, setDraft] = useState('');
  const [image, setImage] = useState('');
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const visited = useRef(new Set<string>());
  const bottom = useRef<HTMLDivElement>(null);
  const messageRefs = useRef(new Map<string, HTMLElement>());
  const count = channel?.posts.length || 0;
  useEffect(() => {
    for (const post of channel?.posts || []) {
      if (post.viewed || visited.current.has(post.id)) continue;
      visited.current.add(post.id);
      try {
        markViewed(channelId, post.id);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '浏览状态未能保存，请稍后重试。');
      }
    }
  }, [channel?.posts, channelId, markViewed]);
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [channelId, count]);
  function attempt(action: () => void, message = '') {
    try {
      action();
      setError('');
      setNotice(message);
    } catch (cause) {
      setNotice('');
      setError(cause instanceof Error ? cause.message : '操作未能保存，请重试。');
    }
  }
  function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() && !image.trim()) return;
    attempt(() => {
      publish(channelId, draft, profileName, image.trim() || undefined);
      setDraft('');
      setImage('');
      setAttachmentOpen(false);
    }, '广播已发布。');
  }
  if (!channel)
    return (
      <section className="im-chat tg-channel">
        <header className="tg-channel-header">
          <Link className="tg-back" aria-label="返回频道列表" to={socialPaths.channels}>
            <ChevronLeft size={24} />
          </Link>
          <strong>频道</strong>
        </header>
        <div className="social-channel-empty">
          <MessageCircle size={34} />
          <h2>频道不存在</h2>
          <p>这个频道可能已删除，或未保存在当前设备。</p>
          <Link className="im-primary" to={socialPaths.channels}>
            返回频道列表
          </Link>
        </div>
      </section>
    );
  const own = channel.ownerId === 'me';
  const sorted = [...channel.posts].sort((a, b) => a.createdAt - b.createdAt);
  const pinned = channel.posts.find((post) => post.id === channel.pinnedPostId);
  return (
    <section className="im-chat tg-channel" aria-label={`${channel.name}频道时间线`}>
      <header className="tg-channel-header">
        <Link className="tg-back" aria-label="返回频道列表" to={socialPaths.channels}>
          <ChevronLeft size={24} />
        </Link>
        <Link
          className="tg-channel-heading"
          to={socialPaths.channelInfo(channelId)}
          aria-label={`查看${channel.name}频道信息`}
        >
          <span className="social-channel-icon">{channel.icon}</span>
          <span>
            <h1>
              {channel.name}
              {channel.muted && <BellOff size={13} />}
            </h1>
            <small>{channel.subscriberCount.toLocaleString('zh-CN')} 位订阅者</small>
          </span>
        </Link>
        <Link
          className="tg-channel-more"
          to={socialPaths.channelInfo(channelId)}
          aria-label="频道信息"
        >
          <MoreHorizontal size={24} />
        </Link>
      </header>
      {pinned && (
        <button
          className="tg-pinned-bar"
          onClick={() =>
            messageRefs.current
              .get(pinned.id)
              ?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
          }
        >
          <Pin size={19} />
          <span>
            <strong>置顶消息</strong>
            <span>{pinned.text || '图片消息'}</span>
          </span>
          <ChevronDown size={17} />
        </button>
      )}
      <div className="tg-timeline" role="log" aria-label="频道广播">
        <div className="tg-channel-history-start">
          <span>频道已创建</span>
        </div>
        {sorted.map((post, index) => {
          const day = new Date(post.createdAt).toLocaleDateString('zh-CN', {
            month: 'long',
            day: 'numeric',
          });
          const previousDay = index
            ? new Date(sorted[index - 1].createdAt).toLocaleDateString('zh-CN', {
                month: 'long',
                day: 'numeric',
              })
            : '';
          const reactions = [
            ...new Set([...Object.keys(post.reactions || {}), ...broadcastReactions]),
          ];
          const comments = post.comments || [];
          return (
            <Fragment key={post.id}>
              {day !== previousDay && (
                <div className="tg-date-separator">
                  <time dateTime={new Date(post.createdAt).toISOString().slice(0, 10)}>{day}</time>
                </div>
              )}
              <article
                className="tg-message"
                ref={(element) => {
                  if (element) messageRefs.current.set(post.id, element);
                  else messageRefs.current.delete(post.id);
                }}
                aria-label={`${channel.name}的广播`}
                data-message-id={post.id}
              >
                <div className="tg-message-channel">
                  <strong>{channel.name}</strong>
                  {own && (
                    <button
                      aria-label={post.id === channel.pinnedPostId ? '取消置顶消息' : '置顶消息'}
                      title={post.id === channel.pinnedPostId ? '取消置顶' : '置顶消息'}
                      onClick={() =>
                        attempt(
                          () =>
                            pinPost(channelId, post.id === channel.pinnedPostId ? null : post.id),
                          post.id === channel.pinnedPostId ? '已取消置顶。' : '已置顶消息。',
                        )
                      }
                    >
                      {post.id === channel.pinnedPostId ? <PinOff size={14} /> : <Pin size={14} />}
                    </button>
                  )}
                </div>
                {post.image && <ChannelMedia src={post.image} name={`${channel.name}的图片消息`} />}
                {post.text && <p className="tg-message-text">{post.text}</p>}
                <div className="tg-message-bottom">
                  <div className="tg-reactions" aria-label="消息表态">
                    {reactions.map((emoji) => (
                      <button
                        key={emoji}
                        aria-label={`${emoji}表态`}
                        aria-pressed={post.myReaction === emoji}
                        disabled={!channel.subscribed && !own}
                        title={!channel.subscribed && !own ? '订阅频道后可表态' : undefined}
                        className={post.myReaction === emoji ? 'is-selected' : ''}
                        onClick={() => attempt(() => toggleReaction(channelId, post.id, emoji))}
                      >
                        <span>{emoji}</span>
                        {(post.reactions?.[emoji] || 0) > 0 && (
                          <small>{post.reactions?.[emoji]}</small>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="tg-message-meta">
                    <span aria-label={`${(post.views || 0).toLocaleString('zh-CN')} 次浏览`}>
                      <Eye size={12} />
                      {(post.views || 0).toLocaleString('zh-CN')}
                    </span>
                    {post.id === channel.pinnedPostId && <Pin size={10} />}
                    <time dateTime={new Date(post.createdAt).toISOString()}>
                      {new Date(post.createdAt).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </div>
                </div>
                {channel.discussionEnabled !== false && (
                  <Link
                    className="tg-message-comments"
                    to={socialPaths.channelComments(channelId, post.id)}
                  >
                    <span className="tg-comment-avatar-stack">
                      {comments.length ? (
                        comments
                          .slice(-3)
                          .map((comment) => (
                            <i key={comment.id}>{comment.authorName.slice(0, 1)}</i>
                          ))
                      ) : (
                        <MessageCircle size={16} />
                      )}
                    </span>
                    <strong>{comments.length ? `${comments.length} 条评论` : '发表评论'}</strong>
                    <ChevronRight size={16} />
                  </Link>
                )}
              </article>
            </Fragment>
          );
        })}
        {!sorted.length && (
          <div className="tg-no-messages">
            <span>还没有广播</span>
            <p>{own ? '以频道身份，发布第一条消息。' : '新消息会出现在这里。'}</p>
          </div>
        )}
        <div ref={bottom} />
      </div>
      {error && (
        <p className="tg-channel-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <span className="tg-visually-hidden" role="status">
          {notice}
        </span>
      )}
      {own ? (
        <div className="tg-admin-composer">
          {attachmentOpen && (
            <div className="tg-attachment-panel">
              <label htmlFor="broadcast-image">图片链接</label>
              <input
                id="broadcast-image"
                type="url"
                placeholder="https://…"
                value={image}
                onChange={(event) => setImage(event.target.value)}
              />
              <button
                aria-label="移除图片"
                onClick={() => {
                  setImage('');
                  setAttachmentOpen(false);
                }}
              >
                <X size={17} />
              </button>
            </div>
          )}
          <form onSubmit={send}>
            <button
              className="tg-attach"
              type="button"
              aria-label="添加图片"
              aria-expanded={attachmentOpen}
              onClick={() => setAttachmentOpen(!attachmentOpen)}
            >
              <ImagePlus size={23} />
            </button>
            <label className="tg-visually-hidden" htmlFor="broadcast-draft">
              发布广播
            </label>
            <textarea
              id="broadcast-draft"
              placeholder={`以 ${channel.name} 身份发布消息`}
              rows={1}
              maxLength={5000}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  event.nativeEvent.keyCode !== 229
                ) {
                  event.preventDefault();
                  send(event);
                }
              }}
            />
            <button
              className="tg-send"
              type="submit"
              aria-label="发布广播"
              disabled={!draft.trim() && !image.trim()}
            >
              <Send size={21} />
            </button>
          </form>
        </div>
      ) : (
        <div className="tg-subscriber-toolbar">
          {channel.subscribed ? (
            <button
              onClick={() =>
                attempt(
                  () => setMuted(channelId, !channel.muted),
                  channel.muted ? '频道通知已开启。' : '频道已静音。',
                )
              }
              aria-pressed={!!channel.muted}
            >
              {channel.muted ? <Bell size={19} /> : <BellOff size={19} />}
              {channel.muted ? '开启通知' : '关闭通知'}
            </button>
          ) : (
            <button onClick={() => attempt(() => setSubscription(channelId, true), '已订阅频道。')}>
              <Plus size={20} />
              订阅频道
            </button>
          )}
        </div>
      )}
    </section>
  );
}
