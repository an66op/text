import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { CircleContext, type CirclesState } from './circle-context';
import type { Circle, CircleChannel, CirclePost } from './types';
import ChannelPage, { CirclePostImage } from './ChannelPage';
import { CircleComposePage, CirclePostPage } from './PostPages';
import VoiceRoomPage from './VoiceRoomPage';

const circle: Circle = {
  id: 'test',
  name: '测试圈子',
  description: '共同分享',
  cover: '',
  icon: '📷',
  category: '摄影',
  joined: true,
  role: 'member',
  memberCount: 20,
  onlineCount: 3,
  visibility: 'public',
  inviteCode: 'TEST',
};
const channels: CircleChannel[] = [
  {
    id: 'chat',
    circleId: 'test',
    name: '日常闲聊',
    description: '说说今天',
    type: 'text',
    category: '交流',
    access: 'members',
    unread: 3,
  },
  {
    id: 'posts',
    circleId: 'test',
    name: '作品分享',
    description: '分享作品',
    type: 'forum',
    category: '交流',
    access: 'members',
    unread: 0,
  },
  {
    id: 'voice',
    circleId: 'test',
    name: '语音客厅',
    description: '一起聊聊',
    type: 'voice',
    category: '交流',
    access: 'members',
    unread: 0,
  },
  {
    id: 'staff',
    circleId: 'test',
    name: '管理频道',
    description: '团队协作',
    type: 'forum',
    category: '管理',
    access: 'staff',
    unread: 0,
  },
];
const post: CirclePost = {
  id: 'secret',
  circleId: 'test',
  channelId: 'staff',
  authorId: 'owner',
  authorName: '圈主',
  avatar: '',
  title: '团队私密内容',
  text: '成员不应看到这里',
  createdAt: Date.now(),
  likes: 0,
  liked: false,
  comments: [],
};
function state(overrides: Partial<CirclesState> = {}): CirclesState {
  return {
    circles: [circle],
    getCircle: () => circle,
    getChannels: () => channels,
    getMembers: () => [],
    getMessages: () => [],
    getPosts: () => [],
    canViewChannel: (_circleId, channelId) => channelId !== 'staff',
    markRead: vi.fn(),
    joinCircle: vi.fn(),
    leaveCircle: vi.fn(),
    createCircle: () => 'new',
    updateCircle: vi.fn(),
    deleteCircle: vi.fn(),
    createChannel: () => 'new',
    updateChannel: vi.fn(),
    deleteChannel: vi.fn(),
    setMemberRole: vi.fn(),
    removeMember: vi.fn(),
    sendMessage: vi.fn(),
    addPost: () => 'new',
    addComment: vi.fn(),
    togglePostLike: vi.fn(),
    setPostFeatured: vi.fn(),
    setPostPinned: vi.fn(),
    toggleEvent: vi.fn(),
    isAttending: () => false,
    ...overrides,
  };
}
function renderFlow(value: CirclesState, path: string) {
  return render(
    <CircleContext.Provider value={value}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/circles/:circleId/channels/:channelId" element={<ChannelPage />} />
          <Route
            path="/circles/:circleId/channels/:channelId/new"
            element={<CircleComposePage />}
          />
          <Route path="/circles/:circleId/posts/:postId" element={<CirclePostPage />} />
          <Route path="/circles/:circleId/voice/:channelId" element={<VoiceRoomPage />} />
          <Route path="/circles/:circleId" element={<h1>圈子首页</h1>} />
        </Routes>
      </MemoryRouter>
    </CircleContext.Provider>,
  );
}

