import { Link, useParams } from 'react-router';
import { pathForModule, paths } from '@/shared/config/paths';
import PageHeader from '@/shared/ui/PageHeader';
import { useContent } from './useContent';
import { findContent } from './content-model';
import { contentRoutes, getCommunity } from './domain';
import PostDetail from './details/PostDetail';
import WatchDetail from './details/WatchDetail';
import ReaderDetail from './details/ReaderDetail';
import GameDetail from './details/GameDetail';
import CommunityDetail from './details/CommunityDetail';
import type { DetailKind } from './types';
import './content.css';

export default function ContentDetailPage({ kind }: { kind: DetailKind }) {
  const { postId, contentId } = useParams();
  const { posts, communities } = useContent();
  const post =
    kind === 'post' && /^\d+$/.test(postId ?? '')
      ? posts.find((item) => item.id === Number(postId))
      : undefined;
  const item =
    kind === 'community'
      ? getCommunity(contentId, communities)
      : kind !== 'post'
        ? findContent(contentId, kind)
        : undefined;
  const fallback =
    kind === 'post'
      ? paths.world
      : kind === 'watch'
        ? paths.videos
        : kind === 'read'
          ? paths.library
          : kind === 'game'
            ? paths.games
            : paths.organizations;
  const backTo = post
    ? post.target === 'world' || post.kind === '世界'
      ? paths.world
      : paths.moments
    : item
      ? kind === 'read'
        ? contentRoutes.book(item.id)
        : pathForModule(item.module)
      : fallback;
  if (!post && !item)
    return (
      <>
        <PageHeader title="内容不存在" backTo={backTo} />
        <div className="empty">
          这条内容暂时无法查看。<Link to={backTo}>返回版块</Link>
        </div>
      </>
    );
  return (
    <>
      <PageHeader title={post ? '动态详情' : (item?.title ?? '内容详情')} backTo={backTo} />
      <div className="content-body">
        {post && <PostDetail post={post} key={post.id} />}
        {item && kind === 'watch' && <WatchDetail item={item} key={item.id} />}
        {item && kind === 'read' && <ReaderDetail item={item} key={item.id} />}
        {item && kind === 'game' && <GameDetail item={item} key={item.id} />}
        {item && kind === 'community' && <CommunityDetail item={item} key={item.id} />}
      </div>
    </>
  );
}
