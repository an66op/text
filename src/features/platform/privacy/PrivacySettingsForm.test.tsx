import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { AuthContext, type AuthState } from '../auth-context';
import { signedIn } from '../platform-test-fixtures';
import PrivacySettingsPage from '@/features/profile/PrivacySettingsPage';
import { privacyApi } from './privacy-api';
import { activatePrivacyScope } from './operation-registry';
import type { ContactPrivacy } from './types';
const base: ContactPrivacy = {
  directMessagePolicy: 'everyone',
  groupInvitePolicy: 'everyone',
  allowFriendRequests: true,
  discoverableByHandle: true,
  revision: 0,
  updatedAt: null,
};
const view = (auth: AuthState = signedIn()) =>
  render(
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <PrivacySettingsPage />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
beforeEach(() => {
  vi.spyOn(privacyApi, 'get').mockResolvedValue(base);
});
afterEach(() => {
  activatePrivacyScope('');
  vi.restoreAllMocks();
});
it('saves four independent fields explicitly with the server CAS revision and never writes local settings', async () => {
  const save = vi.spyOn(privacyApi, 'save').mockImplementation(async (value) => ({
      ...value,
      revision: 1,
      updatedAt: '2026-10-27T08:00:00Z',
    })),
    storage = vi.spyOn(Storage.prototype, 'setItem');
  view();
  const direct = await screen.findByLabelText('谁可以给我发私信');
  fireEvent.change(direct, { target: { value: 'friends' } });
  fireEvent.change(screen.getByLabelText('谁可以邀请我入群'), { target: { value: 'nobody' } });
  fireEvent.click(screen.getByRole('switch', { name: '允许新的好友申请' }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await screen.findByText('隐私权限已保存');
  expect(save).toHaveBeenCalledWith(
    {
      directMessagePolicy: 'friends',
      groupInvitePolicy: 'nobody',
      allowFriendRequests: false,
      discoverableByHandle: true,
      revision: 0,
    },
    expect.any(AbortSignal),
  );
  expect(storage).not.toHaveBeenCalled();
});
it('preserves a conflicting draft and requires an explicit refresh before saving against the new revision', async () => {
  const save = vi
    .spyOn(privacyApi, 'save')
    .mockRejectedValueOnce(new ApiError('设置已更新，请刷新核实', 'privacy_conflict', 409))
    .mockImplementation(async (value) => ({
      ...value,
      revision: 3,
      updatedAt: '2026-10-27T08:00:00Z',
    }));
  view();
  fireEvent.change(await screen.findByLabelText('谁可以给我发私信'), {
    target: { value: 'nobody' },
  });
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await screen.findByText('设置已更新，请刷新核实');
  expect(screen.getByLabelText('谁可以给我发私信')).toHaveValue('nobody');
  vi.mocked(privacyApi.get).mockResolvedValue({
    ...base,
    groupInvitePolicy: 'friends',
    revision: 2,
  });
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '保存设置' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await screen.findByText('隐私权限已保存');
  expect(save.mock.calls[1][0]).toMatchObject({ directMessagePolicy: 'nobody', revision: 2 });
});
it.each(['checking', 'unavailable'] as const)(
  'does not fall back to demo settings while auth is %s',
  async (status) => {
    view({
      ...signedIn(),
      user: null,
      status,
      error: status === 'unavailable' ? '账号服务不可达' : '',
    });
    expect(screen.queryByLabelText('默认动态可见范围')).not.toBeInTheDocument();
    expect(privacyApi.get).not.toHaveBeenCalled();
    expect(
      screen.getByText(status === 'checking' ? '正在验证账号…' : '账号服务不可达'),
    ).toBeInTheDocument();
  },
);
it('does not silently rebase a dirty draft to a background refresh and overwrite another window', async () => {
  const save = vi
    .spyOn(privacyApi, 'save')
    .mockRejectedValue(new ApiError('请刷新核实', 'privacy_conflict', 409));
  view();
  fireEvent.change(await screen.findByLabelText('谁可以给我发私信'), {
    target: { value: 'nobody' },
  });
  vi.mocked(privacyApi.get).mockResolvedValue({
    ...base,
    groupInvitePolicy: 'friends',
    revision: 2,
  });
  act(() => window.dispatchEvent(new Event('focus')));
  await screen.findByText('服务器设置已更新。你的选择仍保留，请刷新核实后再保存。');
  expect(screen.getByLabelText('谁可以给我发私信')).toHaveValue('nobody');
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0].revision).toBe(0);
});
