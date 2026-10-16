import { describe, expect, it } from 'vitest';
import { findContent, routeForContent, visiblePosts } from './content-model';
import { catalog, initialPosts } from './fixtures';
import { isComments, isPostArray } from './types';

describe('content routes and persisted content', () => {
  it('uses stable detail URLs and rejects content from another detail route', () => {
    expect(routeForContent(catalog.视频[0])).toBe('/watch/video-wilderness');
    expect(routeForContent(catalog.小说[0])).toBe('/books/book-sea-letters');
    expect(routeForContent(catalog.组织[0])).toBe('/organizations/organization-outdoors');
    expect(findContent('book-sea-letters', 'watch')).toBeUndefined();
    expect(findContent('missing-id', 'read')).toBeUndefined();
    expect(findContent('live-radio', 'watch')?.module).toBe('直播');
  });

  it('rejects corrupt local records while accepting the legacy post shape', () => {
    expect(isPostArray(initialPosts)).toBe(true);
    expect(isPostArray([{ ...initialPosts[0], id: '1' }])).toBe(false);
    expect(isComments({ '1': ['一起出发'] })).toBe(true);
    expect(isComments({ '1': [null] })).toBe(false);
  });

  it('sorts newest and popular feeds without mutating the stored array', () => {
    const posts = [
      { ...initialPosts[0], id: 20, likes: 1 },
      { ...initialPosts[1], id: 30, likes: 1 },
    ];
    expect(visiblePosts(posts, '', '最新', []).map((post) => post.id)).toEqual([30, 20]);
    expect(visiblePosts(posts, '', '热门', [20]).map((post) => post.id)).toEqual([20, 30]);
    expect(posts.map((post) => post.id)).toEqual([20, 30]);
  });
});
