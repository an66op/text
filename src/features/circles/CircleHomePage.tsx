import { useState } from 'react';
import {
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  Crown,
  FolderOpen,
  ImagePlus,
  LockKeyhole,
  MessageCircle,
  PenLine,
  Pin,
  Plus,
  Settings2,
  Sparkles,
  Users,
} from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useProfile } from '@/features/profile/useProfile';
import { useCircles } from './useCircles';
import { circlePaths } from './routes';
import { CircleAvatar, CirclePostImage } from './ChannelPage';
import { CircleFeedCard } from './CircleFeedCard';

const views = [
  { id: 'all', label: '全部' },
  { id: 'featured', label: '精华' },
  { id: 'owner', label: '圈主' },
  { id: 'photos', label: '相册' },
] as const;

export default function CircleHomePage() {
  const { circleId = '' } = useParams();
  const { getCircle, getChannels, getMembers, getPosts } = useCircles();
  const { profile } = useProfile();
  const [params, setParams] = useSearchParams();
  const [sort, setSort] = useState('latest');
  const circle = getCircle(circleId);
  if (!circle) return null;
  const channels = getChannels(circleId).filter((channel) => channel.access !== 'staff');
  const chat = channels.find((channel) => channel.type === 'text');
  const forum = channels.find((channel) => channel.type === 'forum');
  const events = channels.find((channel) => channel.type === 'events');
  const resources = channels.find((channel) => channel.type === 'resources');
  const members = getMembers(circleId);
  const creator = members.find((member) => member.role === 'owner');
  const posts = getPosts(circleId).filter((post) =>
    channels.some((channel) => channel.id === post.channelId),
  );
  const pinned = posts.filter((post) => post.pinned);
  const view = views.some((item) => item.id === params.get('view')) ? params.get('view') : 'all';
  const visible = posts
    .filter((post) =>
      view === 'featured'
        ? post.featured
        : view === 'owner'
          ? creator && post.authorId === creator.id
          : view === 'photos'
            ? !!post.image
            : true,
    )
    .sort((a, b) =>
      sort === 'popular'
        ? b.likes - a.likes || b.createdAt - a.createdAt
        : b.createdAt - a.createdAt,
    );
  const managing = circle.role === 'owner' || circle.role === 'admin';
  const tools = [
    ...(chat
      ? [
          {
            name: '群聊',
            icon: MessageCircle,
            to: circlePaths.channel(circleId, chat.id),
            color: 'violet',
          },
        ]
      : []),
    ...(events
      ? [
          {
            name: '活动',
            icon: CalendarDays,
            to: circlePaths.channel(circleId, events.id),
            color: 'rose',
          },
        ]
      : []),
    ...(resources
      ? [
          {
            name: '资料',
            icon: FolderOpen,
            to: circlePaths.channel(circleId, resources.id),
            color: 'amber',
          },
        ]
      : []),
    { name: '成员', icon: Users, to: circlePaths.members(circleId), color: 'mint' },
  ];
  return (
    <div className="circle-home creator-home">
      <div className="creator-hero" style={{ backgroundImage: `url(${circle.cover})` }}>
        <span className="creator-access-tag">
          {circle.visibility === 'invite' ? <LockKeyhole size={12} /> : <Sparkles size={12} />}{' '}
          {circle.visibility === 'invite' ? '邀请制圈子' : '兴趣创作圈'}
        </span>
        <div className="creator-hero-title">
          <span className="creator-circle-icon">{circle.icon}</span>
          <div>
            <span>{circle.category} · 共同热爱</span>
            <h1>{circle.name}</h1>
          </div>
        </div>
        {managing && (
          <Link
            className="creator-hero-settings"
            to={circlePaths.settings(circleId)}
            aria-label="圈子设置"
          >
            <Settings2 size={19} />
          </Link>
        )}
      </div>
      <div className="creator-home-body">
        <section className="creator-intro">
          <div className="creator-host-row">
            <CircleAvatar name={creator?.name ?? '圈主'} src={creator?.avatar} size={38} />
            <div className="creator-host-name">
              <strong>{creator?.name ?? '圈主的兴趣空间'}</strong>
              <span>
                <Crown size={11} /> 圈主{creator ? ` · ${circle.category}分享` : ''}
              </span>
            </div>
            <Link className="creator-member-count" to={circlePaths.members(circleId)}>
              <strong>{circle.memberCount}</strong>
              <span>
                位圈友 <ChevronRight size={11} />
              </span>
            </Link>
          </div>
          <p className="creator-circle-description">{circle.description}</p>
          <div className={`creator-membership ${circle.joined ? 'is-member' : ''}`}>
            <span className="creator-membership-icon">
              {circle.joined ? <Crown size={19} /> : <LockKeyhole size={18} />}
            </span>
            <div>
              <strong>
                {circle.joined ? '已加入 · 你的专属圈子' : '加入圈子，和同好一起分享'}
              </strong>
              <span>
                {circle.joined
                  ? '圈内内容 · 作品交流 · 成员互动'
                  : circle.visibility === 'invite'
                    ? '凭圈主邀请加入，开启圈内交流'
                    : '免费加入，参与圈内讨论与活动'}
              </span>
            </div>
            <Link to={circle.joined ? circlePaths.invite(circleId) : circlePaths.join(circleId)}>
              {circle.joined ? '邀请' : '加入'}
              <ArrowUpRight size={14} />
            </Link>
          </div>
        </section>
        <nav className="creator-quick-tools" aria-label="圈子服务">
          {tools.map((tool) => (
            <Link key={tool.name} to={tool.to}>
              <span className={`creator-tool-${tool.color}`}>
                <tool.icon size={21} />
              </span>
              <strong>{tool.name}</strong>
            </Link>
          ))}
        </nav>
        {pinned.length > 0 && (
          <div className="creator-pinned-list">
            {pinned.slice(0, 2).map((post) => (
              <Link key={post.id} to={circlePaths.post(circleId, post.id)}>
                <span>
                  <Pin size={12} />
                  置顶
                </span>
                <strong>{post.title}</strong>
                <ChevronRight size={15} />
              </Link>
            ))}
          </div>
        )}
        {circle.joined && forum && (
          <Link className="creator-compose-prompt" to={circlePaths.compose(circleId, forum.id)}>
            <CircleAvatar name={profile.name} src={profile.avatar} size={32} />
            <span>分享作品，或聊聊今天的灵感…</span>
            <ImagePlus size={21} />
          </Link>
        )}
        <section className="creator-feed" aria-label="圈内动态">
          <div className="creator-feed-controls">
            <div role="tablist" aria-label="动态筛选">
              {views.map((item, index) => (
                <button
                  key={item.id}
                  id={`creator-filter-${item.id}`}
                  role="tab"
                  aria-selected={view === item.id}
                  aria-controls="creator-feed-panel"
                  tabIndex={view === item.id ? 0 : -1}
                  onKeyDown={(event) => {
                    const next =
                      event.key === 'ArrowRight'
                        ? (index + 1) % views.length
                        : event.key === 'ArrowLeft'
                          ? (index + views.length - 1) % views.length
                          : event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? views.length - 1
                              : -1;
                    if (next < 0) return;
                    event.preventDefault();
                    const selected = views[next].id;
                    setParams(selected === 'all' ? {} : { view: selected }, { replace: true });
                    event.currentTarget.parentElement?.querySelectorAll('button')[next]?.focus();
                  }}
                  onClick={() =>
                    setParams(item.id === 'all' ? {} : { view: item.id }, { replace: true })
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
            <select
              aria-label="动态排序"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="latest">最新</option>
              <option value="popular">最热</option>
            </select>
          </div>
          <div id="creator-feed-panel" role="tabpanel" aria-labelledby={`creator-filter-${view}`}>
            {!circle.joined ? (
              <div className="creator-locked-feed">
                <LockKeyhole size={30} />
                <h2>好内容，留给圈内的你</h2>
                <p>加入后可查看完整动态、精华作品，参与圈友交流。</p>
                <Link className="primary" to={circlePaths.join(circleId)}>
                  <Plus size={16} /> 加入圈子
                </Link>
              </div>
            ) : view === 'photos' ? (
              <div className="creator-album">
                {visible.map((post) => (
                  <Link
                    key={post.id}
                    to={circlePaths.post(circleId, post.id)}
                    aria-label={post.title}
                  >
                    {post.image && <CirclePostImage src={post.image} title={post.title} />}
                    <span>{post.title}</span>
                  </Link>
                ))}
              </div>
            ) : (
              visible.map((post) => (
                <CircleFeedCard
                  key={post.id}
                  post={post}
                  ownerId={creator?.id}
                  channelName={channels.find((channel) => channel.id === post.channelId)?.name}
                />
              ))
            )}
            {circle.joined && visible.length === 0 && (
              <div className="creator-feed-empty">
                <Sparkles size={28} />
                <h2>
                  {view === 'featured'
                    ? '好内容值得被留下'
                    : view === 'owner'
                      ? '等圈主分享新的灵感'
                      : view === 'photos'
                        ? '把喜欢的画面留在这里'
                        : '从第一篇分享开始'}
                </h2>
                <p>
                  {view === 'featured'
                    ? '圈主和管理员可以将优质动态设为精华。'
                    : '每一次分享，都让这个圈子更有温度。'}
                </p>
                {forum && (
                  <Link to={circlePaths.compose(circleId, forum.id)}>
                    <PenLine size={15} />
                    发布动态
                  </Link>
                )}
                {!forum && managing && (
                  <Link to={circlePaths.createChannel(circleId)}>创建讨论频道</Link>
                )}
              </div>
            )}
          </div>
        </section>
        {circle.joined && forum && (
          <Link
            className="creator-publish-fab"
            to={circlePaths.compose(circleId, forum.id)}
            aria-label="发布动态"
          >
            <PenLine size={20} />
            <span>发布</span>
          </Link>
        )}
      </div>
    </div>
  );
}
