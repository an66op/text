import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { platformApi } from '@/shared/api/platformApi';
import type {
  Conversation,
  MessagePage,
  MessageResolve,
  PlatformMessage,
} from '@/shared/api/types';
import { AuthContext } from '../auth-context';
import { member, signedIn } from '../platform-test-fixtures';
import MessageThread from './MessageThread';
import { msg } from './message-media-fixtures';
import { useThreadMessages } from './useThreadMessages';
import type { StreamEvent } from './usePlatformStream';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, promise };
}
const invalidated: StreamEvent = {
  type: 'conversation.messages.invalidated',
  conversationId: 'chat',
};
const conversation: Conversation = {
  id: 'chat',
  title: '失效投影回归',
  kind: 'group',
  ownerId: member.id,
  members: [member.id],
  createdAt: '2026-10-27T08:00:00Z',
  mutationVersion: 0,
};
const image = {
  id: `media_${'a'.repeat(32)}`,
  url: `/api/v1/media/images/media_${'a'.repeat(32)}`,
  available: true,
  width: 100,
  height: 100,
  bytes: 10,
  contentType: 'image/png' as const,
};
const page = (items: PlatformMessage[], mutationVersion = 0, hasMore = false): MessagePage => ({
  items,
  total: items.length,
  mutationVersion,
  hasMore,
});
function scene(updateVersion = 0, event?: StreamEvent) {
  return (
    <MemoryRouter>
      <AuthContext.Provider value={signedIn()}>
        <MessageThread
          conversation={conversation}
          onBack={vi.fn()}
          onSent={vi.fn()}
          onRead={vi.fn()}
          updateVersion={updateVersion}
          streamStatus="live"
          streamEvent={event}
        />
      </AuthContext.Provider>
    </MemoryRouter>
  );
}
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(platformApi, 'markConversationRead').mockResolvedValue({
    conversationId: 'chat',
    readSeq: 1,
    unreadCount: 0,
    lastReadMessageId: 'one',
  });
});
afterEach(() => vi.restoreAllMocks());

it('closes an open viewer immediately on invalidation and keeps old content hidden after resolve fails', async () => {
  const latest = deferred<MessagePage>(),
    failed = deferred<MessageResolve>(),
    checked = deferred<MessageResolve>();
  vi.spyOn(platformApi, 'messages')
    .mockResolvedValueOnce(page([{ ...msg(), images: [image] }]))
    .mockReturnValue(latest.promise);
  const resolve = vi
    .spyOn(platformApi, 'resolveMessages')
    .mockReturnValueOnce(failed.promise)
    .mockReturnValue(checked.promise);
  const view = render(scene());
  fireEvent.click(await screen.findByRole('button', { name: '查看消息图片' }));
  expect(screen.getByRole('dialog', { name: '图片全屏查看' })).toBeInTheDocument();

  view.rerender(scene(1, invalidated));
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: '图片全屏查看' })).not.toBeInTheDocument();
    expect(screen.queryByText('private-one')).not.toBeInTheDocument();
    expect(screen.queryByAltText('消息图片')).not.toBeInTheDocument();
  });
  await act(async () => failed.reject(new ApiError('暂时无法确认图片状态', 'UNAVAILABLE', 500)));
  await screen.findByText('暂时无法确认图片状态');
  expect(screen.queryByText('private-one')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '查看消息图片' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('private-one')).not.toBeInTheDocument();
  await act(async () =>
    checked.resolve({
      items: [
        {
          ...msg('one', 2),
          body: '已经重新确认的正文',
          images: [{ ...image, available: false, url: null }],
        },
      ],
      missingIds: [],
      mutationVersion: 1,
    }),
  );
  await screen.findByText('已经重新确认的正文');
  expect(screen.getByText('图片暂不可用')).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: '图片全屏查看' })).not.toBeInTheDocument();
});

