import { paths } from '@/shared/config/paths';
import { allCatalogItems } from './fixtures';
import { contentRoutes } from './domain';
import type { CatalogItem, DetailKind, FeedTab, Post } from './types';

export function routeForContent(item: CatalogItem) {
  if (item.module === '直播' || item.module === '视频') return paths.watch(item.id);
  if (item.module === '小说') return contentRoutes.book(item.id);
  if (item.module === '游戏') return paths.game(item.id);
  return paths.community(item.id);
}
export function findContent(id: string | undefined, kind: DetailKind) {
  return allCatalogItems.find(
    (item) =>
      item.id === id &&
      ((kind === 'watch' && (item.module === '直播' || item.module === '视频')) ||
        (kind === 'read' && item.module === '小说') ||
        (kind === 'game' && item.module === '游戏') ||
        (kind === 'community' && item.module === '组织')),
  );
}
export function visiblePosts(posts: Post[], query: string, tab: FeedTab, likes: number[]) {
  const normalized = query.trim().toLocaleLowerCase();
  const filtered = posts.filter((post) =>
    `${post.text} ${post.name}`.toLocaleLowerCase().includes(normalized),
  );
  if (tab === '最新') return filtered.sort((left, right) => right.id - left.id);
  if (tab === '热门')
    return filtered.sort(
      (left, right) =>
        right.likes +
        Number(likes.includes(right.id)) -
        (left.likes + Number(likes.includes(left.id))),
    );
  return filtered;
}
