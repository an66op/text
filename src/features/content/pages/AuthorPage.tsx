import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useProfile } from '@/features/profile/useProfile';
import { paths } from '@/shared/config/paths';
import PageHeader from '@/shared/ui/PageHeader';
import { useContent } from '../useContent';
import { postAvatar } from '../fixtures';
import { contentRoutes, ownPost } from '../domain';
import PostCard from '../components/PostCard';

export default function AuthorPage() {
  const { author } = useParams();
  const { profile } = useProfile();
  const { posts, follows, toggleFollow } = useContent();
  const [tab, setTab] = useState('全部');
  const name = author === 'me' ? profile.name : author || '';
  const self = author === 'me';
  const visible = posts.filter(
    (post) =>
      (self ? ownPost(post) : post.name === name && !post.owner) &&
      (tab === '全部' ||
        (tab === '世界'
          ? post.target === 'world' || post.kind === '世界'
          : post.target !== 'world' && post.kind !== '世界')),
  );
  const exists =
    self ||
    posts.some((post) => post.name === name) ||
    ['Lin', 'Mia', '北岛', '山野来信', '阿川', '林间晚风'].includes(name);
  return (
    <>
      <PageHeader title={self ? '我的动态' : '个人主页'} backTo={paths.moments} />
      {!exists ? (
        <div className="empty">
          这位用户暂时没有公开主页。<Link to={paths.world}>发现更多伙伴</Link>
        </div>
      ) : (
        <>
          <div className="author-profile">
            <img
              className="author-avatar"
              src={
                self && profile.avatar
                  ? profile.avatar
                  : postAvatar(
                      self
                        ? 4
                        : Math.max(
                            0,
                            posts.findIndex((post) => post.name === name),
                          ),
                    )
              }
              alt={`${name}的头像`}
            />
            <h2>{self ? profile.name : name}</h2>
            <p>{self ? profile.bio : '记录生活，分享热爱。愿每一次相遇都有温度。'}</p>
            <span>{visible.length} 条公开动态</span>
            {self ? (
              <Link className="primary" to={contentRoutes.compose}>
                发布新动态
              </Link>
            ) : (
              <button
                className={follows.includes(name) ? 'secondary' : 'primary'}
                onClick={() => toggleFollow(name)}
              >
                {follows.includes(name) ? '已关注 · 取消关注' : '+ 关注'}
              </button>
            )}
          </div>
          <div className="feed-tabs">
            {['全部', '动态', '世界'].map((label) => (
              <button
                key={label}
                className={tab === label ? 'active' : ''}
                onClick={() => setTab(label)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="world-feed">
            {visible.map((post) => (
              <PostCard key={post.id} post={post} variant="world" />
            ))}
            {visible.length === 0 && <div className="empty">还没有公开动态。</div>}
          </div>
        </>
      )}
    </>
  );
}
