import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/features/platform/auth-context';
import { member, otherMember, signedIn } from '@/features/platform/platform-test-fixtures';
import { PlatformAvatar } from '@/features/platform/PlatformUi';
import { ProfileProvider } from '@/features/profile/profile-store';
import ProfilePage from '@/features/profile/ProfilePage';
import type { PublicUser } from '@/shared/api/types';
import ContactsPage from './ContactsPage';
import UserProfilePage from './UserProfilePage';
import { peopleApi } from './people-api';
import { friendshipApi } from './friendship-api';
import { privacyApi } from '@/features/platform/privacy/privacy-api';
import type { Conversation } from '@/shared/api/types';

function Destination() {
  const location = useLocation();
  return (
    <output>
      {location.pathname}
      {location.search}
    </output>
  );
}
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(peopleApi, 'directory').mockResolvedValue({ items: [otherMember], total: 1 });
  vi.spyOn(peopleApi, 'user').mockResolvedValue(otherMember);
  vi.spyOn(peopleApi, 'posts').mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(friendshipApi, 'friends').mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(friendshipApi, 'requests').mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(friendshipApi, 'relationship').mockResolvedValue({ status: 'none' });
  vi.spyOn(privacyApi, 'blocks').mockResolvedValue({
    items: [],
    total: 0,
    revision: 0,
    updatedAt: null,
  });
  vi.spyOn(privacyApi, 'capabilities').mockImplementation(async (userId) => ({
    userId,
    blockedByMe: false,
    canMessage: true,
    canRequestFriend: true,
    canInvite: true,
    revision: 0,
  }));
});
afterEach(() => vi.restoreAllMocks());
describe('real member directory and identities', () => {
  it('shows server member profiles and links local contacts separately', async () => {
    render(
      <MemoryRouter initialEntries={['/contacts?tab=discover']}>
        <AuthContext.Provider value={signedIn()}>
          <ContactsPage />
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    expect(await screen.findByText(otherMember.name)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /另一位成员/ })).toHaveAttribute('href', '/u/other');
    expect(screen.getByRole('link', { name: /本机通讯录/ })).toHaveAttribute(
      'href',
      '/contacts/demo',
    );
    expect(screen.queryByText(otherMember.email)).not.toBeInTheDocument();
  });
  it('ignores a late directory result after switching accounts', async () => {
    let finish!: (value: { items: PublicUser[]; total: number }) => void;
    vi.mocked(peopleApi.directory)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({ items: [{ ...otherMember, name: '新账号目录' }], total: 1 });
    const layout = (who: typeof member) => (
      <MemoryRouter initialEntries={['/contacts?tab=discover']}>
        <AuthContext.Provider value={signedIn(who)}>
          <ContactsPage />
        </AuthContext.Provider>
      </MemoryRouter>
    );
    const rendered = render(layout(member));
    await waitFor(() => expect(peopleApi.directory).toHaveBeenCalledOnce());
    rendered.rerender(layout(otherMember));
    await screen.findByText('新账号目录');
    await act(async () => finish({ items: [{ ...member, name: '旧账号目录' }], total: 1 }));
    expect(screen.queryByText('旧账号目录')).not.toBeInTheDocument();
  });
  it('starts a real direct conversation and navigates to the primary social chat', async () => {
    const start = vi.spyOn(peopleApi, 'startChat').mockResolvedValue({
      id: 'directory-chat',
      title: '私聊',
      kind: 'direct',
      members: [member.id, otherMember.id],
      ownerId: member.id,
      createdAt: new Date().toISOString(),
    });
    render(
      <AuthContext.Provider value={signedIn()}>
        <MemoryRouter initialEntries={['/u/other']}>
          <Routes>
            <Route path="/u/:handle" element={<UserProfilePage />} />
            <Route path="/social" element={<Destination />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    await screen.findByRole('heading', { name: otherMember.name });
    await waitFor(() => expect(screen.getByRole('button', { name: '发消息' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '发消息' }));
    expect(await screen.findByText('/social?conversation=directory-chat')).toBeInTheDocument();
    expect(start).toHaveBeenCalledWith(otherMember);
  });
  it('shows authenticated identity without overwriting the old local profile', async () => {
    localStorage.setItem('profile', JSON.stringify({ name: '本机名字', bio: '本机简介' }));
    render(
      <MemoryRouter>
        <AuthContext.Provider value={signedIn()}>
          <ProfileProvider>
            <ProfilePage />
          </ProfileProvider>
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: member.name })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /编辑资料/ })).toHaveAttribute('href', '/account');
    expect(localStorage.getItem('profile')).toContain('本机名字');
  });
  it('keeps private block management and history navigation available when new direct contact is restricted', async () => {
    vi.mocked(privacyApi.capabilities).mockResolvedValue({
      userId: otherMember.id,
      blockedByMe: false,
      canMessage: false,
      canInvite: false,
      canRequestFriend: false,
      revision: 2,
    });
    const start = vi.spyOn(peopleApi, 'startChat');
    render(
      <MemoryRouter initialEntries={['/u/other']}>
        <AuthContext.Provider value={signedIn()}>
          <Routes>
            <Route path="/u/:handle" element={<UserProfilePage />} />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    await screen.findByText(/当前不能发送新私信/);
    expect(screen.getByRole('button', { name: '发消息' })).toBeDisabled();
    expect(screen.getByRole('link', { name: '从消息列表查看已有聊天' })).toHaveAttribute(
      'href',
      '/social',
    );
    expect(await screen.findByRole('button', { name: '加入黑名单' })).toBeEnabled();
    expect(start).not.toHaveBeenCalled();
  });
  it('does not navigate from a late chat receipt delivered during a different profile commit', async () => {
    const third = { ...otherMember, id: 'third-user', handle: 'third', name: '新的成员资料' };
    vi.mocked(peopleApi.user).mockImplementation(async (handle) =>
      handle === 'third' ? third : otherMember,
    );
    let finish!: (value: Conversation) => void,
      delivered = false;
    const start = vi.spyOn(peopleApi, 'startChat').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    function CommitRoutes() {
      const location = useLocation(),
        navigate = useNavigate();
      return (
        <Profiler
          id="member-routes"
          onRender={() => {
            if (location.pathname === '/u/third' && !delivered) {
              delivered = true;
              finish({
                id: 'old-target-chat',
                kind: 'direct',
                title: '旧目标私聊',
                members: [member.id, otherMember.id],
                ownerId: member.id,
                createdAt: '2026-10-27T08:00:00Z',
              });
            }
          }}
        >
          <button type="button" onClick={() => navigate('/u/third')}>
            切换成员资料
          </button>
          <Routes>
            <Route path="/u/:handle" element={<UserProfilePage />} />
            <Route path="/social" element={<p>不应进入旧会话</p>} />
          </Routes>
          <output>{location.pathname}</output>
        </Profiler>
      );
    }
    render(
      <MemoryRouter initialEntries={['/u/other']}>
        <AuthContext.Provider value={signedIn()}>
          <CommitRoutes />
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: '发消息' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '发消息' }));
    await waitFor(() => expect(start).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: '切换成员资料' }));
    await screen.findByRole('heading', { name: third.name });
    expect(delivered).toBe(true);
    expect(screen.getByText('/u/third')).toBeInTheDocument();
    expect(screen.queryByText('不应进入旧会话')).not.toBeInTheDocument();
    expect(start).toHaveBeenCalledExactlyOnceWith(otherMember);
  });
  it('falls back to a letter when an avatar fails to load', () => {
    const rendered = render(
      <PlatformAvatar user={{ name: '林见夏', avatar: 'https://example.test/avatar.jpg' }} />,
    );
    fireEvent.error(rendered.container.querySelector('img')!);
    expect(screen.getByText('林')).toBeInTheDocument();
  });
});
