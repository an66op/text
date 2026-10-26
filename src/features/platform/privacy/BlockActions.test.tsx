import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { AuthContext } from '../auth-context';
import { member, otherMember, signedIn } from '../platform-test-fixtures';
import { privacyApi } from './privacy-api';
import { activatePrivacyScope } from './operation-registry';
import type { BlockList } from './types';
import BlockActions from './BlockActions';

const when = '2026-10-27T10:00:00Z';
function list(userId?: string, revision = 0): BlockList {
  return {
    items: userId
      ? [{ userId, user: { ...otherMember, id: userId }, available: true, createdAt: when }]
      : [],
    total: userId ? 1 : 0,
    revision,
    updatedAt: revision ? when : null,
  };
}
function scene(target = otherMember.id, who = member) {
  return (
    <MemoryRouter>
      <AuthContext.Provider value={signedIn(who)}>
        <BlockActions userId={target} person={{ ...otherMember, id: target }} />
      </AuthContext.Provider>
    </MemoryRouter>
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { resolve, promise };
}
beforeEach(() => {
  localStorage.clear();
  activatePrivacyScope('');
});
afterEach(() => {
  activatePrivacyScope('');
  vi.restoreAllMocks();
});
async function confirmBlock() {
  fireEvent.click(await screen.findByRole('button', { name: '加入黑名单' }));
  fireEvent.click(screen.getByRole('button', { name: '确认加入黑名单' }));
}

it('confirms the exact target and consequences, then reloads authoritative own state without local persistence', async () => {
  let blocked = false;
  const get = vi
    .spyOn(privacyApi, 'blocks')
    .mockImplementation(async () => list(blocked ? otherMember.id : undefined, blocked ? 1 : 0));
  const write = vi.spyOn(privacyApi, 'block').mockImplementation(async (userId) => {
    blocked = true;
    return { ok: true, userId, blocked: true, revision: 1, updatedAt: when };
  });
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  render(scene());
  fireEvent.click(await screen.findByRole('button', { name: '加入黑名单' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(otherMember.id)).toBeInTheDocument();
  expect(dialog).toHaveTextContent('已有好友关系保留');
  expect(dialog).toHaveTextContent('历史消息和图片保留');
  expect(dialog).toHaveTextContent('共同群组、频道、圈子');
  fireEvent.click(within(dialog).getByRole('button', { name: '确认加入黑名单' }));
  await screen.findByRole('button', { name: '解除拉黑' });
  expect(write).toHaveBeenCalledWith(otherMember.id, 0, expect.any(AbortSignal));
  expect(write).toHaveBeenCalledOnce();
  expect(get.mock.calls.length).toBeGreaterThan(1);
  expect(storage).not.toHaveBeenCalled();
});
it('retains an unknown write across closing and another target, and reconciles the original exact target before unlocking', async () => {
  const get = vi
    .spyOn(privacyApi, 'blocks')
    .mockImplementation(async (query) => list(query?.userId === otherMember.id ? '' : undefined));
  const write = vi
    .spyOn(privacyApi, 'block')
    .mockRejectedValue(new ApiError('结果未知', 'TIMEOUT', 0));
  const view = render(scene());
  await confirmBlock();
  await screen.findByRole('button', { name: '核实上次操作' });
  view.unmount();
  render(scene('third-member'));
  expect(await screen.findByRole('button', { name: '核实上次操作' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /读取拉黑状态|加入黑名单/ })).toBeDisabled();
  get.mockImplementation(async (query) =>
    list(query?.userId === otherMember.id ? otherMember.id : undefined, 1),
  );
  fireEvent.click(screen.getByRole('button', { name: '核实上次操作' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: '核实上次操作' })).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(screen.getByRole('button', { name: '加入黑名单' })).toBeEnabled());
  expect(get).toHaveBeenCalledWith(
    { userId: otherMember.id, limit: 1, offset: 0 },
    expect.any(AbortSignal),
  );
  expect(write).toHaveBeenCalledOnce();
});
it('keeps the opposite action locked after an unchanged empty snapshot and only manually retries the original CAS intent', async () => {
  let blocked = false;
  vi.spyOn(privacyApi, 'blocks').mockImplementation(async () =>
    list(blocked ? otherMember.id : undefined, blocked ? 1 : 0),
  );
  const write = vi
    .spyOn(privacyApi, 'block')
    .mockRejectedValueOnce(new ApiError('连接中断', 'NETWORK_ERROR', 0))
    .mockImplementation(async (userId) => {
      blocked = true;
      return { ok: true, userId, blocked: true, revision: 1, updatedAt: when };
    });
  const remove = vi.spyOn(privacyApi, 'unblock');
  render(scene());
  await confirmBlock();
  fireEvent.click(await screen.findByRole('button', { name: '核实上次操作' }));
  const retry = await screen.findByRole('button', { name: '重试原操作' });
  expect(screen.getByRole('button', { name: /读取拉黑状态|加入黑名单/ })).toBeDisabled();
  expect(write).toHaveBeenCalledOnce();
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(retry);
  await screen.findByRole('button', { name: '解除拉黑' });
  expect(write.mock.calls.map((call) => call.slice(0, 2))).toEqual([
    [otherMember.id, 0],
    [otherMember.id, 0],
  ]);
});
it('recovers from CAS conflict with a new read rather than faking success or replaying the write', async () => {
  let revision = 3;
  vi.spyOn(privacyApi, 'blocks').mockImplementation(async () => list(undefined, revision));
  const write = vi.spyOn(privacyApi, 'block').mockImplementation(async () => {
    revision = 4;
    throw new ApiError('隐私设置已更新，请刷新', 'privacy_conflict', 409);
  });
  render(scene());
  await confirmBlock();
  await screen.findByText('隐私设置已更新，请刷新');
  await waitFor(() => expect(screen.getByRole('button', { name: '加入黑名单' })).toBeEnabled());
  expect(screen.queryByRole('button', { name: '解除拉黑' })).not.toBeInTheDocument();
  expect(write).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '加入黑名单' }));
  fireEvent.click(screen.getByRole('button', { name: '确认加入黑名单' }));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
  expect(write.mock.calls.map((call) => call[1])).toEqual([3, 4]);
});
it('discards an old exact-target read after target A to B to A', async () => {
  const late = deferred<BlockList>();
  vi.spyOn(privacyApi, 'blocks')
    .mockReturnValueOnce(late.promise)
    .mockResolvedValue(list(undefined, 2));
  const view = render(scene());
  await waitFor(() => expect(privacyApi.blocks).toHaveBeenCalled());
  view.rerender(scene('third-member'));
  view.rerender(scene());
  await waitFor(() => expect(screen.getByRole('button', { name: '加入黑名单' })).toBeEnabled());
  await act(async () => late.resolve(list(otherMember.id, 1)));
  expect(screen.queryByRole('button', { name: '解除拉黑' })).not.toBeInTheDocument();
});
it('discards a late successful write after changing accounts and never transfers its unknown state', async () => {
  const late = deferred<{
    ok: true;
    userId: string;
    blocked: boolean;
    revision: number;
    updatedAt: string;
  }>();
  vi.spyOn(privacyApi, 'blocks').mockResolvedValue(list());
  vi.spyOn(privacyApi, 'block').mockReturnValue(late.promise);
  const view = render(scene());
  await confirmBlock();
  view.rerender(scene('third-member', otherMember));
  await waitFor(() => expect(screen.getByRole('button', { name: '加入黑名单' })).toBeEnabled());
  await act(async () =>
    late.resolve({ ok: true, userId: otherMember.id, blocked: true, revision: 1, updatedAt: when }),
  );
  expect(screen.queryByRole('button', { name: '解除拉黑' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '核实上次操作' })).not.toBeInTheDocument();
});
