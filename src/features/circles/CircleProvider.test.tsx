import { act, cleanup, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ContentProvider } from '../content/ContentProvider';
import { ProfileProvider } from '../profile/profile-store';
import { ToastProvider } from '@/shared/ui/ToastProvider';
import { CircleProvider } from './CircleProvider';
import { useCircles } from './useCircles';
import { CIRCLES_STORAGE_KEY } from './circle-model';
import { seedPosts } from './fixtures';
import type { CircleInput } from './types';

const photography = 'organization-photography';
const outdoors = 'organization-outdoors';
const reading = 'organization-reading';
const draft: CircleInput = {
  name: '周末观星',
  description: '一起寻找城市之外的星光',
  cover: '/test-cover.jpg',
  icon: '🌙',
  category: '户外',
  visibility: 'public',
};
function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ProfileProvider>
        <ContentProvider>
          <CircleProvider>{children}</CircleProvider>
        </ContentProvider>
      </ProfileProvider>
    </ToastProvider>
  );
}
const mount = () => renderHook(() => useCircles(), { wrapper: Providers });
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('circle membership, permissions and content isolation', () => {
  it('migrates old organizations and memberships without changing stable IDs or old data', () => {
    const created = {
      id: 'organization-legacy',
      module: '组织',
      owner: true,
      title: '旧圈子',
      desc: '旧简介',
      img: '/legacy.jpg',
      badge: '生活社群',
    };
    localStorage.setItem('joined', JSON.stringify(['周末去野']));
    localStorage.setItem('content-communities', JSON.stringify([created]));
    localStorage.setItem('posts', JSON.stringify([]));
    const { result } = mount();
    expect(result.current.getCircle(outdoors)).toMatchObject({
      joined: true,
      role: 'member',
      id: outdoors,
    });
    expect(result.current.getCircle('organization-legacy')).toMatchObject({
      joined: true,
      role: 'owner',
      name: '旧圈子',
    });
    expect(result.current.getCircle(photography)).toMatchObject({ joined: true, role: 'admin' });
    expect(
      result.current.getMembers(photography).find((member) => member.id === 'achuan')?.role,
    ).toBe('owner');
    expect(result.current.getCircle(reading)?.role).toBe('guest');
    expect(JSON.parse(localStorage.getItem('content-communities') ?? '[]')).toEqual([created]);
    expect(localStorage.getItem('posts')).toBe('[]');
  });

  it('enforces guest/member/admin/owner permissions, including direct invalid IDs', () => {
    const { result } = mount();
    expect(result.current.getMessages(reading, 'general')).toEqual([]);
    expect(result.current.getChannels('missing')).toEqual([]);
    expect(result.current.getPosts(photography, 'missing')).toEqual([]);
    expect(result.current.canViewChannel(reading, 'general')).toBe(false);
    expect(() => result.current.sendMessage(reading, 'general', '越权')).toThrow('加入');
    act(() => result.current.joinCircle(reading));
    expect(result.current.canViewChannel(reading, 'general')).toBe(true);
    expect(result.current.canViewChannel(reading, 'staff')).toBe(false);
    expect(result.current.getMessages(reading, 'staff')).toEqual([]);
    expect(() => result.current.sendMessage(reading, 'staff', '越权')).toThrow('管理员');
    expect(() =>
      result.current.createChannel(reading, {
        name: '新频道',
        description: '',
        type: 'text',
        category: '交流',
        access: 'members',
      }),
    ).toThrow('管理员');
    expect(() => result.current.deleteCircle(photography)).toThrow('圈主');
    expect(() => result.current.setMemberRole(photography, 'lin', 'admin')).toThrow('圈主');
    expect(() => result.current.removeMember(photography, 'achuan')).toThrow('无权');
    expect(() => result.current.sendMessage(photography, 'missing', '消息')).toThrow('频道不存在');
    expect(() => result.current.updateCircle('missing', { name: '圈子' })).toThrow('圈子不存在');
    act(() => result.current.removeMember(photography, 'lin'));
    expect(result.current.getMembers(photography).some((member) => member.id === 'lin')).toBe(
      false,
    );
    expect(result.current.getCircle(photography)?.memberCount).toBe(203);
  });

  it('seeds announcements and permits only management to publish an announcement', () => {
    const { result } = mount();
    expect(result.current.getPosts(photography, 'welcome')).toHaveLength(2);
    expect(result.current.getPosts(photography, 'welcome')[0]).toMatchObject({
      authorId: 'achuan',
      channelId: 'welcome',
    });
    expect(() =>
      result.current.addPost(reading, 'welcome', { title: '越权公告', text: '内容' }),
    ).toThrow('加入');
    act(() => result.current.joinCircle(reading));
    expect(() =>
      result.current.addPost(reading, 'welcome', { title: '越权公告', text: '内容' }),
    ).toThrow('管理员');
    let id = '';
    act(() => {
      id = result.current.addPost(photography, 'welcome', {
        title: '周末集合提醒',
        text: '明天下午见',
      });
    });
    expect(
      result.current.getPosts(photography, 'welcome').find((post) => post.id === id),
    ).toMatchObject({ authorId: 'me', title: '周末集合提醒' });
    expect(result.current.getPosts(reading, 'welcome')).toHaveLength(2);
  });

  it('scopes messages, posts, unread and events to their circle and restores them after remount', () => {
    localStorage.setItem(
      'profile',
      JSON.stringify({ name: '测试成员', bio: '', avatar: '/my-avatar.jpg' }),
    );
    const mounted = mount();
    const { result } = mounted;
    const markRead = result.current.markRead;
    act(() => {
      result.current.joinCircle(reading);
      result.current.sendMessage(photography, 'general', ' 第一条 ');
      result.current.sendMessage(photography, 'general', '第二条');
      result.current.markRead(photography, 'general');
      result.current.toggleEvent(photography, 'city-photowalk');
      result.current.addComment(photography, 'blue-hour', ' 很喜欢 ');
      result.current.togglePostLike(photography, 'blue-hour');
    });
    expect(result.current.markRead).toBe(markRead);
    expect(
      result.current
        .getMessages(photography, 'general')
        .slice(-2)
        .map((message) => message.text),
    ).toEqual(['第一条', '第二条']);
    expect(result.current.getMessages(photography, 'general').at(-1)).toMatchObject({
      authorId: 'me',
      authorName: '测试成员',
      avatar: '/my-avatar.jpg',
    });
    expect(
      result.current.getMessages(reading, 'general').some((message) => message.authorId === 'me'),
    ).toBe(false);
    expect(
      result.current.getChannels(photography).find((channel) => channel.id === 'general')?.unread,
    ).toBe(0);
    expect(
      result.current.getChannels(reading).find((channel) => channel.id === 'general')?.unread,
    ).toBe(3);
    expect(result.current.getPosts(photography, 'photos')[0]).toMatchObject({
      liked: true,
      likes: 25,
    });
    expect(result.current.getPosts(reading, 'photos')[0]).toMatchObject({
      liked: false,
      likes: 24,
    });
    expect(result.current.isAttending(photography, 'city-photowalk')).toBe(true);
    expect(result.current.isAttending(reading, 'city-photowalk')).toBe(false);
    mounted.unmount();
    const restored = mount();
    expect(restored.result.current.getMessages(photography, 'general').at(-1)?.text).toBe('第二条');
    expect(restored.result.current.getPosts(photography, 'photos')[0].comments.at(-1)?.text).toBe(
      '很喜欢',
    );
    expect(restored.result.current.isAttending(photography, 'city-photowalk')).toBe(true);
  });

  it('lets management feature and pin posts while preserving discussion data and circle isolation after remount', () => {
    const mounted = mount();
    const { result } = mounted;
    expect(result.current.getPosts(photography, 'photos')[0].featured).toBe(true);
    expect(result.current.getPosts(photography, 'welcome')[0].pinned).toBe(true);
    const original = result.current
      .getPosts(photography, 'photos')
      .find((post) => post.id === 'blue-hour');
    act(() => {
      result.current.setPostFeatured(photography, 'blue-hour', false);
      result.current.setPostPinned(photography, 'blue-hour', true);
      result.current.joinCircle(reading);
    });
    expect(
      result.current.getPosts(photography, 'photos').find((post) => post.id === 'blue-hour'),
    ).toEqual({ ...original, featured: false, pinned: true });
    expect(
      result.current.getPosts(reading, 'photos').find((post) => post.id === 'blue-hour'),
    ).toMatchObject({ featured: true });
    expect(
      result.current.getPosts(reading, 'photos').find((post) => post.id === 'blue-hour')?.pinned,
    ).toBeUndefined();
    let ownerCircle = '';
    let ownerPost = '';
    act(() => {
      ownerCircle = result.current.createCircle(draft);
      expect(result.current.getPosts(ownerCircle)).toEqual([]);
      ownerPost = result.current.addPost(ownerCircle, 'photos', {
        title: '圈主的第一篇',
        text: '记录今晚的天空',
      });
      result.current.setPostFeatured(ownerCircle, ownerPost, true);
      result.current.setPostPinned(ownerCircle, ownerPost, true);
    });
    expect(result.current.getPosts(ownerCircle, 'photos')[0]).toMatchObject({
      featured: true,
      pinned: true,
    });
    mounted.unmount();
    const restored = mount();
    expect(
      restored.result.current
        .getPosts(photography, 'photos')
        .find((post) => post.id === 'blue-hour'),
    ).toEqual({ ...original, featured: false, pinned: true });
    expect(restored.result.current.getPosts(ownerCircle, 'photos')[0]).toMatchObject({
      id: ownerPost,
      featured: true,
      pinned: true,
    });
  });

  it('rejects guest/member moderation and checks that the post belongs to an existing accessible channel', () => {
    const { result } = mount();
    expect(() => result.current.setPostFeatured(reading, 'blue-hour', true)).toThrow('加入');
    expect(() => result.current.setPostPinned(reading, 'blue-hour', true)).toThrow('加入');
    let memberPost = '';
    act(() => {
      result.current.joinCircle(reading);
      memberPost = result.current.addPost(reading, 'photos', {
        title: '自己的作品',
        text: '分享一张照片',
      });
    });
    expect(() => result.current.setPostFeatured(reading, memberPost, true)).toThrow('管理员');
    expect(() => result.current.setPostPinned(reading, memberPost, true)).toThrow('管理员');
    expect(() => result.current.setPostFeatured(photography, memberPost, true)).toThrow(
      '帖子不存在',
    );
    expect(() => result.current.setPostPinned(photography, 'missing', true)).toThrow('帖子不存在');
    expect(() => result.current.setPostFeatured('missing', 'blue-hour', true)).toThrow(
      '圈子不存在',
    );
    act(() => result.current.updateChannel(photography, 'photos', { access: 'staff' }));
    act(() => result.current.setPostPinned(photography, 'blue-hour', true));
    expect(result.current.getPosts(photography, 'photos')[0].pinned).toBe(true);
    act(() => {
      result.current.leaveCircle(photography);
      result.current.joinCircle(photography);
    });
    expect(result.current.getPosts(photography, 'photos')).toEqual([]);
    expect(() => result.current.setPostPinned(photography, 'blue-hour', false)).toThrow('管理员');
  });

  it('restores flagless saved posts without replacing existing content and adds moderation fields in place', () => {
    const legacyPosts = seedPosts(photography).map((post) => {
      const saved = { ...post };
      delete saved.featured;
      delete saved.pinned;
      return saved;
    });
    legacyPosts[0] = {
      ...legacyPosts[0],
      title: '用户原来保存的标题',
      text: '保留原来的正文',
      likes: 99,
      liked: true,
    };
    const savedStore = {
      version: 1,
      circles: {
        [photography]: {
          posts: legacyPosts,
          attendance: ['city-photowalk'],
          messages: {
            general: [
              {
                id: 'old-message',
                authorId: 'me',
                authorName: '橘子汽水',
                avatar: '',
                text: '原来的聊天',
                createdAt: 123,
              },
            ],
          },
        },
      },
      deleted: [],
    };
    localStorage.setItem(CIRCLES_STORAGE_KEY, JSON.stringify(savedStore));
    const mounted = mount();
    expect(mounted.result.current.getPosts(photography)).toEqual(
      legacyPosts.map((post) => ({
        ...post,
        ...(post.id === 'blue-hour' ? { featured: true } : {}),
        ...(post.id === 'community-guide' ? { pinned: true } : {}),
      })),
    );
    expect(localStorage.getItem(CIRCLES_STORAGE_KEY)).toBe(JSON.stringify(savedStore));
    act(() => {
      mounted.result.current.setPostFeatured(photography, 'blue-hour', false);
      mounted.result.current.setPostPinned(photography, 'community-guide', false);
    });
    expect(mounted.result.current.getPosts(photography)[0]).toEqual({
      ...legacyPosts[0],
      featured: false,
    });
    mounted.unmount();
    const restored = mount();
    expect(restored.result.current.getPosts(photography)[0]).toEqual({
      ...legacyPosts[0],
      featured: false,
    });
    expect(restored.result.current.getPosts(photography)[1]).toEqual(legacyPosts[1]);
    expect(
      restored.result.current.getPosts(photography).find((post) => post.id === 'community-guide')
        ?.pinned,
    ).toBe(false);
    expect(restored.result.current.getMessages(photography, 'general')[0].text).toBe('原来的聊天');
    expect(restored.result.current.isAttending(photography, 'city-photowalk')).toBe(true);
  });

  it('scopes event attendance to the selected channel and checks its access instead of the first events channel', () => {
    const mounted = mount();
    const { result } = mounted;
    let publicEvents = '';
    act(() => {
      publicEvents = result.current.createChannel(photography, {
        name: '公开活动',
        description: '大家都可以参加',
        type: 'events',
        category: '共同参与',
        access: 'members',
      });
      result.current.toggleEvent(photography, 'city-photowalk', publicEvents);
    });
    expect(result.current.isAttending(photography, 'city-photowalk', publicEvents)).toBe(true);
    expect(result.current.isAttending(photography, 'city-photowalk', 'events')).toBe(false);
    act(() => {
      result.current.toggleEvent(photography, 'city-photowalk', 'events');
      result.current.updateChannel(photography, 'events', { access: 'staff' });
      result.current.leaveCircle(photography);
      result.current.joinCircle(photography);
    });
    expect(result.current.getCircle(photography)?.role).toBe('member');
    expect(result.current.isAttending(photography, 'city-photowalk', 'events')).toBe(false);
    expect(() => result.current.toggleEvent(photography, 'city-photowalk', 'events')).toThrow(
      '管理员',
    );
    expect(() => result.current.toggleEvent(photography, 'city-photowalk', 'general')).toThrow(
      '活动频道不存在',
    );
    act(() => result.current.toggleEvent(photography, 'city-photowalk', publicEvents));
    expect(result.current.isAttending(photography, 'city-photowalk', publicEvents)).toBe(false);
    expect(
      JSON.parse(localStorage.getItem(CIRCLES_STORAGE_KEY) ?? '{}').circles[photography].attendance,
    ).toEqual(['events:city-photowalk']);
    act(() => result.current.toggleEvent(photography, 'city-photowalk', publicEvents));
    mounted.unmount();
    const restored = mount();
    expect(restored.result.current.isAttending(photography, 'city-photowalk', publicEvents)).toBe(
      true,
    );
    expect(restored.result.current.isAttending(photography, 'city-photowalk')).toBe(false);
    expect(restored.result.current.isAttending(photography, 'city-photowalk', 'general')).toBe(
      false,
    );
    expect(restored.result.current.isAttending(photography, 'city-photowalk', 'missing')).toBe(
      false,
    );
  });

  it('keeps legacy bare event IDs in the canonical channel and does not move them to another events channel', () => {
    localStorage.setItem(
      CIRCLES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        circles: { [photography]: { attendance: ['city-photowalk'] } },
        deleted: [],
      }),
    );
    const { result } = mount();
    let secondEvents = '';
    act(() => {
      secondEvents = result.current.createChannel(photography, {
        name: '更多活动',
        description: '',
        type: 'events',
        category: '共同参与',
        access: 'members',
      });
    });
    expect(result.current.isAttending(photography, 'city-photowalk')).toBe(true);
    expect(result.current.isAttending(photography, 'city-photowalk', 'events')).toBe(true);
    expect(result.current.isAttending(photography, 'city-photowalk', secondEvents)).toBe(false);
    act(() => result.current.toggleEvent(photography, 'city-photowalk', secondEvents));
    expect(result.current.isAttending(photography, 'city-photowalk')).toBe(true);
    act(() => result.current.toggleEvent(photography, 'city-photowalk'));
    expect(result.current.isAttending(photography, 'city-photowalk')).toBe(false);
    expect(result.current.isAttending(photography, 'city-photowalk', secondEvents)).toBe(true);
    expect(
      JSON.parse(localStorage.getItem(CIRCLES_STORAGE_KEY) ?? '{}').circles[photography].attendance,
    ).toEqual([`${secondEvents}:city-photowalk`]);
    act(() => result.current.deleteChannel(photography, 'events'));
    expect(result.current.isAttending(photography, 'city-photowalk')).toBe(false);
    expect(() => result.current.toggleEvent(photography, 'city-photowalk')).toThrow(
      '活动频道不存在',
    );
    expect(result.current.isAttending(photography, 'city-photowalk', secondEvents)).toBe(true);
    act(() => result.current.deleteChannel(photography, secondEvents));
    expect(
      JSON.parse(localStorage.getItem(CIRCLES_STORAGE_KEY) ?? '{}').circles[photography].attendance,
    ).toEqual([]);
  });

  it('creates a legacy-backed owner circle, checks invitation codes, and persists channel lifecycle', () => {
    const { result } = mount();
    let id = '';
    let channelId = '';
    act(() => {
      id = result.current.createCircle({ ...draft, visibility: 'invite' });
    });
    expect(result.current.getCircle(id)).toMatchObject({
      name: draft.name,
      role: 'owner',
      joined: true,
      visibility: 'invite',
    });
    expect(JSON.parse(localStorage.getItem('content-communities') ?? '[]')[0]).toMatchObject({
      id,
      title: draft.name,
      owner: true,
    });
    expect(() => result.current.leaveCircle(id)).toThrow('圈主不能退出');
    act(() => {
      channelId = result.current.createChannel(id, {
        name: '观察笔记',
        description: '分享今晚的天空',
        type: 'forum',
        category: '一起交流',
        access: 'members',
      });
      result.current.updateCircle(id, { name: '星光俱乐部' });
      result.current.updateChannel(id, channelId, { name: '星空照片' });
      result.current.addPost(id, channelId, { title: '第一颗星', text: '今晚的天空很清澈' });
    });
    expect(result.current.getPosts(id, channelId)[0]?.authorId).toBe('me');
    expect(result.current.getChannels(id).find((channel) => channel.id === channelId)?.name).toBe(
      '星空照片',
    );
    act(() => result.current.deleteChannel(id, channelId));
    expect(result.current.getPosts(id, channelId)).toEqual([]);
    expect(() =>
      result.current.addPost(id, channelId, { title: '不能发布', text: '已删除' }),
    ).toThrow('频道不存在');
    act(() => result.current.updateCircle(photography, { visibility: 'invite' }));
    act(() => result.current.leaveCircle(photography));
    expect(() => result.current.joinCircle(photography, 'WRONG')).toThrow('邀请码');
    act(() => result.current.joinCircle(photography, 'FRIENDS204'));
    expect(result.current.getCircle(photography)?.role).toBe('member');
    act(() => result.current.deleteCircle(id));
    expect(result.current.getCircle(id)).toBeUndefined();
    expect(JSON.parse(localStorage.getItem('content-communities') ?? '[]')).toEqual([]);
  });
});

