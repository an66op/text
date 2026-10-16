import { CalendarDays, ChevronRight, Users } from 'lucide-react';
import { Link } from 'react-router';
import { paths } from '@/shared/config/paths';
import { useToast } from '@/shared/ui/useToast';
import { useContent } from '../useContent';
import { contentRoutes, eventsFor } from '../domain';
import type { CatalogItem } from '../types';

export default function CommunityDetail({ item }: { item: CatalogItem }) {
  const { memberships, attendance, toggleMembership } = useContent();
  const notify = useToast();
  const member = memberships.includes(item.id) || item.owner;
  return (
    <div className="community-detail">
      <img className="community-event-cover" src={item.img} alt={item.title} />
      <div className="content-page">
        <span className="content-pill">{item.badge}</span>
        <h2>{item.title}</h2>
        <p>{item.desc}</p>
        <p className="book-introduction">
          欢迎每一个热爱生活的你。在这里分享灵感，参与活动，认识同频的新朋友。一起从小小的热爱出发，让每次相遇都成为下一次见面的理由。
        </p>
        <Link className="content-link-row" to={contentRoutes.members(item.id)}>
          <Users size={20} />
          <strong>组织成员</strong>
          <span>{item.owner ? '我创建的组织' : member ? '已加入' : '看看都有谁'}</span>
          <ChevronRight size={18} />
        </Link>
        {item.owner ? (
          <Link className="secondary full" to={contentRoutes.manageCommunity(item.id)}>
            管理组织
          </Link>
        ) : (
          <button
            className={member ? 'secondary full' : 'primary full'}
            onClick={() => {
              toggleMembership(item.id);
              notify(member ? '已退出组织' : `已加入 ${item.title}`);
            }}
          >
            {member ? '已加入 · 退出组织' : '加入这个组织'}
          </button>
        )}
        <h3>最近的活动</h3>
        <div className="community-events">
          {eventsFor(item).map((event) => (
            <Link key={event.id} to={contentRoutes.event(item.id, event.id)}>
              <CalendarDays size={24} />
              <div>
                <strong>{event.title}</strong>
                <small>{event.date}</small>
                <p>{event.place}</p>
              </div>
              <span>
                {attendance.includes(`${item.id}:${event.id}`) ? '已报名' : '查看'}
                <ChevronRight size={15} />
              </span>
            </Link>
          ))}
        </div>
        <h3>组织交流</h3>
        <Link
          className="content-link-row"
          to={`${paths.world}?topic=${encodeURIComponent(item.title)}`}
        >
          分享你最近的一个小确幸
          <ChevronRight size={18} />
        </Link>
        <Link className="content-link-row" to={`${contentRoutes.compose}?target=world`}>
          发布一个组织话题
          <ChevronRight size={18} />
        </Link>
      </div>
    </div>
  );
}
