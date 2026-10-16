import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Bell,
  BellOff,
  Check,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Plus,
  Radio,
  Send,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { useProfile } from '@/features/profile/useProfile';
import PageHeader from '@/shared/ui/PageHeader';
import { SocialPageFrame } from './SocialPageParts';
import { socialPaths } from './routes';
import { useSocialChannels } from './useSocialChannels';
import SocialPage from './SocialPage';
import ChannelMedia from './ChannelMedia';

const icons = ['📣', '🪐', '🌇', '🎨', '📚', '🎵'];
export default function SocialChannelPage({
  kind,
}: {
  kind: 'detail' | 'create' | 'info' | 'comments';
}) {
  const { channelId = '', postId = '' } = useParams();
  if (kind === 'detail') return <SocialPage />;
  if (kind === 'create') return <ChannelCreate />;
  return kind === 'info' ? (
    <ChannelInfo key={channelId} />
  ) : (
    <ChannelComments key={JSON.stringify([channelId, postId])} />
  );
}

function ChannelInfo() {
  const { channelId = '' } = useParams();
  const { channels, setSubscription, setMuted } = useSocialChannels();
  const channel = channels.find((item) => item.id === channelId);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  function attempt(action: () => void, message: string) {
    try {
      action();
      setError('');
      setNotice(message);
    } catch (cause) {
      setNotice('');
      setError(cause instanceof Error ? cause.message : '操作未能保存，请重试。');
    }
  }
  if (!channel) return <ChannelMissing />;
  const media = channel.posts.filter((post) => post.image).slice(0, 6);
  const latest = [...channel.posts].sort((a, b) => b.createdAt - a.createdAt)[0];
  return (
    <SocialPageFrame title="频道信息" backTo={socialPaths.channel(channelId)}>
      <div className="tg-channel-info">
        <header className="tg-info-profile">
          <span className="social-channel-icon">{channel.icon}</span>
          <h1>{channel.name}</h1>
          <p>{channel.subscriberCount.toLocaleString('zh-CN')} 位订阅者</p>
          <span>{channel.ownerId === 'me' ? '我创建的频道' : '公开频道'}</span>
        </header>
        <section className="tg-info-description">
          <h2>介绍</h2>
          <p>{channel.description}</p>
          {channel.username && <span>@{channel.username}</span>}
        </section>
        <div className="tg-info-settings">
          <button
            disabled={!channel.subscribed}
            onClick={() =>
              attempt(
                () => setMuted(channelId, !channel.muted),
                channel.muted ? '频道通知已开启。' : '频道已静音。',
              )
            }
            aria-pressed={!!channel.muted}
          >
            {channel.muted ? <BellOff size={20} /> : <Bell size={20} />}
            <span>
              <strong>通知</strong>
              <small>
                {channel.subscribed ? (channel.muted ? '已静音' : '已开启') : '订阅后可设置'}
              </small>
            </span>
            <i className={channel.subscribed && !channel.muted ? 'on' : ''} />
          </button>
          {channel.discussionEnabled !== false && latest && (
            <Link to={socialPaths.channelComments(channelId, latest.id)}>
              <MessageCircle size={20} />
              <span>
                <strong>讨论</strong>
                <small>每条消息都有独立的评论</small>
              </span>
              <ChevronRight size={18} />
            </Link>
          )}
        </div>
        {media.length > 0 && (
          <section className="tg-info-media">
            <h2>
              媒体 <span>{media.length}</span>
            </h2>
            <div>
              {media.map((post) => (
                <Link
                  key={post.id}
                  to={socialPaths.channel(channelId)}
                  aria-label="返回频道查看图片"
                >
                  <ChannelMedia src={post.image!} name={`${channel.name}的图片消息`} />
                </Link>
              ))}
            </div>
          </section>
        )}
        {error && (
          <p className="social-channel-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="social-channel-notice" role="status">
            {notice}
          </p>
        )}
        {channel.ownerId === 'me' ? (
          <Link className="tg-info-subscribe" to={socialPaths.channel(channelId)}>
            <Send size={17} />
            返回频道发布
          </Link>
        ) : (
          <button
            className={`tg-info-subscribe ${channel.subscribed ? 'is-subscribed' : ''}`}
            onClick={() =>
              attempt(
                () => setSubscription(channelId, !channel.subscribed),
                channel.subscribed ? '已取消订阅。' : '已订阅频道。',
              )
            }
            aria-pressed={channel.subscribed}
          >
            {channel.subscribed ? (
              <>
                <Check size={17} />
                已订阅 · 取消订阅
              </>
            ) : (
              <>
                <Plus size={17} />
                订阅频道
              </>
            )}
          </button>
        )}
      </div>
    </SocialPageFrame>
  );
}

function ChannelMissing({ post = false }: { post?: boolean }) {
  const { channelId = '' } = useParams();
  const backTo = post ? socialPaths.channel(channelId) : socialPaths.channels;
  return (
    <SocialPageFrame title={post ? '消息不存在' : '频道不存在'} backTo={backTo}>
      <div className="social-channel-empty">
        <Radio size={34} />
        <h2>{post ? '消息不存在' : '频道不存在'}</h2>
        <p>
          {post
            ? '这条消息可能已删除，或不属于当前频道。'
            : '这个频道可能已删除，或未保存在当前设备。'}
        </p>
        <Link className="im-primary" to={backTo}>
          <ChevronLeft size={17} />
          {post ? '返回频道' : '返回频道列表'}
        </Link>
      </div>
    </SocialPageFrame>
  );
}

