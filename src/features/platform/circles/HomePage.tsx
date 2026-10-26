import {
  CalendarDays,
  Crown,
  Hash,
  LockKeyhole,
  Megaphone,
  PenLine,
  Settings2,
  Users,
} from 'lucide-react';
import { Link } from 'react-router';
import { imageUrl } from '../platform-format';
import { PlatformAvatar, PlatformError } from '../PlatformUi';
import CirclePage from './CirclePage';
import { circlesApi } from './api';
import { useCircle } from './circle-context';
import { circlePaths } from './paths';
import { isManager } from './types';
import { useResource } from './useResource';
import Feed from './Feed';
import { Empty } from './Ui';
export default function HomePage() {
  return (
    <CirclePage title="圈子" publicView>
      <Home />
    </CirclePage>
  );
}
function Home() {
  const { circle, deny } = useCircle();
  const readable = circle.membership === 'active' && circle.status !== 'suspended';
  const channels = useResource(
    circle.id,
    (signal) => circlesApi.channels(circle.id, signal),
    deny,
    readable,
  );
  const cover = /^https?:\/\//i.test(circle.cover) ? imageUrl(circle.cover) : '';
  return (
    <>
      <div className="sc-hero" style={cover ? { backgroundImage: `url(${cover})` } : undefined}>
        <span className="sc-hero-access">
          {circle.visibility === 'private' ? '私密圈子' : '兴趣创作圈'}
        </span>
        <div>
          <i>{circle.icon || '✦'}</i>
          <span>
            <small>{circle.category || '共同热爱'}</small>
            <h1>{circle.name}</h1>
          </span>
        </div>
        {isManager(circle) && (
          <Link to={circlePaths.manage(circle.id)} aria-label="管理服务圈子">
            <Settings2 size={20} />
          </Link>
        )}
      </div>
      <section className="sc-creator-intro">
        <div className="sc-host">
          <PlatformAvatar user={circle.owner} />
          <div>
            <strong>{circle.owner.name}</strong>
            <small>
              <Crown size={11} />
              圈主
            </small>
          </div>
          <span>{circle.memberCount} 位圈友</span>
        </div>
        <p>{circle.description}</p>
        <div className="sc-membership">
          <LockKeyhole size={18} />
          <span>
            {circle.status === 'suspended'
              ? '圈子已暂停'
              : circle.membership === 'active'
                ? '已加入，内容仅圈内分享'
                : circle.membership === 'pending'
                  ? '入圈申请正在审核'
                  : circle.membership === 'banned'
                    ? '当前账号已被封禁'
                    : '加入圈子，和同好一起分享'}
          </span>
          {circle.membership === 'active' && isManager(circle) && circle.status === 'active' ? (
            <Link to={circlePaths.invite(circle.id)}>邀请 ↗</Link>
          ) : circle.membership !== 'active' &&
            circle.membership !== 'banned' &&
            circle.status === 'active' ? (
            <Link to={circlePaths.join(circle.id)}>加入 ↗</Link>
          ) : null}
        </div>
      </section>
      {readable ? (
        <>
          <nav className="sc-home-tools">
            <Link to={circlePaths.members(circle.id)}>
              <Users size={20} />
              成员
            </Link>
            <Link to={circlePaths.events(circle.id)}>
              <CalendarDays size={20} />
              活动
            </Link>
            {channels.data?.items.map((channel) => (
              <Link key={channel.id} to={circlePaths.channel(circle.id, channel.id)}>
                {channel.kind === 'announcement' ? <Megaphone size={20} /> : <Hash size={20} />}
                {channel.name}
                {channel.archived && '（归档）'}
              </Link>
            ))}
          </nav>
          <PlatformError message={channels.error} retry={channels.refresh} />
          {circle.status === 'active' &&
            channels.data?.items.some(
              (item) => !item.archived && (item.kind === 'forum' || isManager(circle)),
            ) && (
              <Link className="sc-compose-prompt" to={circlePaths.compose(circle.id)}>
                <PenLine size={18} />
                <span>分享作品，记录今天的灵感…</span>
              </Link>
            )}
          <Feed channels={channels.data?.items} />
        </>
      ) : (
        <Empty>
          <LockKeyhole size={30} />
          <h2>{circle.status === 'suspended' ? '内容暂时不可访问' : '好内容，留给圈内的你'}</h2>
          <p>成员身份确认后才会读取频道和正文。</p>
        </Empty>
      )}
    </>
  );
}
