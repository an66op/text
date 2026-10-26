import { Link } from 'react-router';
import { Hash, ChevronRight } from 'lucide-react';
import PageHeader from '@/shared/ui/PageHeader';
import { paths } from '@/shared/config/paths';
import { topicSeeds } from '../domain';
export default function TopicsPage() {
  return (
    <>
      <PageHeader title="本机话题" backTo={paths.localWorld} />
      <div className="content-page">
        <h2>找到你想聊的世界</h2>
        <p className="content-note">生活里的每一份热爱，都有同频的人。</p>
        <div className="topic-list">
          {topicSeeds.map((topic) => (
            <Link
              key={topic.name}
              to={`${paths.localWorld}?topic=${encodeURIComponent(topic.name)}`}
            >
              <Hash />
              <div>
                <strong>{topic.name}</strong>
                <p>{topic.desc}</p>
                <small>{topic.count} 人正在讨论</small>
              </div>
              <ChevronRight size={18} />
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
