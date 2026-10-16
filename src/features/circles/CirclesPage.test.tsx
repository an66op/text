import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { CircleContext, type CirclesState } from './circle-context';
import type { Circle } from './types';
import CirclesPage from './CirclesPage';

const circles: Circle[] = [
  {
    id: 'photo',
    name: '街头摄影散步',
    description: '发现城市的光影',
    icon: '📷',
    cover: '/photo.jpg',
    category: '摄影',
    joined: true,
    role: 'member',
    memberCount: 204,
    onlineCount: 18,
    visibility: 'public',
    inviteCode: 'PHOTO',
  },
  {
    id: 'reading',
    name: '城市读书会',
    description: '周末一起分享阅读',
    icon: '📚',
    cover: '/book.jpg',
    category: '读书',
    joined: false,
    role: 'guest',
    memberCount: 36,
    onlineCount: 3,
    visibility: 'public',
    inviteCode: 'BOOK',
  },
  {
    id: 'film',
    name: '胶片小屋',
    description: '每一张照片的故事',
    icon: '🎞️',
    cover: '/film.jpg',
    category: '摄影',
    joined: false,
    role: 'guest',
    memberCount: 12,
    onlineCount: 2,
    visibility: 'invite',
    inviteCode: 'FILM',
  },
];
function renderDirectory(items = circles) {
  const getMembers = vi.fn((id: string) => {
    if (id !== 'photo') throw new Error('Unjoined member records must not be read');
    return [
      { id: 'owner', name: '阿川', avatar: '/avatar.jpg', role: 'owner' as const, online: true },
    ];
  });
  const getPosts = vi.fn((id: string) => {
    if (id !== 'photo') throw new Error('Unjoined content must not be read');
    return [
      {
        id: 'post-old',
        circleId: id,
        channelId: 'photos',
        authorId: 'owner',
        authorName: '阿川',
        avatar: '/avatar.jpg',
        title: '旧日午后',
        text: '很久以前',
        createdAt: 1,
        likes: 0,
        liked: false,
        comments: [],
      },
      {
        id: 'post-new',
        circleId: id,
        channelId: 'photos',
        authorId: 'owner',
        authorName: '阿川',
        avatar: '/avatar.jpg',
        title: '今日街角的光',
        text: '今天下午',
        createdAt: 2,
        likes: 0,
        liked: false,
        comments: [],
      },
    ];
  });
  const value: CirclesState = {
    circles: items,
    getCircle: (id) => items.find((circle) => circle.id === id),
    getMembers,
    getPosts,
    getChannels: vi.fn(() => []),
    getMessages: () => [],
    canViewChannel: () => true,
    markRead: vi.fn(),
    joinCircle: vi.fn(),
    leaveCircle: vi.fn(),
    createCircle: vi.fn(() => 'new'),
    updateCircle: vi.fn(),
    deleteCircle: vi.fn(),
    createChannel: vi.fn(() => 'channel'),
    updateChannel: vi.fn(),
    deleteChannel: vi.fn(),
    setMemberRole: vi.fn(),
    removeMember: vi.fn(),
    sendMessage: vi.fn(),
    addPost: vi.fn(() => 'post'),
    addComment: vi.fn(),
    togglePostLike: vi.fn(),
    setPostFeatured: vi.fn(),
    setPostPinned: vi.fn(),
    toggleEvent: vi.fn(),
    isAttending: () => false,
  };
  render(
    <MemoryRouter>
      <CircleContext.Provider value={value}>
        <CirclesPage />
      </CircleContext.Provider>
    </MemoryRouter>,
  );
  return value;
}

describe('creator circle directory', () => {
  it('uses the two short navigation tabs and shows public metadata for recommendations', () => {
    const value = renderDirectory();
    expect(screen.getByRole('tab', { name: '发现' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /^我的/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '创建' })).toHaveAttribute('href', '/circles/new');
    expect(screen.getByRole('link', { name: '推荐圈子：城市读书会' })).toHaveAttribute(
      'href',
      '/circles/reading',
    );
    const region = screen.getByRole('region', { name: '发现圈子' });
    expect(within(region).getByText('阿川')).toBeInTheDocument();
    expect(within(region).getByText('2 篇内容')).toBeInTheDocument();
    expect(within(region).getByText('今日街角的光')).toBeInTheDocument();
    expect(within(region).queryByText('旧日午后')).not.toBeInTheDocument();
    expect(within(region).getByText('邀请制')).toBeInTheDocument();
    expect(value.getMembers).toHaveBeenCalledWith('photo');
    expect(value.getMembers).not.toHaveBeenCalledWith('reading');
    expect(value.getPosts).not.toHaveBeenCalledWith('film');
    expect(value.getChannels).not.toHaveBeenCalled();
  });

  it('combines category and text filters, shows an empty result, and resets both', () => {
    renderDirectory();
    fireEvent.click(screen.getByRole('button', { name: '摄影' }));
    const region = screen.getByRole('region', { name: '发现圈子' });
    expect(within(region).getByRole('heading', { name: '街头摄影散步' })).toBeInTheDocument();
    expect(within(region).getByRole('heading', { name: '胶片小屋' })).toBeInTheDocument();
    expect(within(region).queryByRole('heading', { name: '城市读书会' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /推荐圈子/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '搜索圈子' }), {
      target: { value: '胶片' },
    });
    expect(within(region).getByRole('heading', { name: '胶片小屋' })).toBeInTheDocument();
    expect(within(region).queryByRole('heading', { name: '街头摄影散步' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '搜索圈子' }), {
      target: { value: '读书' },
    });
    expect(screen.getByText('没有找到相关圈子')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getByRole('textbox', { name: '搜索圈子' })).toHaveValue('');
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(region).getAllByRole('heading', { level: 3 })).toHaveLength(3);
  });

  it('shows the joined compact rail and limits My circles and categories to membership', () => {
    renderDirectory();
    fireEvent.click(screen.getByRole('button', { name: '读书' }));
    fireEvent.click(screen.getByRole('tab', { name: /^我的/ }));
    const rail = screen.getByRole('navigation', { name: '已加入的圈子' });
    expect(within(rail).getByRole('link', { name: /街头摄影散步/ })).toHaveAttribute(
      'href',
      '/circles/photo',
    );
    expect(within(rail).getByRole('link', { name: /创建圈子/ })).toHaveAttribute(
      'href',
      '/circles/new',
    );
    expect(
      within(screen.getByRole('region', { name: '我的圈子' })).getAllByRole('heading', {
        level: 3,
      }),
    ).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '读书' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('supports keyboard tab navigation and switching from an empty joined collection', () => {
    renderDirectory(circles.map((circle) => ({ ...circle, joined: false, role: 'guest' })));
    fireEvent.keyDown(screen.getByRole('tab', { name: '发现' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: '我的' })).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '我的' }));
    expect(screen.getByText('还没有加入圈子')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '去发现' }));
    expect(screen.getByRole('tab', { name: '发现' })).toHaveAttribute('aria-selected', 'true');
  });
});
