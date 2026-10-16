import { BellOff, Plus, Radio, Search } from 'lucide-react';
import { Link } from 'react-router';
import { socialPaths } from './routes';
import { useSocialChannels } from './useSocialChannels';

export default function SocialChannelList({
  query,
  selectedId = '',
}: {
  query: string;
  selectedId?: string;
}) {
  const { channels } = useSocialChannels();
  const filtered = channels
    .filter((channel) =>
      `${channel.name} ${channel.description}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.subscribed) - Number(a.subscribed) ||
        Math.max(b.createdAt, ...b.posts.map((post) => post.createdAt)) -
          Math.max(a.createdAt, ...a.posts.map((post) => post.createdAt)),
    );
  return (
    <div className="social-channel-list">
      <div className="im-list-caption">
        <span>频道 · {channels.filter((channel) => channel.subscribed).length} 个已订阅</span>
        <Link to={socialPaths.channelCreate} aria-label="创建频道">
          <Plus size={15} />
        </Link>
      </div>
      {filtered.map((channel) => {
        const latest = [...channel.posts].sort((a, b) => b.createdAt - a.createdAt)[0];
        const unread =
          channel.subscribed && channel.id !== selectedId
            ? channel.posts.filter((post) => !post.viewed).length
            : 0;
        return (
          <Link
            className={`tg-channel-row ${selectedId === channel.id ? 'is-selected' : ''}`}
            aria-current={selectedId === channel.id ? 'page' : undefined}
            to={socialPaths.channel(channel.id)}
            key={channel.id}
          >
            <span className="social-channel-icon">{channel.icon}</span>
            <span className="tg-channel-row-body">
              <span className="tg-channel-row-title">
                <strong>{channel.name}</strong>
                <Radio size={12} />
              </span>
              <span className="tg-channel-row-preview">
                {latest?.image && <span>📷 </span>}
                {latest?.text || (latest?.image ? '图片消息' : channel.description)}
              </span>
              <span className="tg-channel-row-caption">
                {channel.subscriberCount.toLocaleString('zh-CN')} 位订阅者
                {!channel.subscribed && ' · 公开频道'}
              </span>
            </span>
            <span className="tg-channel-row-meta">
              <time>
                {new Date(latest?.createdAt || channel.createdAt).toLocaleDateString('zh-CN', {
                  month: 'numeric',
                  day: 'numeric',
                })}
              </time>
              {unread > 0 ? (
                <b className={channel.muted ? 'is-muted' : ''}>{unread}</b>
              ) : channel.muted ? (
                <BellOff size={13} />
              ) : !channel.subscribed ? (
                <small>订阅</small>
              ) : null}
            </span>
          </Link>
        );
      })}
      {!filtered.length && (
        <div className="social-channel-empty">
          <Search size={29} />
          <h2>没有找到相关频道</h2>
          <p>试试其他关键词，或创建自己的频道。</p>
          <Link to={socialPaths.channelCreate}>
            <Plus size={15} />
            创建频道
          </Link>
        </div>
      )}
    </div>
  );
}

export function SocialChannelWelcome() {
  return (
    <div className="social-channel-welcome">
      <span>
        <Radio size={38} />
      </span>
      <h2>选择一个频道</h2>
      <p>订阅更新，在这里接收消息。</p>
      <Link className="im-primary" to={socialPaths.channelCreate}>
        <Plus size={17} />
        创建频道
      </Link>
    </div>
  );
}
