import { describe, expect, it } from 'vitest';
import { isCircleStore } from './circle-model';
import { seedChannels, seedPosts } from './fixtures';
const id = 'organization-photography';

describe('circle persisted schema', () => {
  it('accepts old posts without moderation flags and validates new optional flags', () => {
    const post = { ...seedPosts(id)[0] };
    delete post.featured;
    delete post.pinned;
    const store = (featured?: unknown, pinned?: unknown) => ({
      version: 1,
      circles: { [id]: { posts: [{ ...post, featured, pinned }] } },
      deleted: [],
    });
    expect(isCircleStore(store())).toBe(true);
    expect(isCircleStore(store(true, false))).toBe(true);
    expect(isCircleStore(store('true', false))).toBe(false);
    expect(isCircleStore(store(false, 1))).toBe(false);
  });

  it('accepts scoped content and rejects malformed nested records or references to another circle/channel', () => {
    const valid = {
      version: 1,
      circles: {
        [id]: { channels: seedChannels(id), posts: seedPosts(id), joined: true, role: 'admin' },
      },
      deleted: [],
    };
    expect(isCircleStore(valid)).toBe(true);
    expect(isCircleStore({ ...valid, version: 2 })).toBe(false);
    expect(
      isCircleStore({ ...valid, circles: { [id]: { ...valid.circles[id], joined: false } } }),
    ).toBe(false);
    expect(
      isCircleStore({ ...valid, circles: { [id]: { channels: seedChannels('other-circle') } } }),
    ).toBe(false);
    expect(
      isCircleStore({ ...valid, circles: { [id]: { channels: [], posts: seedPosts(id) } } }),
    ).toBe(false);
    expect(
      isCircleStore({
        ...valid,
        circles: {
          [id]: { posts: [{ ...seedPosts(id)[0], comments: [{ id: 'invalid-comment' }] }] },
        },
      }),
    ).toBe(false);
    expect(
      isCircleStore({
        ...valid,
        circles: { [id]: { channels: seedChannels(id), messages: { deleted: [] } } },
      }),
    ).toBe(false);
  });
});
