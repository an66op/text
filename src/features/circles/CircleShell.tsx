import { useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  House,
  LockKeyhole,
  PanelLeft,
  Plus,
  Settings2,
  Users,
  X,
} from 'lucide-react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { circlePaths } from './routes';
import { useCircles } from './useCircles';
import { ChannelIcon } from './CircleIcons';

export default function CircleShell() {
  const { circleId = '', channelId } = useParams();
  const { circles, getCircle, getChannels, canViewChannel } = useCircles();
  const circle = getCircle(circleId);
  const [expandedAt, setExpandedAt] = useState<string | null>(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const open = expandedAt === pathname;
  if (!circle)
    return (
      <div className="circle-empty">
        <h1>圈子不存在</h1>
        <p>这个圈子已解散，或链接已经失效。</p>
        <Link className="primary" to={circlePaths.list}>
          返回圈子
        </Link>
      </div>
    );
  const channels = getChannels(circleId);
  const groups = [...new Set(channels.map((channel) => channel.category))];
  const managing = circle.role === 'owner' || circle.role === 'admin';
  const channelList = (
    <>
      <Link
        className={`circle-channel-link ${!channelId ? 'active' : ''}`}
        to={circlePaths.home(circleId)}
      >
        <House size={19} />
        <span>圈内动态</span>
      </Link>
      {groups.map((group) => (
        <div className="circle-channel-group" key={group}>
          <h3>
            <ChevronDown size={12} />
            {group}
          </h3>
          {channels
            .filter((channel) => channel.category === group)
            .map((channel) => {
              const locked = !canViewChannel(circleId, channel.id);
              return (
                <Link
                  key={channel.id}
                  className={`circle-channel-link ${channelId === channel.id ? 'active' : ''} ${locked ? 'locked' : ''}`}
                  to={circlePaths.channel(circleId, channel.id)}
                >
                  <ChannelIcon type={channel.type} size={18} />
                  <span>{channel.name}</span>
                  {channel.access === 'staff' ? (
                    <LockKeyhole size={12} />
                  ) : channel.unread > 0 && circle.joined ? (
                    <b>{channel.unread}</b>
                  ) : null}
                  {channel.type === 'voice' && circle.joined && <i className="circle-voice-dot" />}
                </Link>
              );
            })}
        </div>
      ))}
      {managing && (
        <Link className="circle-create-channel" to={circlePaths.createChannel(circleId)}>
          <Plus size={17} />
          创建频道
        </Link>
      )}
    </>
  );
  return (
    <section className="circle-workspace creator-workspace">
      <aside className="circle-channel-panel" aria-label="圈子频道">
        <Link className="creator-back-circles" to={circlePaths.list}>
          <ChevronLeft size={16} />
          我的圈子
        </Link>
        <Link
          className="circle-panel-cover"
          style={{ backgroundImage: `url(${circle.cover})` }}
          to={circlePaths.home(circleId)}
        >
          <span>{circle.icon}</span>
        </Link>
        <header className="circle-panel-title">
          <h2>{circle.name}</h2>
          {managing && (
            <Link to={circlePaths.settings(circleId)} aria-label="管理圈子">
              <Settings2 size={18} />
            </Link>
          )}
        </header>
        <div className="circle-panel-meta">
          <i />
          {circle.onlineCount} 在线<span>·</span>
          {circle.memberCount} 位成员
        </div>
        <nav className="circle-channel-nav">{channelList}</nav>
        <label className="creator-space-picker">
          <span>切换圈子</span>
          <select
            aria-label="切换圈子"
            value={circleId}
            onChange={(event) => navigate(circlePaths.home(event.target.value))}
          >
            {circles
              .filter((item) => item.joined || item.id === circleId)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.icon} {item.name}
                </option>
              ))}
          </select>
        </label>
        <Link className="circle-panel-members" to={circlePaths.members(circleId)}>
          <Users size={18} />
          <span>成员与角色</span>
          <ChevronDown size={15} />
        </Link>
      </aside>
      <div className="circle-workspace-main" key={pathname}>
        <header className="circle-mobile-bar">
          <Link className="circle-round-button" to={circlePaths.list} aria-label="返回圈子列表">
            <ChevronLeft size={23} />
          </Link>
          <Link className="circle-mobile-name" to={circlePaths.home(circleId)}>
            <span>{circle.icon}</span>
            <strong>{circle.name}</strong>
          </Link>
          <button
            className="circle-round-button"
            aria-label="频道列表"
            aria-expanded={open}
            onClick={() => setExpandedAt(open ? null : pathname)}
          >
            {open ? <X size={21} /> : <PanelLeft size={21} />}
          </button>
        </header>
        {open && (
          <nav className="circle-mobile-channel-picker" aria-label="选择频道">
            {channelList}
            <Link className="circle-channel-link" to={circlePaths.members(circleId)}>
              <Users size={18} />
              成员与角色
            </Link>
          </nav>
        )}
        <Outlet key={channelId || circleId} />
      </div>
    </section>
  );
}
