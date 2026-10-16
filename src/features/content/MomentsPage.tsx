import { Camera, ChevronRight, Image } from 'lucide-react';
import { Link } from 'react-router';
import { useProfile } from '@/features/profile/useProfile';
import { avatar } from '@/shared/lib/media';
import PageHeader from '@/shared/ui/PageHeader';
import { useContent } from './useContent';
import { contentRoutes } from './domain';
import PostFeed from './PostFeed';
import './moments.css';

export default function MomentsPage() {
  const { profile } = useProfile();
  const { cover } = useContent();
  return (
    <div className="moments-page">
      <PageHeader
        title="动态"
        action={
          <Link aria-label="发布动态" to={contentRoutes.compose}>
            <Camera size={22} />
          </Link>
        }
      />
      <div className="im-moments">
        <div
          className="im-moments-cover"
          style={{ backgroundImage: `linear-gradient(180deg, #0000 55%, #0004), url(${cover})` }}
        >
          <Link className="moments-cover-edit" to={contentRoutes.cover} aria-label="更换动态封面">
            <Image size={15} />
            <span>更换封面</span>
          </Link>
        </div>
        <Link className="activity-profile" to={contentRoutes.author('me')}>
          <img
            className="activity-profile-avatar"
            src={profile.avatar || avatar(49)}
            alt={profile.name}
          />
          <div>
            <strong>{profile.name}</strong>
            <p>{profile.bio || '记录此刻，分享日常'}</p>
          </div>
          <ChevronRight size={18} />
        </Link>
        <div className="activity-feed-heading">
          <h2>朋友动态</h2>
          <span>与你有关的每一天</span>
        </div>
        <div className="im-moments-content">
          <PostFeed variant="moments" />
        </div>
      </div>
      <Link className="activity-own-link" to={contentRoutes.author('me')}>
        查看我的动态
      </Link>
    </div>
  );
}
