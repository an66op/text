import { isStringArray, readStorage, writeStorage } from '@/shared/lib/storage';
import { catalog, initialPosts } from './fixtures';
import { isCommunities } from './persistence';
import { isPostArray } from './types';

export function migrateLegacyPosts() {
  const posts = readStorage('posts', initialPosts, isPostArray);
  let changed = false;
  const migrated = posts.map((post) => {
    // The earlier frontend saved its own publications without an ownership field.
    const legacyPublication =
      post.owner === undefined &&
      (post.name === '橘子汽水' || (post.id > 1000 && /^(社交|世界|动态) · 刚刚$/.test(post.tag)));
    if (!legacyPublication) return post;
    changed = true;
    return {
      ...post,
      owner: true,
      target:
        post.kind === '世界' || post.tag.startsWith('世界')
          ? ('world' as const)
          : ('activity' as const),
    };
  });
  if (changed) writeStorage('posts', migrated);
  return migrated;
}
export function legacyMemberships() {
  const titles = readStorage<string[]>('joined', [], isStringArray);
  const created = readStorage('content-communities', [], isCommunities);
  return {
    books: catalog.小说.filter((item) => titles.includes(item.title)).map((item) => item.id),
    communities: [...created, ...catalog.组织]
      .filter((item) => item.owner || titles.includes(item.title))
      .map((item) => item.id),
  };
}
