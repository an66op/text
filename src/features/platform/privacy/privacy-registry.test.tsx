import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { advanceAccountEpoch } from '@/shared/api/account-guard';
import { contactScope } from './contact-scope';
import { privacyApi } from './privacy-api';
import {
  activatePrivacyScope,
  getPrivacyOperation,
  privacyReadEpoch,
  reconcilePrivacyOperation,
  retryPrivacyOperation,
  runPrivacyOperation,
} from './operation-registry';
import { usePrivacyOperation } from './usePrivacyOperation';
import type { BlockReceipt, ContactPrivacy } from './types';
const privacy: ContactPrivacy = {
  directMessagePolicy: 'everyone',
  groupInvitePolicy: 'everyone',
  allowFriendRequests: true,
  discoverableByHandle: true,
  revision: 0,
  updatedAt: null,
};
const receipt = (blocked = true, revision = 1): BlockReceipt => ({
  ok: true,
  userId: 'target',
  blocked,
  revision,
  updatedAt: '2026-10-27T08:00:00Z',
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
afterEach(() => {
  activatePrivacyScope('');
  vi.restoreAllMocks();
});
it('serializes synchronous privacy and block intents and invalidates prior private reads', async () => {
  const scope = contactScope('owner', 'session');
  activatePrivacyScope(scope);
  const pending = deferred<BlockReceipt>(),
    block = vi.spyOn(privacyApi, 'block').mockReturnValue(pending.promise),
    save = vi.spyOn(privacyApi, 'save');
  const epoch = privacyReadEpoch(scope),
    first = runPrivacyOperation(scope, {
      kind: 'block',
      userId: 'target',
      blocked: true,
      revision: 0,
    });
  await runPrivacyOperation(scope, { kind: 'privacy', value: privacy, revision: 0 });
  expect(block).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
  expect(privacyReadEpoch(scope)).toBeGreaterThan(epoch);
  pending.resolve(receipt());
  await first;
  expect(getPrivacyOperation(scope).phase).toBe('idle');
});
it('keeps an unknown write across closing and reopening and cannot unlock the opposite intent on an unchanged pre-commit read', async () => {
  const scope = contactScope('owner', 'session');
  const block = vi
    .spyOn(privacyApi, 'block')
    .mockRejectedValueOnce(new ApiError('timeout', 'TIMEOUT', 0))
    .mockResolvedValue(receipt());
  const unblock = vi.spyOn(privacyApi, 'unblock'),
    mine = vi
      .spyOn(privacyApi, 'blocks')
      .mockResolvedValue({ items: [], total: 0, revision: 0, updatedAt: null });
  const first = renderHook(() => usePrivacyOperation(scope));
  await act(async () => {
    await runPrivacyOperation(scope, {
      kind: 'block',
      userId: 'target',
      blocked: true,
      revision: 0,
    });
  });
  first.unmount();
  const reopened = renderHook(() => usePrivacyOperation(scope));
  expect(reopened.result.current.phase).toBe('unknown');
  await act(async () => {
    await runPrivacyOperation(scope, {
      kind: 'block',
      userId: 'target',
      blocked: false,
      revision: 0,
    });
    await reconcilePrivacyOperation(scope);
  });
  expect(unblock).not.toHaveBeenCalled();
  expect(mine).toHaveBeenCalledWith(
    { userId: 'target', limit: 1, offset: 0 },
    expect.any(AbortSignal),
  );
  expect(reopened.result.current.phase).toBe('unknown');
  expect(reopened.result.current.checked).toBe(true);
  expect(block).toHaveBeenCalledOnce();
  await act(async () => {
    await retryPrivacyOperation(scope);
  });
  expect(block).toHaveBeenCalledTimes(2);
  expect(block.mock.calls[1].slice(0, 2)).toEqual(['target', 0]);
  expect(reopened.result.current.phase).toBe('idle');
});
it('confirms an unknown operation only with the exact target snapshot or a newer CAS revision', async () => {
  const scope = contactScope('owner', 'session');
  activatePrivacyScope(scope);
  vi.spyOn(privacyApi, 'unblock').mockRejectedValue(new ApiError('timeout', 'TIMEOUT', 0));
  vi.spyOn(privacyApi, 'blocks').mockResolvedValue({
    items: [],
    total: 0,
    revision: 2,
    updatedAt: null,
  });
  await runPrivacyOperation(scope, {
    kind: 'block',
    userId: 'target',
    blocked: false,
    revision: 1,
  });
  await reconcilePrivacyOperation(scope);
  expect(getPrivacyOperation(scope).phase).toBe('idle');
});
it('ignores a late write after A→B→A authentication rotation and rejects old retained actions', async () => {
  const old = deferred<BlockReceipt>(),
    block = vi.spyOn(privacyApi, 'block').mockReturnValue(old.promise);
  const a = contactScope('a', 'session');
  activatePrivacyScope(a);
  const write = runPrivacyOperation(a, {
    kind: 'block',
    userId: 'target',
    blocked: true,
    revision: 0,
  });
  advanceAccountEpoch();
  activatePrivacyScope(contactScope('b', 'session'));
  advanceAccountEpoch();
  const next = contactScope('a', 'session');
  activatePrivacyScope(next);
  old.resolve(receipt());
  expect(await write).toBeNull();
  expect(getPrivacyOperation(next).phase).toBe('idle');
  expect(getPrivacyOperation(next).result).toBeNull();
  await runPrivacyOperation(a, { kind: 'block', userId: 'target', blocked: true, revision: 0 });
  expect(block).toHaveBeenCalledOnce();
});
it('treats an impossible successful CAS revision as unknown rather than announcing success', async () => {
  const scope = contactScope('owner', 'session');
  activatePrivacyScope(scope);
  vi.spyOn(privacyApi, 'block').mockResolvedValue(receipt(true, 999));
  expect(
    await runPrivacyOperation(scope, {
      kind: 'block',
      userId: 'target',
      blocked: true,
      revision: 0,
    }),
  ).toBeNull();
  expect(getPrivacyOperation(scope).phase).toBe('unknown');
});
it('aborts and clears a detached private write immediately on auth rotation without mounting another privacy page', async () => {
  const scope = contactScope('owner', 'session');
  activatePrivacyScope(scope);
  const old = deferred<BlockReceipt>(),
    block = vi.spyOn(privacyApi, 'block').mockReturnValue(old.promise);
  const pending = runPrivacyOperation(scope, {
    kind: 'block',
    userId: 'target',
    blocked: true,
    revision: 0,
  });
  const signal = block.mock.calls[0][2];
  advanceAccountEpoch();
  expect(signal?.aborted).toBe(true);
  expect(getPrivacyOperation(scope).operation).toBeNull();
  old.resolve(receipt());
  expect(await pending).toBeNull();
});
