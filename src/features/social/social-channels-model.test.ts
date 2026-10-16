import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addBroadcastComment,
  createSocialChannel,
  getBroadcastSnapshot,
  isBroadcastStore,
  markBroadcastViewed,
  pinBroadcastPost,
  publishBroadcast,
  setChannelMuted,
  setChannelSubscription,
  SOCIAL_CHANNELS_KEY,
  toggleBroadcastReaction,
} from './social-channels-model';

const ownChannel = () =>
  createSocialChannel(
    { name: '频道身份', description: '只分享有用的消息', icon: '📣' },
    '个人昵称',
  );
const find = (id: string) => getBroadcastSnapshot().channels.find((channel) => channel.id === id)!;

describe('Telegram-style local channel state', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });
  it('restores old channels without losing posts and respects explicit mute and unpin states', () => {
    const store = structuredClone(getBroadcastSnapshot());
    const channel = store.channels[0];
    delete channel.muted;
    delete channel.username;
    delete channel.pinnedPostId;
    for (const post of channel.posts) {
      delete post.views;
      delete post.reactions;
      delete post.comments;
      delete post.image;
    }
    channel.posts[0].text = '保留已编辑的正文';
    const legacy = JSON.stringify(store);
    localStorage.setItem(SOCIAL_CHANNELS_KEY, legacy);
    expect(isBroadcastStore(store)).toBe(true);
    expect(find(channel.id).posts[0].text).toBe('保留已编辑的正文');
    expect(find(channel.id).posts[0].views).toBe(1086);
    expect(localStorage.getItem(SOCIAL_CHANNELS_KEY)).toBe(legacy);
    const own = ownChannel();
    const postId = publishBroadcast(own, '新消息', '个人昵称');
    pinBroadcastPost(own, postId);
    pinBroadcastPost(own, null);
    setChannelMuted(own, true);
    setChannelMuted(own, false);
    expect(find(own)).toMatchObject({ pinnedPostId: null, muted: false });
  });
  it('publishes under the channel identity, supports image messages and enforces owner access', () => {
    const own = ownChannel();
    const postId = publishBroadcast(own, '', '另一个个人昵称', 'https://example.com/photo.jpg');
    expect(find(own).posts[0]).toMatchObject({
      id: postId,
      authorName: '频道身份',
      image: 'https://example.com/photo.jpg',
    });
    expect(() => publishBroadcast(own, '', '昵称')).toThrow('广播内容');
    expect(() => publishBroadcast(own, '图片', '昵称', 'javascript:alert(1)')).toThrow('图片地址');
    expect(() => publishBroadcast('orbit-updates', '越权消息', '昵称')).toThrow('只有频道创建者');
    expect(() => pinBroadcastPost('orbit-updates', 'orbit-update-1')).toThrow('只有频道创建者');
    expect(() => pinBroadcastPost(own, 'missing')).toThrow('消息不存在');
  });
  it('counts each local view once and stores reactions as one changeable choice', () => {
    const own = ownChannel();
    const postId = publishBroadcast(own, '测试表态', '昵称');
    markBroadcastViewed(own, postId);
    markBroadcastViewed(own, postId);
    expect(find(own).posts[0].views).toBe(1);
    toggleBroadcastReaction(own, postId, '👍');
    expect(find(own).posts[0]).toMatchObject({ myReaction: '👍', reactions: { '👍': 1 } });
    toggleBroadcastReaction(own, postId, '❤️');
    expect(find(own).posts[0]).toMatchObject({ myReaction: '❤️', reactions: { '👍': 0, '❤️': 1 } });
    toggleBroadcastReaction(own, postId, '❤️');
    expect(find(own).posts[0].myReaction).toBeUndefined();
    expect(find(own).posts[0].reactions?.['❤️']).toBe(0);
    expect(() => toggleBroadcastReaction(own, postId, 'unsupported')).toThrow('支持的表态');
  });
  it('isolates comments by channel and post and requires subscription for interaction', () => {
    expect(() => addBroadcastComment('design-notes', 'design-note-1', '回复', '我')).toThrow(
      '先加入',
    );
    expect(() => toggleBroadcastReaction('design-notes', 'design-note-1', '👍')).toThrow('先加入');
    expect(() => setChannelMuted('design-notes', true)).toThrow('先加入');
    setChannelSubscription('design-notes', true);
    addBroadcastComment('design-notes', 'design-note-1', '这条设计观察很有帮助。', '测试成员');
    expect(find('design-notes').posts[0].comments).toEqual([
      expect.objectContaining({
        authorId: 'me',
        authorName: '测试成员',
        text: '这条设计观察很有帮助。',
      }),
    ]);
    expect(find('orbit-updates').posts[0].comments).toHaveLength(1);
    setChannelMuted('design-notes', true);
    setChannelSubscription('design-notes', false);
    expect(find('design-notes').muted).toBe(false);
    expect(() => addBroadcastComment('orbit-updates', 'design-note-1', '串错帖子', '我')).toThrow(
      '消息不存在',
    );
    const store = structuredClone(getBroadcastSnapshot());
    store.channels[0].discussionEnabled = false;
    localStorage.setItem(SOCIAL_CHANNELS_KEY, JSON.stringify(store));
    expect(() =>
      addBroadcastComment('orbit-updates', 'orbit-update-2', '关闭后回复', '我'),
    ).toThrow('未开启评论');
  });
  it('rejects malformed extended fields without replacing stored data during reads', () => {
    const store = structuredClone(getBroadcastSnapshot());
    store.channels[0].posts[0].views = -1;
    expect(isBroadcastStore(store)).toBe(false);
    const raw = JSON.stringify(store);
    localStorage.setItem(SOCIAL_CHANNELS_KEY, raw);
    expect(find('orbit-updates').posts[0].views).toBe(1086);
    expect(localStorage.getItem(SOCIAL_CHANNELS_KEY)).toBe(raw);
  });
  it('leaves every interaction unchanged when persistence fails', () => {
    const own = ownChannel();
    const postId = publishBroadcast(own, '保存之前', '昵称');
    const before = localStorage.getItem(SOCIAL_CHANNELS_KEY);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    for (const action of [
      () => toggleBroadcastReaction(own, postId, '👍'),
      () => addBroadcastComment(own, postId, '不能丢失', '我'),
      () => setChannelMuted(own, true),
      () => pinBroadcastPost(own, postId),
      () => markBroadcastViewed(own, postId),
    ]) {
      expect(action).toThrow('保存失败');
    }
    expect(localStorage.getItem(SOCIAL_CHANNELS_KEY)).toBe(before);
    expect(find(own).posts[0]).toMatchObject({ views: 0, reactions: {}, comments: [] });
  });
});
