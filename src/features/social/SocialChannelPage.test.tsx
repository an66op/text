import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ProfileContext } from '@/features/profile/profile-context';
import { ToastProvider } from '@/shared/ui/ToastProvider';
import { SocialProvider } from './SocialProvider';
import SocialHub from './SocialHub';
import SocialChannelPage from './SocialChannelPage';
import {
  createSocialChannel,
  getBroadcastSnapshot,
  publishBroadcast,
  SOCIAL_CHANNELS_KEY,
} from './social-channels-model';

function LocationProbe() {
  const { pathname, search } = useLocation();
  return (
    <output aria-label="当前页面">
      {pathname}
      {search}
    </output>
  );
}
function renderAt(path: string) {
  const hub = <SocialHub onOpenModule={() => {}} profileName="测试用户" />;
  return render(
    <ProfileContext.Provider
      value={{ profile: { name: '测试用户', bio: '' }, setProfile: vi.fn() }}
    >
      <ToastProvider>
        <SocialProvider>
          <MemoryRouter initialEntries={[path]}>
            <LocationProbe />
            <Routes>
              <Route path="/social" element={hub} />
              <Route path="/social/chat/:conversationId" element={hub} />
              <Route path="/social/channels/new" element={<SocialChannelPage kind="create" />} />
              <Route
                path="/social/channels/:channelId"
                element={<SocialChannelPage kind="detail" />}
              />
              <Route
                path="/social/channels/:channelId/info"
                element={<SocialChannelPage kind="info" />}
              />
              <Route
                path="/social/channels/:channelId/posts/:postId/comments"
                element={<SocialChannelPage kind="comments" />}
              />
            </Routes>
          </MemoryRouter>
        </SocialProvider>
      </ToastProvider>
    </ProfileContext.Provider>,
  );
}
describe('social broadcast channels', () => {
  beforeEach(() => localStorage.clear());

  it('filters private chats, groups and broadcast channels using URL state', () => {
    renderAt('/social');
    const overview = screen.getByRole('tablist', { name: '消息分类' }).parentElement!;
    fireEvent.click(screen.getByRole('tab', { name: '私聊' }));
    expect(screen.getByLabelText('当前页面')).toHaveTextContent('/social?type=private');
    expect(within(overview).getByRole('button', { name: /文件传输助手/ })).toBeInTheDocument();
    expect(overview.querySelectorAll('.im-group-count')).toHaveLength(0);
    fireEvent.click(screen.getByRole('tab', { name: '群组' }));
    expect(screen.getByLabelText('当前页面')).toHaveTextContent('/social?type=groups');
    expect(
      within(overview).queryByRole('button', { name: /文件传输助手/ }),
    ).not.toBeInTheDocument();
    expect(overview.querySelectorAll('.im-group-count').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: '频道' }));
    expect(screen.getByLabelText('当前页面')).toHaveTextContent('/social?type=channels');
    expect(within(overview).getByRole('link', { name: /共鸣动态/ })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '聊天消息' })).not.toBeInTheDocument();
  });

  it('opens compact channel rows inside the conversation shell and persists subscriptions', () => {
    const first = renderAt('/social?type=channels');
    expect(screen.getByRole('tab', { name: '频道' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('link', { name: /设计拾光/ }));
    expect(screen.getByRole('link', { name: /设计拾光.*公开频道/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('region', { name: '设计拾光频道时间线' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '订阅频道' }));
    expect(screen.getByRole('button', { name: '关闭通知' })).toBeInTheDocument();
    expect(
      getBroadcastSnapshot().channels.find((item) => item.id === 'design-notes')?.subscriberCount,
    ).toBe(564);
    first.unmount();
    renderAt('/social/channels/design-notes/info');
    expect(screen.getByRole('button', { name: '已订阅 · 取消订阅' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '已订阅 · 取消订阅' }));
    expect(
      getBroadcastSnapshot().channels.find((item) => item.id === 'design-notes')?.subscriberCount,
    ).toBe(563);
  });

  it('keeps subscribed broadcasts read-only and rejects attempts to publish as another creator', () => {
    renderAt('/social/channels/orbit-updates');
    expect(screen.getByRole('heading', { name: '共鸣动态' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '发布广播' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发布广播' })).not.toBeInTheDocument();
    expect(() => publishBroadcast('orbit-updates', '不能冒充发布', '测试用户')).toThrow(
      '只有频道创建者可以发布广播',
    );
    fireEvent.click(screen.getByRole('button', { name: '关闭通知' }));
    expect(screen.getByRole('button', { name: '开启通知' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(getBroadcastSnapshot().channels.find((item) => item.id === 'orbit-updates')?.muted).toBe(
      true,
    );
  });

  it('creates an owned channel, publishes broadcasts and keeps existing chat storage intact', () => {
    const first = renderAt('/social/channels/new');
    const conversationsBefore = localStorage.getItem('social-conversations');
    const messagesBefore = localStorage.getItem('social-messages');
    fireEvent.change(screen.getByRole('textbox', { name: /频道名称/ }), {
      target: { value: '我的创作笔记' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /频道介绍/ }), {
      target: { value: '每周分享一次创作进度' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建频道' }));
    expect(screen.getByRole('heading', { name: '我的创作笔记' })).toBeInTheDocument();
    const channel = getBroadcastSnapshot().channels.find((item) => item.name === '我的创作笔记')!;
    expect(channel.ownerId).toBe('me');
    fireEvent.change(screen.getByRole('textbox', { name: '发布广播' }), {
      target: { value: '第一篇广播，记录新的开始。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发布广播' }));
    expect(
      within(screen.getByRole('log', { name: '频道广播' })).getByText('第一篇广播，记录新的开始。'),
    ).toBeInTheDocument();
    expect(
      getBroadcastSnapshot().channels.find((item) => item.id === channel.id)?.posts[0].authorName,
    ).toBe('我的创作笔记');
    expect(screen.getByRole('textbox', { name: '发布广播' })).toHaveValue('');
    expect(localStorage.getItem('social-conversations')).toBe(conversationsBefore);
    expect(localStorage.getItem('social-messages')).toBe(messagesBefore);
    first.unmount();
    renderAt(`/social/channels/${channel.id}`);
    expect(
      within(screen.getByRole('log', { name: '频道广播' })).getByText('第一篇广播，记录新的开始。'),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '发布广播' })).toBeInTheDocument();
  });

  it('reports persistence failures and preserves the unpublished draft', () => {
    const id = createSocialChannel(
      { name: '我的频道', description: '我的广播', icon: '📣' },
      '测试用户',
    );
    renderAt(`/social/channels/${id}`);
    const before = localStorage.getItem(SOCIAL_CHANNELS_KEY);
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    fireEvent.change(screen.getByRole('textbox', { name: '发布广播' }), {
      target: { value: '失败后保留这条内容' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发布广播' }));
    expect(screen.getByRole('alert')).toHaveTextContent('保存失败');
    expect(screen.getByRole('textbox', { name: '发布广播' })).toHaveValue('失败后保留这条内容');
    expect(localStorage.getItem(SOCIAL_CHANNELS_KEY)).toBe(before);
    expect(getBroadcastSnapshot().channels.find((item) => item.id === id)?.posts).toHaveLength(0);
    write.mockRestore();
  });

  it('shows a return route for unknown channels instead of a chat composer', () => {
    renderAt('/social/channels/missing');
    expect(screen.getByRole('heading', { name: '频道不存在' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '返回频道列表' })[0]).toHaveAttribute(
      'href',
      '/social?type=channels',
    );
    expect(screen.queryByRole('textbox', { name: '发布广播' })).not.toBeInTheDocument();
  });

  it('renders chronological channel messages, dates, photos, views and a pinned banner without personal signatures', () => {
    renderAt('/social/channels/orbit-updates');
    const timeline = screen.getByRole('log', { name: '频道广播' });
    const messages = within(timeline).getAllByRole('article');
    expect(messages.map((message) => message.dataset.messageId)).toEqual([
      'orbit-update-1',
      'orbit-update-2',
    ]);
    expect(timeline.querySelectorAll('.tg-date-separator')).toHaveLength(2);
    expect(within(timeline).getByRole('img', { name: '共鸣动态的图片消息' })).toBeInTheDocument();
    expect(within(timeline).queryByText('共鸣团队')).not.toBeInTheDocument();
    expect(within(messages[0]).getByText('共鸣动态')).toBeInTheDocument();
    expect(within(messages[0]).getByLabelText(/次浏览/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /置顶消息.*本周更新/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '频道' })).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('.tg-channel-open .im-overview')).toBeInTheDocument();
  });

  it('persists emoji reactions while preventing non-subscribers from reacting', () => {
    const first = renderAt('/social/channels/design-notes');
    expect(screen.getByRole('button', { name: '👍表态' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '订阅频道' }));
    fireEvent.click(screen.getByRole('button', { name: '👍表态' }));
    expect(screen.getByRole('button', { name: '👍表态' })).toHaveAttribute('aria-pressed', 'true');
    expect(
      getBroadcastSnapshot().channels.find((item) => item.id === 'design-notes')?.posts[0]
        .reactions?.['👍'],
    ).toBe(1);
    first.unmount();
    renderAt('/social/channels/design-notes');
    expect(screen.getByRole('button', { name: '👍表态' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '👍表态' }));
    expect(screen.getByRole('button', { name: '👍表态' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('opens an independent comment thread and keeps replies out of the broadcast timeline', () => {
    renderAt('/social/channels/orbit-updates');
    const postCount = getBroadcastSnapshot().channels.find((item) => item.id === 'orbit-updates')!
      .posts.length;
    fireEvent.click(screen.getByRole('link', { name: /1 条评论/ }));
    expect(screen.getByLabelText('当前页面')).toHaveTextContent(
      '/social/channels/orbit-updates/posts/orbit-update-2/comments',
    );
    expect(screen.getByText('消息分类很清楚，期待后续更新。')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '频道评论' }), {
      target: { value: '这是一条线程里的评论' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送评论' }));
    expect(screen.getByText('这是一条线程里的评论')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '频道评论' })).toHaveValue('');
    const channel = getBroadcastSnapshot().channels.find((item) => item.id === 'orbit-updates')!;
    expect(channel.posts).toHaveLength(postCount);
    expect(channel.posts.find((post) => post.id === 'orbit-update-2')?.comments?.at(-1)?.text).toBe(
      '这是一条线程里的评论',
    );
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.getByRole('log', { name: '频道广播' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('log', { name: '频道广播' })).queryByText('这是一条线程里的评论'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /2 条评论/ })).toBeInTheDocument();
  });

  it('lets the channel creator pin and unpin a published message', () => {
    const id = createSocialChannel(
      { name: '创作者频道', description: '频道消息', icon: '📣' },
      '测试用户',
    );
    publishBroadcast(id, '需要置顶的消息', '测试用户');
    renderAt(`/social/channels/${id}`);
    fireEvent.click(screen.getByRole('button', { name: '置顶消息' }));
    expect(screen.getByRole('button', { name: /置顶消息.*需要置顶的消息/ })).toBeInTheDocument();
    expect(
      getBroadcastSnapshot().channels.find((item) => item.id === id)?.pinnedPostId,
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消置顶消息' }));
    expect(getBroadcastSnapshot().channels.find((item) => item.id === id)?.pinnedPostId).toBeNull();
    expect(
      screen.queryByRole('button', { name: /置顶消息.*需要置顶的消息/ }),
    ).not.toBeInTheDocument();
  });

  it('keeps a failed comment draft and renders a safe fallback for broken channel media', () => {
    const imageView = renderAt('/social/channels/design-notes');
    fireEvent.error(screen.getByRole('img', { name: '设计拾光的图片消息' }));
    expect(screen.getByText('图片暂时无法显示')).toBeInTheDocument();
    imageView.unmount();
    renderAt('/social/channels/orbit-updates/posts/orbit-update-2/comments');
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    fireEvent.change(screen.getByRole('textbox', { name: '频道评论' }), {
      target: { value: '需要保留的评论' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送评论' }));
    expect(screen.getByRole('alert')).toHaveTextContent('保存失败');
    expect(screen.getByRole('textbox', { name: '频道评论' })).toHaveValue('需要保留的评论');
    expect(
      screen.queryByText('需要保留的评论', { selector: '.tg-thread-comment p' }),
    ).not.toBeInTheDocument();
    write.mockRestore();
  });
});
