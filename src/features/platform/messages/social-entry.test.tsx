import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ProfileContext } from '@/features/profile/profile-context';
import SocialPage from '@/features/social/SocialPage';
import { AuthContext, type AuthState } from '../auth-context';
import { signedIn } from '../platform-test-fixtures';

vi.mock('@/features/social/SocialHub', () => ({ default: () => <div>独立本机消息列表</div> }));
vi.mock('@/features/platform/PlatformMessagesPage', () => ({
  default: () => <div>真实账号消息列表</div>,
}));
const profile = { profile: { name: '本机昵称', bio: '原有本机资料' }, setProfile: vi.fn() };
const renderPage = (auth: AuthState, route = '/social', demo = false) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <ProfileContext.Provider value={profile}>
        <AuthContext.Provider value={auth}>
          <SocialPage demo={demo} />
        </AuthContext.Provider>
      </ProfileContext.Provider>
    </MemoryRouter>,
  );

describe('social primary entry', () => {
  it('uses account conversations for authenticated primary social and preserves local deep links', () => {
    const view = renderPage(signedIn());
    expect(screen.getByText('真实账号消息列表')).toBeInTheDocument();
    expect(screen.queryByText('独立本机消息列表')).not.toBeInTheDocument();
    view.unmount();
    renderPage(signedIn(), '/social/chat/local-friend');
    expect(screen.getByText('独立本机消息列表')).toBeInTheDocument();
    expect(profile.setProfile).not.toHaveBeenCalled();
  });
  it('keeps explicit local demo accessible to signed-in members and labels guest mode clearly', () => {
    const view = renderPage(signedIn(), '/social/demo', true);
    expect(screen.getByText('独立本机消息列表')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '账号消息' })).toHaveAttribute('href', '/social');
    view.unmount();
    renderPage({ ...signedIn(), user: null, status: 'guest' });
    expect(screen.getByText('本机演示 · 独立保存')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '登录使用账号消息' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fsocial',
    );
  });
  it('does not silently substitute demo data while checking authentication or when service is unavailable', () => {
    const refresh = vi.fn();
    const view = renderPage({ ...signedIn(), user: null, status: 'checking' });
    expect(screen.getByRole('status')).toHaveTextContent('正在连接你的账号消息');
    expect(screen.queryByText('独立本机消息列表')).not.toBeInTheDocument();
    view.unmount();
    renderPage({
      ...signedIn(),
      user: null,
      status: 'unavailable',
      error: '账号服务离线',
      refresh,
    });
    expect(screen.getByRole('alert')).toHaveTextContent('账号服务离线');
    expect(screen.getByRole('link', { name: '打开独立的本机演示' })).toHaveAttribute(
      'href',
      '/social/demo',
    );
    expect(screen.queryByText('独立本机消息列表')).not.toBeInTheDocument();
  });
});
