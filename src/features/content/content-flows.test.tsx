import type { ReactElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ProfileProvider } from '@/features/profile/profile-store';
import { ToastProvider } from '@/shared/ui/ToastProvider';
import { defaultSettings, SETTINGS_KEY } from '@/features/profile/settings-model';
import { ContentProvider } from './ContentProvider';
import ContentRoutePage from './ContentRoutePage';
import ContentDetailPage from './ContentDetailPage';
import { initialPosts } from './fixtures';
import type { ContentRouteKind } from './types';
import { useContent } from './useContent';

beforeEach(() => {
  localStorage.clear();
  window.scrollTo = vi.fn();
});
function Destination() {
  const location = useLocation();
  const { posts } = useContent();
  return (
    <>
      <div data-testid="destination">{location.pathname}</div>
      <div data-testid="new-post">{posts[0].text}</div>
    </>
  );
}
function renderPage(entry: string, pattern: string, element: ReactElement) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <ProfileProvider>
          <ContentProvider>
            <Routes>
              <Route path={pattern} element={element} />
              <Route path="*" element={<Destination />} />
            </Routes>
          </ContentProvider>
        </ProfileProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}
const routeCases: [ContentRouteKind, string, string, string][] = [
  ['compose', '/publish', '/publish', '发布动态'],
  ['cover', '/activity/cover', '/activity/cover', '动态封面'],
  ['profile', '/people/Mia', '/people/:author', '个人主页'],
  ['post-actions', '/world/posts/1/actions', '/world/posts/:postId/actions', '动态管理'],
  ['short-comments', '/shorts/100/comments', '/shorts/:contentId/comments', '评论 · 2'],
  ['book', '/books/book-sea-letters', '/books/:contentId', '书籍详情'],
  ['chapters', '/books/book-sea-letters/chapters', '/books/:contentId/chapters', '章节目录'],
  ['bookshelf', '/bookshelf', '/bookshelf', '书架'],
  ['reading-settings', '/read/book-sea-letters/settings', '/read/:contentId/settings', '阅读设置'],
  ['game-results', '/games/game-brain/results', '/games/:contentId/results', '挑战成绩'],
  ['community-create', '/organizations/new', '/organizations/new', '创建组织'],
  [
    'community-manage',
    '/organizations/organization-outdoors/manage',
    '/organizations/:contentId/manage',
    '组织管理',
  ],
  [
    'community-members',
    '/organizations/organization-outdoors/members',
    '/organizations/:contentId/members',
    '组织成员',
  ],
  [
    'community-event',
    '/organizations/organization-outdoors/events/weekend',
    '/organizations/:contentId/events/:eventId',
    '活动详情',
  ],
  ['topics', '/world/topics', '/world/topics', '世界话题'],
];
describe('content flows are independent pages', () => {
  it.each(routeCases)(
    '%s renders a direct page without a business dialog',
    (kind, entry, pattern, title) => {
      renderPage(entry, pattern, <ContentRoutePage kind={kind} />);
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '返回' })).toBeInTheDocument();
    },
  );
  it.each([
    'book',
    'chapters',
    'reading-settings',
    'game-results',
    'community-members',
    'community-event',
  ] as const)('%s shows a real missing-ID state', (kind) => {
    renderPage('/content/missing', '/content/:contentId', <ContentRoutePage kind={kind} />);
    expect(screen.getAllByText(/不存在|暂时无法查看|已解散/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link')).toBeInTheDocument();
  });
});
describe('publishing and dynamic management', () => {
  it('publishes into the selected world feed and clears the persisted draft before leaving', () => {
    renderPage('/publish', '/publish', <ContentRoutePage kind="compose" />);
    fireEvent.change(screen.getByLabelText('动态内容'), { target: { value: '今天的测试动态' } });
    expect(JSON.parse(localStorage.getItem('content-publish-draft') ?? 'null')).toBe(
      '今天的测试动态',
    );
    fireEvent.change(screen.getByLabelText('发布板块'), { target: { value: 'world' } });
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    expect(screen.getByTestId('destination')).toHaveTextContent('/world');
    expect(screen.getByTestId('new-post')).toHaveTextContent('今天的测试动态');
    const post = JSON.parse(localStorage.getItem('posts') ?? '[]')[0];
    expect(post).toMatchObject({ target: 'world', owner: true, audience: 'public' });
    expect(JSON.parse(localStorage.getItem('content-publish-draft') ?? 'null')).toBe('');
  });
  it.each([
    ['仅好友', 'friends'],
    ['仅自己', 'self'],
    ['公开', 'public'],
  ] as const)('applies %s privacy as the publish default', (visibility, expected) => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...defaultSettings, privacy: { ...defaultSettings.privacy, visibility } }),
    );
    renderPage('/publish', '/publish', <ContentRoutePage kind="compose" />);
    expect(screen.getByLabelText('动态可见范围')).toHaveValue(expected);
  });
  it('does not carry friend-only visibility into the public world', () => {
    renderPage('/publish?target=world', '/publish', <ContentRoutePage kind="compose" />);
    expect(screen.getByLabelText('动态可见范围')).toHaveValue('public');
  });
  it('deletes an own post and its related local interactions through a page confirmation', () => {
    localStorage.setItem(
      'posts',
      JSON.stringify([
        { ...initialPosts[0], id: 999, owner: true, name: '橘子汽水' },
        initialPosts[1],
      ]),
    );
    localStorage.setItem('comments', JSON.stringify({ '999': ['自己的评论'] }));
    localStorage.setItem('likes', JSON.stringify([999]));
    renderPage(
      '/world/posts/999/actions',
      '/world/posts/:postId/actions',
      <ContentRoutePage kind="post-actions" />,
    );
    fireEvent.click(screen.getByRole('button', { name: '删除动态' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(
      JSON.parse(localStorage.getItem('posts') ?? '[]').some(
        (post: { id: number }) => post.id === 999,
      ),
    ).toBe(false);
    expect(JSON.parse(localStorage.getItem('comments') ?? '{}')).toEqual({});
    expect(JSON.parse(localStorage.getItem('likes') ?? '[]')).toEqual([]);
    expect(screen.getByTestId('destination')).toHaveTextContent('/activity');
  });
  it('persists a reply on the comment thread', () => {
    renderPage('/world/posts/1', '/world/posts/:postId', <ContentDetailPage kind="post" />);
    fireEvent.click(screen.getAllByRole('button', { name: '回复' })[0]);
    fireEvent.change(screen.getByLabelText('评论内容'), { target: { value: '一起出发吧' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(JSON.parse(localStorage.getItem('content-replies') ?? '{}')['1'][0]).toMatchObject({
      parent: 'seed-mia',
      text: '一起出发吧',
      author: '橘子汽水',
    });
    expect(screen.getByText(/回复 Mia：一起出发吧/)).toBeInTheDocument();
  });
});
describe('reply targets stay valid while comments are deleted', () => {
  it.each(['post', 'short'] as const)(
    '%s clears a draft reply target and preserves an existing reply when an earlier comment is removed',
    (kind) => {
      const id = kind === 'post' ? 1 : 100;
      localStorage.setItem('comments', JSON.stringify({ [id]: ['第一条自评', '第二条自评'] }));
      localStorage.setItem(
        'content-replies',
        JSON.stringify({
          [id]: [
            {
              id: 'reply-one',
              parent: 'own-1',
              text: '给第二条的回复',
              author: '橘子汽水',
              createdAt: 1,
            },
          ],
        }),
      );
      if (kind === 'post')
        renderPage('/world/posts/1', '/world/posts/:postId', <ContentDetailPage kind="post" />);
      else
        renderPage(
          '/shorts/100/comments',
          '/shorts/:contentId/comments',
          <ContentRoutePage kind="short-comments" />,
        );
      fireEvent.click(screen.getAllByRole('button', { name: '回复' })[3]);
      fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
      expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();
      expect(JSON.parse(localStorage.getItem('content-replies') ?? '{}')[id][0].parent).toBe(
        'own-0',
      );
      expect(screen.getByText(/给第二条的回复/)).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText(kind === 'post' ? '评论内容' : '短视频评论内容'), {
        target: { value: '删除后仍然能发送的评论' },
      });
      fireEvent.click(screen.getByRole('button', { name: '发送' }));
      expect(JSON.parse(localStorage.getItem('comments') ?? '{}')[id]).toEqual([
        '第二条自评',
        '删除后仍然能发送的评论',
      ]);
    },
  );
});
describe('reading, games and organization persistence', () => {
  it('stores independent reading progress for each book and keeps its directory reachable', () => {
    const first = renderPage(
      '/read/book-sea-letters?chapter=4',
      '/read/:contentId',
      <ContentDetailPage kind="read" />,
    );
    expect(
      JSON.parse(localStorage.getItem('content-reading') ?? '{}')['book-sea-letters'].chapter,
    ).toBe(4);
    fireEvent.click(screen.getByRole('button', { name: '下一章' }));
    expect(
      JSON.parse(localStorage.getItem('content-reading') ?? '{}')['book-sea-letters'].chapter,
    ).toBe(5);
    expect(screen.getByRole('link', { name: '目录' })).toHaveAttribute(
      'href',
      '/books/book-sea-letters/chapters',
    );
    first.unmount();
    renderPage('/read/book-time-traveler', '/read/:contentId', <ContentDetailPage kind="read" />);
    const progress = JSON.parse(localStorage.getItem('content-reading') ?? '{}');
    expect(progress['book-time-traveler'].chapter).toBe(1);
    expect(progress['book-sea-letters'].chapter).toBe(5);
  });
  it('completes memory matching, saves a score and navigates to results', () => {
    renderPage('/games/game-forest', '/games/:contentId', <ContentDetailPage kind="game" />);
    fireEvent.click(screen.getByRole('button', { name: '开始挑战' }));
    for (const pair of [
      [1, 6],
      [2, 8],
      [3, 5],
      [4, 7],
    ])
      for (const position of pair)
        fireEvent.click(screen.getByRole('button', { name: `翻开卡片 ${position}` }));
    fireEvent.click(screen.getByRole('button', { name: '保存成绩' }));
    expect(screen.getByTestId('destination')).toHaveTextContent('/games/game-forest/results');
    expect(JSON.parse(localStorage.getItem('content-game-results') ?? '[]')[0]).toMatchObject({
      gameId: 'game-forest',
      score: 100,
      total: 100,
    });
  });
  it('creates a manageable organization and stores the creator membership', () => {
    renderPage(
      '/organizations/new',
      '/organizations/new',
      <ContentRoutePage kind="community-create" />,
    );
    fireEvent.change(screen.getByLabelText('组织名称'), { target: { value: '山海测试小队' } });
    fireEvent.change(screen.getByLabelText('组织介绍'), {
      target: { value: '杭州 · 周末一起散步' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建组织' }));
    const item = JSON.parse(localStorage.getItem('content-communities') ?? '[]')[0];
    expect(item).toMatchObject({ title: '山海测试小队', owner: true, module: '组织' });
    expect(JSON.parse(localStorage.getItem('content-community-ids') ?? '[]')).toContain(item.id);
    expect(screen.getByTestId('destination')).toHaveTextContent(`/organizations/${item.id}`);
  });
  it('stores event registration and allows cancellation', () => {
    localStorage.setItem('joined', JSON.stringify(['周末去野']));
    renderPage(
      '/organizations/organization-outdoors/events/weekend',
      '/organizations/:contentId/events/:eventId',
      <ContentRoutePage kind="community-event" />,
    );
    fireEvent.click(screen.getByRole('button', { name: '报名参加' }));
    expect(JSON.parse(localStorage.getItem('content-attendance') ?? '[]')).toEqual([
      'organization-outdoors:weekend',
    ]);
    fireEvent.click(screen.getByRole('button', { name: '取消报名' }));
    expect(JSON.parse(localStorage.getItem('content-attendance') ?? '[]')).toEqual([]);
  });
});
