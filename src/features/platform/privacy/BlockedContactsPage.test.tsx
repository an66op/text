import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext, type AuthState } from '../auth-context';
import { otherMember, signedIn } from '../platform-test-fixtures';
import { privacyApi } from './privacy-api';
import { activatePrivacyScope } from './operation-registry';
import RealBlockedContactsPage from './BlockedContactsPage';
const when = '2026-10-27T10:00:00Z';
function scene(auth: AuthState = signedIn()) {
  return (
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <RealBlockedContactsPage />
      </AuthContext.Provider>
    </MemoryRouter>
  );
}
beforeEach(() => {
  localStorage.clear();
  activatePrivacyScope('');
});
afterEach(() => {
  activatePrivacyScope('');
  vi.restoreAllMocks();
});

it('lists private owner records with server search and pagination and clears old page content while loading', async () => {
  const get = vi.spyOn(privacyApi, 'blocks').mockImplementation(async (query) => ({
    items: query?.userId
      ? [
          {
            userId: query.userId,
            user: { ...otherMember, id: query.userId },
            available: true,
            createdAt: when,
          },
        ]
      : [
          {
            userId: query?.offset ? 'page-two' : 'page-one',
            user: {
              ...otherMember,
              id: query?.offset ? 'page-two' : 'page-one',
              name: query?.offset ? '第二页成员' : '第一页成员',
            },
            available: true,
            createdAt: when,
          },
        ],
    total: query?.userId ? 1 : 21,
    revision: 3,
    updatedAt: when,
  }));
  render(scene());
  await screen.findByText('第一页成员');
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  await screen.findByText('第二页成员');
  expect(screen.queryByText('第一页成员')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('搜索账号黑名单'), { target: { value: '  用户  ' } });
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith({ q: '用户', offset: 0, limit: 20 }, expect.any(AbortSignal)),
  );
});
it('allows confirming removal for an unavailable target without requesting its private profile or capabilities', async () => {
  let blocked = true;
  const get = vi.spyOn(privacyApi, 'blocks').mockImplementation(async () => ({
    items: blocked
      ? [{ userId: 'inactive-member', user: null, available: false, createdAt: when }]
      : [],
    total: blocked ? 1 : 0,
    revision: blocked ? 4 : 5,
    updatedAt: when,
  }));
  const capabilities = vi.spyOn(privacyApi, 'capabilities');
  const remove = vi.spyOn(privacyApi, 'unblock').mockImplementation(async (userId) => {
    blocked = false;
    return { ok: true, userId, blocked: false, revision: 5, updatedAt: when };
  });
  render(scene());
  await screen.findByText('暂不可用的账号');
  fireEvent.click(await screen.findByRole('button', { name: '解除拉黑' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('inactive-member');
  fireEvent.click(screen.getByRole('button', { name: '确认解除拉黑' }));
  await screen.findByText('黑名单为空');
  expect(remove).toHaveBeenCalledWith('inactive-member', 4, expect.any(AbortSignal));
  expect(get.mock.calls.length).toBeGreaterThan(1);
  expect(capabilities).not.toHaveBeenCalled();
});
it.each(['checking', 'unavailable'] as const)(
  'never falls back to the local demo blacklist while auth is %s',
  async (status) => {
    localStorage.setItem('profile-blocked-contacts', JSON.stringify(['achuan']));
    const get = vi.spyOn(privacyApi, 'blocks');
    render(
      scene({
        ...signedIn(),
        user: null,
        status,
        error: status === 'unavailable' ? '账号服务不可达' : '',
      }),
    );
    if (status === 'checking') expect(screen.getByRole('status')).toHaveTextContent('正在验证账号');
    else expect(screen.getByRole('alert')).toHaveTextContent('账号服务不可达');
    expect(screen.queryByText('阿川')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加屏蔽联系人' })).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  },
);
