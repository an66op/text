import type { ReactNode } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ProfileProvider } from '@/features/profile/profile-store';
import { ToastProvider } from '@/shared/ui/ToastProvider';
import { ContentProvider } from './ContentProvider';
import ContentRoutePage from './ContentRoutePage';
import { useContent } from './useContent';
import { initialPosts, pictures } from './fixtures';

beforeEach(() => localStorage.clear());
const organization = { title: '山海来信', desc: '新组织', img: pictures.forest, badge: '测试组织' };
function Provider({ children }: { children: ReactNode }) {
  return <ContentProvider>{children}</ContentProvider>;
}
function page(entry: string, pattern: string, kind: 'profile' | 'post-actions') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <ProfileProvider>
          <ContentProvider>
            <Routes>
              <Route path={pattern} element={<ContentRoutePage kind={kind} />} />
            </Routes>
          </ContentProvider>
        </ProfileProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}
describe('content identity is independent from display names', () => {
  it('migrates legacy title memberships and keeps same-name book/organization changes isolated', () => {
    localStorage.setItem('joined', JSON.stringify(['山海来信', '周末去野']));
    const { result } = renderHook(useContent, { wrapper: Provider });
    expect(result.current.bookshelf).toEqual(['book-sea-letters']);
    expect(result.current.memberships).toEqual(['organization-outdoors']);
    let id = '';
    act(() => {
      id = result.current.createCommunity(organization);
    });
    act(() => {
      result.current.updateCommunity(id, { title: '改名组织' });
    });
    expect(result.current.bookshelf).toEqual(['book-sea-letters']);
    expect(result.current.memberships).toContain(id);
    act(() => {
      result.current.deleteCommunity(id);
    });
    expect(result.current.bookshelf).toEqual(['book-sea-letters']);
    expect(result.current.memberships).toEqual(['organization-outdoors']);
    expect(JSON.parse(localStorage.getItem('joined') ?? '[]')).toEqual(['山海来信', '周末去野']);
  });
  it('allows independently joined organizations with identical titles', () => {
    const { result } = renderHook(useContent, { wrapper: Provider });
    let first = '';
    let second = '';
    act(() => {
      first = result.current.createCommunity(organization);
      second = result.current.createCommunity(organization);
    });
    expect(first).not.toBe(second);
    act(() => {
      result.current.toggleMembership(first);
    });
    expect(result.current.memberships).not.toContain(first);
    expect(result.current.memberships).toContain(second);
    act(() => {
      result.current.deleteCommunity(first);
    });
    expect(result.current.communities.map((item) => item.id)).toEqual([second]);
    expect(result.current.memberships).toContain(second);
  });
  it('does not reacquire an explicitly removed migrated book after remount', () => {
    localStorage.setItem('joined', JSON.stringify(['山海来信']));
    const mounted = renderHook(useContent, { wrapper: Provider });
    act(() => mounted.result.current.toggleShelf('book-sea-letters'));
    mounted.unmount();
    const restored = renderHook(useContent, { wrapper: Provider });
    expect(restored.result.current.bookshelf).toEqual([]);
  });
  it('does not grant fixture post management when the user adopts the same nickname', () => {
    localStorage.setItem('profile', JSON.stringify({ name: 'Mia', bio: '我的简介' }));
    page('/world/posts/3/actions', '/world/posts/:postId/actions', 'post-actions');
    expect(screen.queryByRole('button', { name: '删除动态' })).not.toBeInTheDocument();
  });
  it('separates the self profile from another author with the same nickname', () => {
    localStorage.setItem('profile', JSON.stringify({ name: 'Mia', bio: '我的简介' }));
    localStorage.setItem(
      'posts',
      JSON.stringify([
        ...initialPosts,
        { ...initialPosts[0], id: 9001, name: 'Mia', owner: true, text: '自己的唯一动态' },
      ]),
    );
    const self = page('/people/me', '/people/:author', 'profile');
    expect(screen.getByText('自己的唯一动态')).toBeInTheDocument();
    expect(screen.queryByText(initialPosts[2].text)).not.toBeInTheDocument();
    self.unmount();
    page('/people/Mia', '/people/:author', 'profile');
    expect(screen.getByText(initialPosts[2].text)).toBeInTheDocument();
    expect(screen.queryByText('自己的唯一动态')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '+ 关注' }).length).toBeGreaterThan(0);
  });
  it('migrates legacy publications using their old publisher metadata, not the current nickname', () => {
    localStorage.setItem('profile', JSON.stringify({ name: 'Mia', bio: '' }));
    localStorage.setItem(
      'posts',
      JSON.stringify([
        ...initialPosts,
        { ...initialPosts[0], id: 9002, name: '旧昵称', tag: '社交 · 刚刚' },
      ]),
    );
    const { result } = renderHook(useContent, { wrapper: Provider });
    expect(result.current.posts.find((post) => post.id === 9002)?.owner).toBe(true);
    expect(result.current.posts.find((post) => post.id === 3)?.owner).toBeUndefined();
  });
});