function ChannelComments() {
  const { channelId = '', postId = '' } = useParams();
  const { channels, addComment, setSubscription } = useSocialChannels();
  const { profile } = useProfile();
  const channel = channels.find((item) => item.id === channelId);
  const post = channel?.posts.find((item) => item.id === postId);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const count = post?.comments?.length || 0;
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [postId, count]);
  function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    try {
      addComment(channelId, postId, draft, profile.name);
      setDraft('');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '评论未能发送，内容已保留。');
    }
  }
  function subscribe() {
    try {
      setSubscription(channelId, true);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '订阅未能保存，请重试。');
    }
  }
  if (!channel) return <ChannelMissing />;
  if (!post) return <ChannelMissing post />;
  const comments = [...(post.comments || [])].sort((a, b) => a.createdAt - b.createdAt);
  const canComment = channel.subscribed || channel.ownerId === 'me';
  return (
    <section className="im-page tg-comments-page">
      <PageHeader title={`${comments.length} 条评论`} backTo={socialPaths.channel(channelId)} />
      <Link className="tg-thread-original" to={socialPaths.channel(channelId)}>
        <span className="social-channel-icon">{channel.icon}</span>
        <span>
          <strong>{channel.name}</strong>
          <p>{post.text || '图片消息'}</p>
        </span>
        <ChevronRight size={17} />
      </Link>
      <div className="tg-thread-messages" role="log" aria-label="频道评论线程">
        {comments.map((comment) => (
          <article
            className={`tg-thread-comment ${comment.authorId === 'me' ? 'is-self' : ''}`}
            key={comment.id}
          >
            <span className="tg-thread-avatar">{comment.authorName.slice(0, 1)}</span>
            <div>
              <strong>{comment.authorName}</strong>
              <p>{comment.text}</p>
              <time dateTime={new Date(comment.createdAt).toISOString()}>
                {new Date(comment.createdAt).toLocaleString('zh-CN', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </div>
          </article>
        ))}
        {!comments.length && (
          <div className="social-channel-empty">
            <MessageCircle size={30} />
            <h2>还没有评论</h2>
            <p>关于这条消息，你有什么想分享的？</p>
          </div>
        )}
        <div ref={end} />
      </div>
      {error && (
        <p className="tg-channel-error" role="alert">
          {error}
        </p>
      )}
      {channel.discussionEnabled === false ? (
        <p className="tg-thread-closed">这个频道已关闭评论。</p>
      ) : canComment ? (
        <form className="tg-thread-composer" onSubmit={send}>
          <label className="tg-visually-hidden" htmlFor="broadcast-comment">
            频道评论
          </label>
          <textarea
            id="broadcast-comment"
            placeholder="写下评论…"
            rows={1}
            maxLength={1000}
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
          <button className="tg-send" type="submit" aria-label="发送评论" disabled={!draft.trim()}>
            <Send size={21} />
          </button>
        </form>
      ) : (
        <button className="tg-thread-subscribe" onClick={subscribe}>
          <Plus size={18} />
          订阅频道后参与评论
        </button>
      )}
    </section>
  );
}

function ChannelCreate() {
  const { createChannel } = useSocialChannels();
  const { profile } = useProfile();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState(icons[0]);
  const [error, setError] = useState('');
  function create(event: FormEvent) {
    event.preventDefault();
    try {
      const id = createChannel({ name, description, icon }, profile.name);
      navigate(socialPaths.channel(id), { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '频道未能创建，内容已保留，请重试。');
    }
  }
  return (
    <SocialPageFrame title="创建频道" backTo={socialPaths.channels}>
      <form className="social-channel-create" onSubmit={create}>
        <div className="social-channel-create-preview">
          <span className="social-channel-icon">{icon}</span>
          <strong>{name.trim() || '你的新频道'}</strong>
          <span>创建后即可发布广播</span>
        </div>
        <fieldset>
          <legend>频道图标</legend>
          <div className="social-channel-icon-picker">
            {icons.map((item, index) => (
              <button
                type="button"
                className={icon === item ? 'selected' : ''}
                aria-label={`选择频道图标 ${index + 1}`}
                aria-pressed={icon === item}
                key={item}
                onClick={() => setIcon(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </fieldset>
        <label htmlFor="social-channel-name">
          频道名称 <span>{name.length}/30</span>
        </label>
        <input
          id="social-channel-name"
          placeholder="例如：每周设计笔记"
          value={name}
          maxLength={30}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <label htmlFor="social-channel-description">
          频道介绍 <span>{description.length}/200</span>
        </label>
        <textarea
          id="social-channel-description"
          placeholder="告诉大家，你会在这里分享什么"
          value={description}
          maxLength={200}
          rows={4}
          onChange={(event) => setDescription(event.target.value)}
          required
        />
        <p className="social-channel-create-note">
          <Radio size={15} />
          你将作为创建者发布广播，其他人可以订阅阅读。
        </p>
        {error && (
          <p className="social-channel-error" role="alert">
            {error}
          </p>
        )}
        <button className="im-primary" type="submit" disabled={!name.trim() || !description.trim()}>
          <Plus size={17} />
          创建频道
        </button>
      </form>
    </SocialPageFrame>
  );
}