it('quarantines late unknown history and send IDs until a new-generation resolve confirms them', async () => {
  const history = deferred<MessagePage>(),
    latest = deferred<MessagePage>(),
    first = deferred<MessageResolve>(),
    next = deferred<MessageResolve>();
  let initial = true;
  vi.spyOn(platformApi, 'messages').mockImplementation((_id, _signal, query) => {
    if (query?.beforeSeq) return history.promise;
    if (initial) {
      initial = false;
      return Promise.resolve(page([{ ...msg(), seq: 5 }], 0, true));
    }
    return latest.promise;
  });
  const resolve = vi
    .spyOn(platformApi, 'resolveMessages')
    .mockReturnValueOnce(first.promise)
    .mockReturnValue(next.promise);
  const view = renderHook(
    ({ updateVersion, event }) => useThreadMessages(member.id, 'chat', updateVersion, 0, event),
    { initialProps: { updateVersion: 0, event: undefined as StreamEvent | undefined } },
  );
  await waitFor(() => expect(view.result.current.messages).toHaveLength(1));
  const oldSendPermission = view.result.current.capturePermission();
  let older!: Promise<void>;
  act(() => {
    older = view.result.current.loadOlder();
  });
  view.rerender({ updateVersion: 1, event: invalidated });
  await waitFor(() => expect(resolve).toHaveBeenCalledOnce());
  await act(async () => {
    history.resolve(page([{ ...msg('late-history'), seq: 1 }]));
    await older;
    view.result.current.apply([{ ...msg('late-send'), seq: 6 }], oldSendPermission);
  });
  expect(view.result.current.messages.every((message) => !message.body)).toBe(true);
  expect(view.result.current.messages.some((message) => message.id === 'late-history')).toBe(false);
  expect(view.result.current.messages.some((message) => message.id === 'late-send')).toBe(false);

  await act(async () =>
    first.resolve({
      items: [{ ...msg('one', 2), body: 'checked-one', seq: 5 }],
      missingIds: [],
      mutationVersion: 1,
    }),
  );
  await waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
  expect(resolve.mock.calls[1][1]).toEqual(expect.arrayContaining(['late-history', 'late-send']));
  expect(
    view.result.current.messages.some((message) => message.body === 'private-late-history'),
  ).toBe(false);
  expect(view.result.current.messages.some((message) => message.body === 'private-late-send')).toBe(
    false,
  );
  await act(async () =>
    next.resolve({
      items: resolve.mock.calls[1][1].map((id) => ({
        ...msg(id, 2),
        body: `checked-${id}`,
        seq: id === 'late-history' ? 1 : 6,
      })),
      missingIds: [],
      mutationVersion: 1,
    }),
  );
  await waitFor(() =>
    expect(view.result.current.messages.map((message) => message.body)).toEqual(
      expect.arrayContaining(['checked-late-history', 'checked-late-send']),
    ),
  );
});

it('does not let an older in-flight resolve release the invalidation hold', async () => {
  const latest = deferred<MessagePage>(),
    stale = deferred<MessageResolve>(),
    current = deferred<MessageResolve>();
  vi.spyOn(platformApi, 'messages')
    .mockResolvedValueOnce(page([msg()]))
    .mockReturnValue(latest.promise);
  const resolve = vi
    .spyOn(platformApi, 'resolveMessages')
    .mockReturnValueOnce(stale.promise)
    .mockReturnValue(current.promise);
  const view = renderHook(
    ({ updateVersion, event }) => useThreadMessages(member.id, 'chat', updateVersion, 0, event),
    { initialProps: { updateVersion: 0, event: undefined as StreamEvent | undefined } },
  );
  await waitFor(() => expect(view.result.current.messages[0]?.body).toBe('private-one'));
  act(() => view.result.current.refresh());
  await waitFor(() => expect(resolve).toHaveBeenCalledOnce());
  view.rerender({ updateVersion: 1, event: invalidated });
  await waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
  await act(async () => stale.resolve({ items: [msg()], missingIds: [], mutationVersion: 0 }));
  expect(view.result.current.messages.every((message) => !message.body)).toBe(true);
  await act(async () =>
    current.resolve({
      items: [{ ...msg('one', 2), body: 'current-generation' }],
      missingIds: [],
      mutationVersion: 1,
    }),
  );
  await waitFor(() => expect(view.result.current.messages[0]?.body).toBe('current-generation'));
});
