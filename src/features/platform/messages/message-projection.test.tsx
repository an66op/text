import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, it, expect, vi } from 'vitest';
import { platformApi } from '@/shared/api/platformApi';
import { ApiError } from '@/shared/api/client';
import type { MessagePage, MessageResolve } from '@/shared/api/types';
import { useThreadMessages } from './useThreadMessages';
import { msg } from './message-media-fixtures';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { resolve, promise };
}
afterEach(() => vi.restoreAllMocks());
it('resolves more than 200 loaded IDs and queues late unknown old history during the pass', async () => {
  const initial = Array.from({ length: 250 }, (_, i) => ({ ...msg(`m${i}`), seq: i + 1 })),
    history = deferred<MessagePage>(),
    first = deferred<MessageResolve>();
  vi.spyOn(platformApi, 'messages').mockImplementation((_id, _signal, query) =>
    query?.beforeSeq
      ? history.promise
      : Promise.resolve({ items: initial, total: 251, hasMore: true, mutationVersion: 0 }),
  );
  let calls = 0;
  const resolve = vi.spyOn(platformApi, 'resolveMessages').mockImplementation(async (_id, ids) =>
    ++calls === 1
      ? first.promise
      : {
          items: ids.map((id) => ({ ...msg(id, 2), seq: Number(id.slice(1)) + 1 })),
          missingIds: [],
          mutationVersion: 1,
        },
  );
  const view = renderHook(({ version }) => useThreadMessages('owner', 'chat', 0, version), {
    initialProps: { version: 0 },
  });
  await waitFor(() => expect(view.result.current.messages).toHaveLength(250));
  let older!: Promise<void>;
  act(() => {
    older = view.result.current.loadOlder();
  });
  view.rerender({ version: 1 });
  await waitFor(() => expect(resolve).toHaveBeenCalledOnce());
  await act(async () => {
    history.resolve({
      items: [{ ...msg('late-old'), seq: 0 }],
      total: 251,
      hasMore: false,
      mutationVersion: 0,
    });
    await older;
  });
  expect(view.result.current.messages.some((item) => item.id === 'late-old')).toBe(false);
  await act(async () =>
    first.resolve({
      items: resolve.mock.calls[0][1].map((id) => ({
        ...msg(id, 2),
        seq: Number(id.slice(1)) + 1,
      })),
      missingIds: [],
      mutationVersion: 1,
    }),
  );
  await waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
  expect(resolve.mock.calls.every(([, ids]) => ids.length <= 200)).toBe(true);
  expect(resolve.mock.calls[1][1]).toContain('late-old');
});
it('does not apply a late resolve after current membership is revoked', async () => {
  const stale = deferred<MessageResolve>();
  let reads = 0;
  vi.spyOn(platformApi, 'messages').mockImplementation(async () => {
    if (++reads === 1) return { items: [msg()], total: 1, mutationVersion: 0 };
    throw new ApiError('removed', 'not_found', 404);
  });
  vi.spyOn(platformApi, 'resolveMessages').mockReturnValue(stale.promise);
  const view = renderHook(() => useThreadMessages('owner', 'chat', 0));
  await waitFor(() => expect(view.result.current.messages).toHaveLength(1));
  act(() => view.result.current.refresh());
  await waitFor(() => expect(view.result.current.accessDenied).toBe(true));
  await act(async () =>
    stale.resolve({ items: [msg('private-history', 2)], missingIds: [], mutationVersion: 1 }),
  );
  expect(view.result.current.messages).toEqual([]);
  expect(view.result.current.accessDenied).toBe(true);
});
