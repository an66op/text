import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, matchRoutes, RouterProvider } from 'react-router';
import { ContentProvider } from '@/features/content/ContentProvider';
import { ProfileProvider } from '@/features/profile/profile-store';
import { SocialProvider } from '@/features/social/SocialProvider';
import { paths } from '@/shared/config/paths';
import { ToastProvider } from '@/shared/ui/ToastProvider';
import { appRoutes } from './router';
import { CircleProvider } from '@/features/circles/CircleProvider';
import { circlePaths } from '@/features/circles/routes';

const memoryRouters: ReturnType<typeof createMemoryRouter>[] = [];

function renderRoute(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  memoryRouters.push(router);
  render(
    <ToastProvider>
      <ProfileProvider>
        <ContentProvider>
          <CircleProvider>
            <SocialProvider>
              <RouterProvider router={router} />
            </SocialProvider>
          </CircleProvider>
        </ContentProvider>
      </ProfileProvider>
    </ToastProvider>,
  );
  return router;
}

describe('real application routes', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });
  afterEach(() => {
    for (const router of memoryRouters.splice(0)) router.dispose();
    vi.restoreAllMocks();
  });

  it('redirects the entry address to the social conversation list', async () => {
    const router = renderRoute('/');

    await waitFor(() => expect(router.state.location.pathname).toBe('/social'));
    expect(await screen.findByRole('textbox', { name: '搜索会话' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '全部标为已读' })).not.toBeInTheDocument();
  });

  it('opens World from Discovery and returns with history navigation', async () => {
    const router = renderRoute('/discover');
    const worldLink = await screen.findByRole('link', { name: /^世界/ });
    expect(worldLink).toHaveAttribute('href', '/world');
    fireEvent.click(worldLink);

    await waitFor(() => expect(router.state.location.pathname).toBe('/world'));
    expect(await screen.findByRole('textbox', { name: '搜索世界帖子' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '世界', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '本机内容' })).toHaveAttribute('href', '/world/demo');

    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/discover');
    expect(await screen.findByRole('link', { name: /^世界/ })).toBeInTheDocument();
  });

  it('renders the profile editor directly from its URL', async () => {
    localStorage.setItem('profile', JSON.stringify({ name: '直达编辑', bio: '保存的简介' }));
    const router = renderRoute('/me/edit');

    expect(await screen.findByLabelText('昵称')).toHaveValue('直达编辑');
    expect(screen.getByLabelText('个人简介')).toHaveValue('保存的简介');
    expect(router.state.location.pathname).toBe('/me/edit');
    expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument();
  });

  it('renders a recovery link for unknown URLs', async () => {
    renderRoute('/an-obsolete-page');

    expect(await screen.findByRole('heading', { name: '页面不存在' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回社交' })).toHaveAttribute('href', '/social');
  });

  it('keeps only wallet and settings in the current profile services', async () => {
    renderRoute('/me');
    const services = await screen.findByRole('navigation', { name: '个人服务' });
    expect(services.querySelectorAll('a')).toHaveLength(2);
    expect(within(services).getByRole('link', { name: /^钱包/ })).toHaveAttribute(
      'href',
      '/wallet',
    );
    expect(within(services).getByRole('link', { name: /^设置/ })).toHaveAttribute(
      'href',
      '/settings',
    );
    expect(within(services).queryByRole('link', { name: /^圈子/ })).not.toBeInTheDocument();
    expect(within(services).queryByRole('link', { name: /^书架/ })).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.queryByText('收藏', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('128', { exact: true })).not.toBeInTheDocument();
  });

  it('places circles and matching before shorts in Discovery and opens circles under Discovery', async () => {
    const router = renderRoute(paths.discover);
    const more = await screen.findByRole('region', { name: '更多发现' });
    expect(
      within(more)
        .getAllByRole('link')
        .map((link) => link.getAttribute('aria-label')),
    ).toEqual(['圈子', '匹配', '短视频', '小说', '游戏', '商城']);
    fireEvent.click(within(more).getByRole('link', { name: '圈子' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(paths.circles));
    expect(await screen.findByRole('link', { name: '返回发现' })).toHaveAttribute(
      'href',
      paths.discover,
    );
    expect(router.state.matches.at(-1)?.route.handle.section).toBe('discover');
  });

  it('opens the bookshelf inside novels while preserving its existing direct URL', async () => {
    const router = renderRoute(paths.library);
    fireEvent.click(await screen.findByRole('link', { name: '打开书架' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(paths.bookshelf));
    await waitFor(() => expect(document.title).toBe('书架 · 共鸣'));
    expect(router.state.matches.at(-1)?.route.handle.section).toBe('discover');
    expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument();
  });

  it('opens AI from the five-item navigation and gives each conversation a secondary URL', async () => {
    const router = renderRoute(paths.discover);
    const nav = await screen.findByRole('navigation', { name: '主导航' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/social', '/contacts', '/discover', '/ai', '/me']);
    fireEvent.click(within(nav).getByRole('link', { name: 'AI' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(paths.ai));
    expect(await screen.findByRole('heading', { name: 'AI', level: 1 })).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: '主导航' })).getByRole('link', { name: 'AI' }),
    ).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: '新建会话' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/ai\/chat\/[^/]+$/));
    expect(await screen.findByRole('textbox', { name: 'AI消息' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument();
  });

  it('opens the shop from Discovery and reaches its independent cart page', async () => {
    const router = renderRoute(paths.discover);
    fireEvent.click(await screen.findByRole('link', { name: '商城' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(paths.shop));
    const nav = await screen.findByRole('navigation', { name: '商城导航' });
    fireEvent.click(within(nav).getByRole('link', { name: /^购物/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe(paths.shopCart));
    expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument();
    expect(router.state.matches.at(-1)?.route.handle.section).toBe('discover');
  });

  it('redirects the old personal novel filter to the actual bookshelf', async () => {
    const router = renderRoute(`${paths.library}?tab=${encodeURIComponent('我的')}`);
    await waitFor(() => expect(router.state.location.pathname).toBe(paths.bookshelf));
    expect(await screen.findByRole('link', { name: '找书' })).toHaveAttribute(
      'href',
      paths.library,
    );
  });

  it('matches dynamic detail URLs and decodes conversation identifiers', () => {
    const id = '群聊 / # ?';
    const chat = matchRoutes(appRoutes, paths.chat(id));
    expect(chat?.at(-1)?.route.path).toBe('/social/chat/:conversationId');
    expect(chat?.at(-1)?.params.conversationId).toBe(id);

    for (const path of [
      paths.post(123),
      paths.watch('live-1'),
      paths.read('novel-1'),
      paths.game('game-1'),
      paths.community('organization-1'),
    ]) {
      expect(matchRoutes(appRoutes, path)?.at(-1)?.route.path).not.toBe('*');
    }
  });

  it('keeps wallet authentication and credential management on secondary account routes', () => {
    for (const path of [paths.walletLogin, paths.walletBindings]) {
      const route = matchRoutes(appRoutes, path)?.at(-1)?.route;
      expect(route?.path).toBe(path);
      expect(route?.handle).toMatchObject({ section: 'me', level: 'secondary' });
    }
    expect(paths.walletLogin).toBe('/login/wallet');
    expect(paths.walletBindings).toBe('/account/wallets');
  });

  it('keeps online circles distinct from the local directory and old deep links', () => {
    const route = (url: string) => matchRoutes(appRoutes, url)?.at(-1)?.route.path;
    expect(route('/circles')).toBe('/circles');
    expect(route('/circles/new')).toBe('/circles/new');
    expect(route('/circles/demo')).toBe('/circles/demo');
    expect(route('/circles/demo/new')).toBe('/circles/demo/new');
    expect(route('/circles/s/circle_123/members')).toBe('/circles/s/:circleId/members');
    expect(route('/circles/s/circle_123/channels/cchannel_123')).toBe(
      '/circles/s/:circleId/channels/:channelId',
    );
    expect(route('/circles/organization-photography')).toBeUndefined();
    expect(matchRoutes(appRoutes, '/circles/organization-photography')?.at(-1)?.route.index).toBe(
      true,
    );
  });

  it('places the notification inbox on its own secondary social route', () => {
    const matched = matchRoutes(appRoutes, paths.notifications)?.at(-1)?.route;
    expect(matched?.path).toBe('/notifications');
    expect(matched?.handle).toMatchObject({ title: '通知', section: 'social', level: 'secondary' });
  });

  it('routes real circle events and management independently of local activity demos', () => {
    for (const suffix of ['', '/new', '/cevent_123', '/cevent_123/edit', '/cevent_123/attendees']) {
      const matched = matchRoutes(appRoutes, `/circles/s/circle_123/events${suffix}`)?.at(
        -1,
      )?.route;
      expect(matched?.path).toMatch(/^\/circles\/s\/:circleId\/events/);
      expect(matched?.handle).toMatchObject({ section: 'discover', level: 'secondary' });
    }
    expect(matchRoutes(appRoutes, '/circles/s/circle_123/events/new')?.at(-1)?.route.path).toBe(
      '/circles/s/:circleId/events/new',
    );
  });

  it('reserves the bottom navigation for the five primary pages', () => {
    const children = appRoutes[0].children ?? [];
    const primaryRoutes = children.filter((route) => route.handle?.level === 'primary');
    expect(primaryRoutes.map((route) => route.path).sort()).toEqual(
      ['/social', '/contacts', '/discover', '/ai', '/me'].sort(),
    );
    for (const route of children) {
      if (route.index || route.path === '/moments') continue;
      expect(route.handle.level, route.path).toBe(
        ['/social', '/contacts', '/discover', '/ai', '/me'].includes(route.path ?? '')
          ? 'primary'
          : 'secondary',
      );
    }
  });

  it('keeps the old activity address usable and names the page 动态', async () => {
    const router = renderRoute('/moments');
    await waitFor(() => expect(router.state.location.pathname).toBe('/activity'));
    await waitFor(() => expect(document.title).toBe('动态 · 共鸣'));
    expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument();
    expect(screen.queryByText('朋友圈', { exact: true })).not.toBeInTheDocument();
  });

  it('keeps existing organization links usable as circle addresses', async () => {
    const router = renderRoute('/organizations/organization-photography');
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(circlePaths.home('organization-photography')),
    );
    expect(
      await screen.findByRole('heading', { name: '街头摄影散步', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '群聊' })).toHaveAttribute(
      'href',
      circlePaths.channel('organization-photography', 'general'),
    );
  });

  it('filters circle content by featured, creator and album while retaining URL selection', async () => {
    const router = renderRoute(circlePaths.home('organization-photography'));
    const feed = await screen.findByRole('region', { name: '圈内动态' });
    expect(within(feed).getByRole('heading', { name: '街角新发现的一家小店' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('tab', { name: '全部' }), { key: 'ArrowRight' });
    expect(router.state.location.search).toBe('?view=featured');
    expect(
      within(feed).getByRole('heading', { name: '今天的蓝调时刻，分享给你' }),
    ).toBeInTheDocument();
    expect(
      within(feed).queryByRole('heading', { name: '街角新发现的一家小店' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '圈主' }));
    expect(within(feed).getAllByRole('article')).toHaveLength(3);
    fireEvent.click(screen.getByRole('tab', { name: '相册' }));
    expect(within(feed).getAllByRole('img')).toHaveLength(2);
    fireEvent.click(within(feed).getByRole('link', { name: '今天的蓝调时刻，分享给你' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        circlePaths.post('organization-photography', 'blue-hour'),
      ),
    );
    await act(() => router.navigate(-1));
    expect(await screen.findByRole('tab', { name: '相册' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('persists likes from the circle feed and orders popular posts using real counts', async () => {
    const router = renderRoute(circlePaths.home('organization-photography'));
    const like = await screen.findByRole('button', { name: '点赞：今天的蓝调时刻，分享给你' });
    fireEvent.click(like);
    expect(
      screen.getByRole('button', { name: '取消点赞：今天的蓝调时刻，分享给你' }),
    ).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByRole('combobox', { name: '动态排序' }), {
      target: { value: 'popular' },
    });
    const feed = screen.getByRole('region', { name: '圈内动态' });
    expect(within(feed).getAllByRole('article')[0]).toHaveTextContent('欢迎来到圈子');
    await act(() => router.navigate('/contacts'));
    await act(() => router.navigate(circlePaths.home('organization-photography')));
    expect(
      await screen.findByRole('button', { name: '取消点赞：今天的蓝调时刻，分享给你' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps guest circle content private and shows a usable join route', async () => {
    renderRoute(circlePaths.home('organization-coffee'));
    expect(
      await screen.findByRole('heading', { name: '好内容，留给圈内的你' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: '今天的蓝调时刻，分享给你' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '发布动态' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '加入圈子' })).toHaveAttribute(
      'href',
      circlePaths.join('organization-coffee'),
    );
  });

  it('opens a deep circle channel as a secondary page and persists its message', async () => {
    renderRoute(circlePaths.channel('organization-photography', 'general'));
    const input = await screen.findByLabelText(/发送到/);
    fireEvent.change(input, { target: { value: '圈子频道集成验收' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    expect(await screen.findByText('圈子频道集成验收')).toBeInTheDocument();
    expect(localStorage.getItem('circles-state-v1')).toContain('圈子频道集成验收');
    expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument();
  });

  it('recovers an invalid circle channel without crashing the application', async () => {
    renderRoute(circlePaths.channel('organization-photography', 'not-a-channel'));
    expect(await screen.findByRole('heading', { name: '频道不存在' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回圈子首页' })).toHaveAttribute(
      'href',
      circlePaths.home('organization-photography'),
    );
  });
});
