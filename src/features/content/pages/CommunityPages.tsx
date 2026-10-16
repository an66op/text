import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CalendarDays, MapPin, Search, Users } from 'lucide-react';
import PageHeader from '@/shared/ui/PageHeader';
import { paths } from '@/shared/config/paths';
import { useProfile } from '@/features/profile/useProfile';
import { useToast } from '@/shared/ui/useToast';
import { useContent } from '../useContent';
import { contentRoutes, eventsFor, getCommunity } from '../domain';
import { pictures, postAvatar } from '../fixtures';
import type { CatalogItem } from '../types';

export function CommunityFormPage({ editing = false }: { editing?: boolean }) {
  const { contentId } = useParams();
  const { communities, createCommunity, updateCommunity, deleteCommunity } = useContent();
  const item = editing ? getCommunity(contentId, communities) : undefined;
  const [title, setTitle] = useState(item?.title ?? '');
  const [desc, setDesc] = useState(item?.desc ?? '');
  const [category, setCategory] = useState(item?.category ?? '生活');
  const [image, setImage] = useState(item?.img ?? pictures.forest);
  const [confirmation, setConfirmation] = useState('');
  const navigate = useNavigate();
  const notify = useToast();
  const { profile } = useProfile();
  if (editing && !item?.owner)
    return (
      <>
        <PageHeader title="组织管理" backTo={paths.organizations} />
        <div className="empty">
          只有组织创建者可以修改资料。<Link to={paths.organizations}>返回组织</Link>
        </div>
      </>
    );
  function submit() {
    if (!title.trim() || !desc.trim()) return;
    const changes = {
      title: title.trim(),
      desc: desc.trim(),
      category,
      img: image,
      badge: `${category}组织`,
      author: profile.name,
    };
    if (editing && item) {
      updateCommunity(item.id, changes);
      notify('组织资料已保存');
      navigate(paths.community(item.id), { replace: true });
    } else {
      const id = createCommunity(changes);
      notify('组织创建成功');
      navigate(paths.community(id), { replace: true });
    }
  }
  return (
    <>
      <PageHeader
        title={editing ? '管理组织' : '创建组织'}
        backTo={item ? paths.community(item.id) : paths.organizations}
      />
      <div className="content-page">
        <p className="content-note">把热爱聚在一起，给同频的人一个相遇的地方。</p>
        <form
          className="content-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label>
            组织名称
            <input
              aria-label="组织名称"
              maxLength={32}
              required
              placeholder="给组织起一个名字"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            组织介绍
            <textarea
              aria-label="组织介绍"
              maxLength={300}
              required
              placeholder="介绍组织的城市、方向和活动方式"
              value={desc}
              onChange={(event) => setDesc(event.target.value)}
            />
          </label>
          <label>
            组织类型
            <select
              aria-label="组织类型"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {['生活', '户外', '阅读', '摄影', '设计', '游戏'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>组织封面</label>
          <div className="cover-options">
            {Object.values(pictures)
              .slice(0, 6)
              .map((url, index) => (
                <button
                  type="button"
                  aria-label={`组织封面 ${index + 1}`}
                  className={image === url ? 'selected' : ''}
                  key={url}
                  onClick={() => setImage(url)}
                >
                  <img src={url} alt="组织封面" />
                </button>
              ))}
          </div>
          <button className="primary full" disabled={!title.trim() || !desc.trim()}>
            {editing ? '保存修改' : '创建组织'}
          </button>
        </form>
        {item?.owner && (
          <div className="danger-zone">
            <h3>解散组织</h3>
            <p>此操作会移除本机保存的组织资料。输入组织名称确认。</p>
            <input
              className="field"
              aria-label="确认解散组织名称"
              placeholder={item.title}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
            <button
              className="danger-button"
              disabled={confirmation !== item.title}
              onClick={() => {
                deleteCommunity(item.id);
                notify('组织已解散');
                navigate(paths.organizations, { replace: true });
              }}
            >
              解散组织
            </button>
          </div>
        )}
      </div>
    </>
  );
}
export function CommunityMembersPage() {
  const { contentId } = useParams();
  const { communities, memberships } = useContent();
  const { profile } = useProfile();
  const [query, setQuery] = useState('');
  const item = getCommunity(contentId, communities);
  if (!item) return <MissingCommunity />;
  const members = membersFor(item, profile.name, memberships.includes(item.id));
  const visible = members.filter((member) => member.name.includes(query.trim()));
  return (
    <>
      <PageHeader title="组织成员" backTo={paths.community(item.id)} />
      <div className="content-page">
        <label className="content-search">
          <Search size={18} />
          <input
            aria-label="搜索组织成员"
            placeholder="搜索成员"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <p className="content-note">
          {members.length} 位示例成员 · {item.title}
        </p>
        <div className="member-list">
          {visible.map((member, index) => (
            <Link key={member.name} to={contentRoutes.author(member.name)}>
              <img src={postAvatar(member.name === profile.name ? 4 : index)} alt={member.name} />
              <span>
                <strong>{member.name}</strong>
                <small>{member.role}</small>
              </span>
            </Link>
          ))}
        </div>
        {visible.length === 0 && <div className="empty">没有找到这个名字的成员。</div>}
      </div>
    </>
  );
}
export function CommunityEventPage() {
  const { contentId, eventId } = useParams();
  const { communities, attendance, memberships, toggleAttendance } = useContent();
  const item = getCommunity(contentId, communities);
  const notify = useToast();
  if (!item) return <MissingCommunity />;
  const event = eventsFor(item).find((value) => value.id === eventId);
  if (!event)
    return (
      <>
        <PageHeader title="活动不存在" backTo={paths.community(item.id)} />
        <div className="empty">这场活动暂时无法查看。</div>
      </>
    );
  const key = `${item.id}:${event.id}`;
  const participating = attendance.includes(key);
  const member = memberships.includes(item.id) || item.owner;
  return (
    <>
      <PageHeader title="活动详情" backTo={paths.community(item.id)} />
      <img className="community-event-cover" src={item.img} alt={event.title} />
      <div className="content-page">
        <span className="content-pill">{participating ? '已报名' : '报名中'}</span>
        <h2>{event.title}</h2>
        <p>
          <CalendarDays size={17} /> {event.date}
        </p>
        <p>
          <MapPin size={17} /> {event.place}
        </p>
        <p>
          <Users size={17} /> {8 + Number(participating)} / {event.seats} 位伙伴
        </p>
        <h3>活动介绍</h3>
        <p className="book-introduction">{event.desc}</p>
        <h3>活动安排</h3>
        <ol className="event-agenda">
          <li>提前 10 分钟到达集合地点，互相认识。</li>
          <li>一起参与活动，记录和分享此刻。</li>
          <li>结束前合影，约好下一次相遇。</li>
        </ol>
        <p className="content-note">
          {member ? '报名信息保存在本机，可随时取消。' : '先加入组织，再报名参加活动。'}
        </p>
        {member ? (
          <button
            className={participating ? 'secondary full' : 'primary full'}
            onClick={() => {
              toggleAttendance(key);
              notify(participating ? '已取消报名' : '报名成功，期待与你相遇');
            }}
          >
            {participating ? '取消报名' : '报名参加'}
          </button>
        ) : (
          <Link className="primary full" to={paths.community(item.id)}>
            前往加入组织
          </Link>
        )}
      </div>
    </>
  );
}
function membersFor(item: CatalogItem, self: string, memberships: boolean) {
  if (item.owner) return [{ name: self, role: '组织创建者' }];
  return [
    ...[
      { name: '山野来信', role: '组织创建者' },
      { name: '林间晚风', role: '活动组织者' },
      { name: 'Mia', role: '热心伙伴' },
      { name: '阿川', role: '摄影伙伴' },
      { name: '北岛', role: '组织成员' },
    ],
    ...(memberships ? [{ name: self, role: '组织成员' }] : []),
  ];
}
function MissingCommunity() {
  return (
    <>
      <PageHeader title="组织不存在" backTo={paths.organizations} />
      <div className="empty">
        这个组织已解散或不存在。<Link to={paths.organizations}>发现其他组织</Link>
      </div>
    </>
  );
}