describe('circle channel content flows', () => {
  it('preserves failed messages, protects IME confirmation and marks a channel read only once', () => {
    const sendMessage = vi.fn().mockImplementationOnce(() => {
      throw new Error('存储空间已满');
    });
    const markRead = vi.fn();
    renderFlow(state({ sendMessage, markRead }), '/circles/test/channels/chat');
    const input = screen.getByRole('textbox', { name: '发送到 日常闲聊' });
    fireEvent.change(input, { target: { value: '一起去拍照' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(sendMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    expect(screen.getByRole('alert')).toHaveTextContent('存储空间已满');
    expect(input).toHaveValue('一起去拍照');
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    expect(sendMessage).toHaveBeenLastCalledWith('test', 'chat', '一起去拍照');
    expect(input).toHaveValue('');
    expect(markRead).toHaveBeenCalledExactlyOnceWith('test', 'chat');
  });

  it('gives nonmembers a join route without reading private messages', () => {
    const getMessages = vi.fn(() => []);
    renderFlow(
      state({ getCircle: () => ({ ...circle, joined: false, role: 'guest' }), getMessages }),
      '/circles/test/channels/chat',
    );
    expect(screen.getByRole('link', { name: '加入这个圈子' })).toHaveAttribute(
      'href',
      '/circles/test/join',
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(getMessages).not.toHaveBeenCalled();
  });

  it('blocks direct access to staff posts and publishing in staff channels', () => {
    const value = state({ getPosts: () => [post] });
    const view = renderFlow(value, '/circles/test/posts/secret');
    expect(screen.getByRole('heading', { name: '暂时无法查看这篇帖子' })).toBeInTheDocument();
    expect(screen.queryByText('团队私密内容')).not.toBeInTheDocument();
    view.unmount();
    renderFlow(value, '/circles/test/channels/staff/new');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('keeps a failed post draft and navigates to the new detail after a successful retry', () => {
    const addPost = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('未能保存');
      })
      .mockReturnValue('new-post');
    const newPost = {
      ...post,
      id: 'new-post',
      channelId: 'posts',
      title: '新的日常',
      text: '今天的光很好看',
    };
    renderFlow(state({ addPost, getPosts: () => [newPost] }), '/circles/test/channels/posts/new');
    fireEvent.change(screen.getByRole('textbox', { name: '标题' }), {
      target: { value: '新的日常' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '正文' }), {
      target: { value: '今天的光很好看' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发布帖子' }));
    expect(screen.getByRole('alert')).toHaveTextContent('未能保存');
    expect(screen.getByRole('textbox', { name: '标题' })).toHaveValue('新的日常');
    fireEvent.click(screen.getByRole('button', { name: '发布帖子' }));
    expect(addPost).toHaveBeenLastCalledWith('test', 'posts', {
      title: '新的日常',
      text: '今天的光很好看',
    });
    expect(screen.getByRole('heading', { name: '新的日常' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '标题' })).not.toBeInTheDocument();
  });

  it('handles broken images without leaving a broken image element', () => {
    render(<CirclePostImage src="https://example.com/missing.jpg" title="风景" />);
    fireEvent.error(screen.getByRole('img', { name: '风景' }));
    expect(screen.getByText('图片暂时无法显示')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('lets managers feature and pin a post, with updated badges and reversible actions', () => {
    let managedPost: CirclePost = { ...post, channelId: 'posts', featured: false, pinned: false };
    const setPostFeatured = vi.fn((_circleId, _postId, featured: boolean) => {
      managedPost = { ...managedPost, featured };
    });
    const setPostPinned = vi.fn((_circleId, _postId, pinned: boolean) => {
      managedPost = { ...managedPost, pinned };
    });
    renderFlow(
      state({
        getCircle: () => ({ ...circle, role: 'admin' }),
        getPosts: () => [managedPost],
        setPostFeatured,
        setPostPinned,
      }),
      '/circles/test/posts/secret',
    );
    expect(screen.getByRole('group', { name: '动态管理' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '设为精华' }));
    expect(setPostFeatured).toHaveBeenLastCalledWith('test', 'secret', true);
    expect(screen.getByRole('button', { name: '取消精华' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('精华', { selector: '.creator-post-badge' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '置顶动态' }));
    expect(setPostPinned).toHaveBeenLastCalledWith('test', 'secret', true);
    expect(screen.getByText('置顶', { selector: '.creator-post-badge' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('已置顶这条动态');
    fireEvent.click(screen.getByRole('button', { name: '取消精华' }));
    fireEvent.click(screen.getByRole('button', { name: '取消置顶' }));
    expect(setPostFeatured).toHaveBeenLastCalledWith('test', 'secret', false);
    expect(setPostPinned).toHaveBeenLastCalledWith('test', 'secret', false);
    expect(screen.queryByText('精华', { selector: '.creator-post-badge' })).not.toBeInTheDocument();
    expect(screen.queryByText('置顶', { selector: '.creator-post-badge' })).not.toBeInTheDocument();
  });

  it('shows saved post badges to members and keeps management controls private', () => {
    renderFlow(
      state({ getPosts: () => [{ ...post, channelId: 'posts', featured: true, pinned: true }] }),
      '/circles/test/posts/secret',
    );
    expect(screen.getByText('精华', { selector: '.creator-post-badge' })).toBeInTheDocument();
    expect(screen.getByText('置顶', { selector: '.creator-post-badge' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '动态管理' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取消精华' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '写下评论' })).toBeInTheDocument();
    expect(document.getElementById('comments')).toBeInTheDocument();
  });

  it('reports failed management writes without showing a changed state', () => {
    const setPostFeatured = vi.fn(() => {
      throw new Error('保存失败，请重试');
    });
    renderFlow(
      state({
        getCircle: () => ({ ...circle, role: 'owner' }),
        getPosts: () => [{ ...post, channelId: 'posts' }],
        setPostFeatured,
      }),
      '/circles/test/posts/secret',
    );
    fireEvent.click(screen.getByRole('button', { name: '设为精华' }));
    expect(screen.getByRole('alert')).toHaveTextContent('保存失败，请重试');
    expect(screen.getByRole('button', { name: '设为精华' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.queryByText('精华', { selector: '.creator-post-badge' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('simulates voice join, headphones and leave with a usable direct-entry return route', () => {
    renderFlow(state(), '/circles/test/voice/voice');
    fireEvent.click(screen.getByRole('button', { name: '加入语音房间' }));
    expect(screen.getByRole('status')).toHaveTextContent('已加入');
    fireEvent.click(screen.getByRole('button', { name: '关闭耳机' }));
    expect(screen.getByRole('button', { name: '取消静音' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '离开房间' }));
    expect(screen.getByRole('status')).toHaveTextContent('已离开房间');
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.getByRole('heading', { name: '圈子首页' })).toBeInTheDocument();
  });
});