describe('circle persistence failures and recovery', () => {
  it('recovers invalid saved collections and does not let malformed records break routed getters', () => {
    localStorage.setItem(
      CIRCLES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        circles: { [photography]: { channels: [{ id: 'bad', unread: 'many' }] } },
        deleted: [],
      }),
    );
    const { result } = mount();
    expect(
      result.current.getChannels(photography).some((channel) => channel.id === 'general'),
    ).toBe(true);
    expect(result.current.getMessages('missing', 'general')).toEqual([]);
    expect(result.current.getMembers('missing')).toEqual([]);
    expect(result.current.getPosts('missing')).toEqual([]);
    expect(result.current.isAttending('missing', 'city-photowalk')).toBe(false);
  });

  it('throws on storage failure without accepting a new message or returning a created ID', () => {
    const { result } = mount();
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === CIRCLES_STORAGE_KEY) throw new DOMException('quota', 'QuotaExceededError');
      original.call(this, key, value);
    });
    const before = result.current.getMessages(photography, 'general').length;
    act(() => {
      expect(() => result.current.sendMessage(photography, 'general', '不会保存')).toThrow(
        '保存失败',
      );
      expect(() => result.current.createCircle(draft)).toThrow('保存失败');
      expect(() => result.current.setPostFeatured(photography, 'blue-hour', false)).toThrow(
        '保存失败',
      );
      expect(() => result.current.setPostPinned(photography, 'blue-hour', true)).toThrow(
        '保存失败',
      );
    });
    expect(result.current.getMessages(photography, 'general')).toHaveLength(before);
    expect(result.current.getPosts(photography, 'photos')[0].featured).toBe(true);
    expect(result.current.getPosts(photography, 'photos')[0].pinned).toBeUndefined();
    expect(result.current.circles.some((circle) => circle.name === draft.name)).toBe(false);
    expect(JSON.parse(localStorage.getItem('content-communities') ?? '[]')).toEqual([]);
    expect(screen.getByRole('status')).toHaveTextContent('存储空间不足');
  });

  it('rolls back a legacy-provider write failure instead of accepting a created circle', () => {
    const { result } = mount();
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'content-communities') throw new DOMException('quota', 'QuotaExceededError');
      original.call(this, key, value);
    });
    act(() => expect(() => result.current.createCircle(draft)).toThrow('保存失败'));
    expect(result.current.circles.some((circle) => circle.name === draft.name)).toBe(false);
    expect(JSON.parse(localStorage.getItem('content-community-ids') ?? '[]')).toEqual([]);
  });
});
