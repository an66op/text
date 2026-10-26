import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { platformApi } from '@/shared/api/platformApi';
import { AuthContext, type AuthState } from './auth-context';
import { member, otherMember, signedIn } from './platform-test-fixtures';
import PlatformAccountPage from './PlatformAccountPage';

const page = (auth: AuthState) => (
  <MemoryRouter>
    <AuthContext.Provider value={auth}>
      <PlatformAccountPage />
    </AuthContext.Provider>
  </MemoryRouter>
);
beforeEach(() =>
  vi
    .spyOn(platformApi, 'health')
    .mockResolvedValue({ status: 'ok' } as Awaited<ReturnType<typeof platformApi.health>>),
);
afterEach(() => vi.restoreAllMocks());
describe('account page async identity isolation', () => {
  it('links to real device management and ignores a prior account save completion', async () => {
    let finish!: () => void;
    const updateProfile = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(page({ ...signedIn(), updateProfile }));
    expect(screen.getByRole('link', { name: '登录设备' })).toHaveAttribute(
      'href',
      '/settings/devices',
    );
    fireEvent.change(screen.getByRole('textbox', { name: '昵称' }), {
      target: { value: '旧账号编辑' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存资料' }));
    view.rerender(page(signedIn(otherMember)));
    expect(screen.getByRole('textbox', { name: '昵称' })).toHaveValue(otherMember.name);
    await act(async () => finish());
    expect(screen.queryByRole('button', { name: '已保存' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '昵称' })).toHaveValue(otherMember.name);
    expect(screen.getByRole('button', { name: '保存资料' })).toBeEnabled();
  });

  it('ignores a prior logout rejection and keeps the new account controls available', async () => {
    let reject!: (error: Error) => void;
    const logout = vi.fn(
      () =>
        new Promise<void>((_resolve, no) => {
          reject = no;
        }),
    );
    const view = render(page({ ...signedIn(), logout }));
    fireEvent.click(screen.getByRole('button', { name: '退出当前账号' }));
    view.rerender(page(signedIn(otherMember)));
    await act(async () => reject(new Error('旧账号退出失败')));
    expect(screen.queryByText('旧账号退出失败')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '退出当前账号' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: '昵称' })).toHaveValue(otherMember.name);
    expect(screen.queryByText(member.handle)).not.toBeInTheDocument();
  });
});
