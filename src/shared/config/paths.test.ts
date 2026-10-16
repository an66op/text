import { describe, expect, it } from 'vitest';
import { modulePaths, pathForModule, paths } from './paths';

describe('application navigation paths', () => {
  it('encodes external identifiers as one URL segment', () => {
    const id = '群聊 / # ? 100%';
    const segment = encodeURIComponent(id);

    expect(paths.chat(id)).toBe(`/social/chat/${segment}`);
    expect(paths.watch(id)).toBe(`/watch/${segment}`);
    expect(paths.read(id)).toBe(`/read/${segment}`);
    expect(paths.game(id)).toBe(`/games/${segment}`);
    expect(paths.community(id)).toBe(`/organizations/${segment}`);
    expect(paths.channel(id)).toBe(`/social/channels/${segment}`);
    expect(paths.matchProfile(id)).toBe(`/match/profile/${segment}`);
    expect(paths.walletEarnProduct(id)).toBe(`/wallet/earn/products/${segment}`);
    expect(paths.shopProduct(id)).toBe(`/shop/products/${segment}`);
    expect(paths.shopOrder(id)).toBe(`/shop/orders/${segment}`);
    expect(paths.aiChat(id)).toBe(`/ai/chat/${segment}`);
    expect(paths.post(123)).toBe('/world/posts/123');
  });

  it('maps the current Chinese module labels to their public routes', () => {
    const expected = {
      社交: '/social',
      AI: '/ai',
      世界: '/world',
      直播: '/live',
      视频: '/videos',
      短视频: '/shorts',
      小说: '/library',
      书架: '/bookshelf',
      组织: '/circles',
      圈子: '/circles',
      匹配: '/match',
      频道: '/social?type=channels',
      理财: '/wallet/earn',
      游戏: '/games',
      商城: '/shop',
      钱包: '/wallet',
    };

    expect(modulePaths).toEqual(expected);
    for (const [label, route] of Object.entries(expected)) {
      expect(pathForModule(label)).toBe(route);
    }
  });

  it('sends removed or unrecognized modules to discovery', () => {
    for (const label of ['推文', '娱乐游戏', '图文', '贴吧', '未知入口']) {
      expect(pathForModule(label)).toBe('/discover');
    }
  });
});
