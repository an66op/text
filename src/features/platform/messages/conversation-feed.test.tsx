import { act, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { platformApi } from '@/shared/api/platformApi';
import type { Conversation } from '@/shared/api/types';
import { AuthContext } from '../auth-context';
import { member, signedIn } from '../platform-test-fixtures';
import PlatformMessagesPage from '../PlatformMessagesPage';
import { useConversationFeed } from './useConversationFeed';
import type { StreamEvent } from './usePlatformStream';

const stream = vi.hoisted(() => ({ onEvent: null as ((event: StreamEvent) => void) | null }));
vi.mock('./usePlatformStream', () => ({
  usePlatformStream: (_userId: string, onEvent: (event: StreamEvent) => void) => {
    stream.onEvent = onEvent;
    return 'live';
  },
}));

type ConversationPage = { items: Conversation[]; total: number };
const conversation: Conversation = {
  id: 'busy-group',
  title: '繁忙群组',
  kind: 'group',
  ownerId: member.id,
  members: [member.id],
  createdAt: '2026-10-27T08:00:00Z',
};
function deferred() {
  let resolve!: (value: ConversationPage) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<ConversationPage>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
afterEach(() => {
  vi.restoreAllMocks();
  stream.onEvent = null;
});

describe('conversation snapshot refresh priority', () => {
  it('shows each slow valid snapshot despite continuous message/read notifications and queues only one next GET', async () => {
    const first = deferred();
    const second = deferred();
    const third = deferred();
    const read = vi
      .spyOn(platformApi, 'conversations')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    render(
      <MemoryRouter initialEntries={['/social']}>
        <AuthContext.Provider value={signedIn()}>
          <PlatformMessagesPage />
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    act(() => {
      for (let index = 0; index < 8; index += 1) {
        stream.onEvent?.({ type: index % 2 ? 'message.created' : 'conversation.read' });
        window.dispatchEvent(new Event('gongming:conversations-changed'));
      }
    });
    expect(read).toHaveBeenCalledOnce();
    await act(async () => first.resolve({ items: [conversation], total: 1 }));
    expect(screen.getByRole('button', { name: /繁忙群组/ })).toBeInTheDocument();
    expect(screen.queryByText('正在加载会话…')).not.toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(2);
    act(() => {
      for (let index = 0; index < 8; index += 1) {
        stream.onEvent?.({ type: 'message.created' });
        window.dispatchEvent(new Event('gongming:conversations-changed'));
      }
    });
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () =>
      second.resolve({ items: [{ ...conversation, title: '最新群组快照' }], total: 1 }),
    );
    expect(screen.getByRole('button', { name: /最新群组快照/ })).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('discards an in-flight old snapshot after a hard resync and waits for the fresh permission snapshot', async () => {
    const old = deferred();
    const fresh = deferred();
    const read = vi
      .spyOn(platformApi, 'conversations')
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    render(
      <MemoryRouter initialEntries={['/social']}>
        <AuthContext.Provider value={signedIn()}>
          <PlatformMessagesPage />
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    act(() => {
      stream.onEvent?.({ type: 'message.created' });
      stream.onEvent?.({ type: 'resync' });
      window.dispatchEvent(new Event('gongming:conversations-changed'));
    });
    expect(read).toHaveBeenCalledOnce();
    await act(async () => old.resolve({ items: [conversation], total: 1 }));
    expect(screen.queryByRole('button', { name: /繁忙群组/ })).not.toBeInTheDocument();
    expect(screen.getByText('正在加载会话…')).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => fresh.resolve({ items: [], total: 0 }));
    expect(screen.queryByText('正在加载会话…')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /繁忙群组/ })).not.toBeInTheDocument();
  });

  it('ends initial loading on a current-generation failure even when soft notifications queue another read', async () => {
    const failed = deferred();
    const queued = deferred();
    const read = vi
      .spyOn(platformApi, 'conversations')
      .mockReturnValueOnce(failed.promise)
      .mockReturnValueOnce(queued.promise);
    const { result } = renderHook(() => useConversationFeed(member.id));
    act(() => {
      result.current.refresh(false);
      window.dispatchEvent(new Event('gongming:conversations-changed'));
    });
    await act(async () => failed.reject(new Error('暂时连接失败')));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('暂时连接失败');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps explicit refresh and focus strict while merging global message notifications', async () => {
    const first = deferred();
    const second = deferred();
    const read = vi
      .spyOn(platformApi, 'conversations')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useConversationFeed(member.id));
    act(() => result.current.refresh());
    await act(async () => first.resolve({ items: [conversation], total: 1 }));
    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
    act(() => window.dispatchEvent(new Event('focus')));
    read.mockResolvedValueOnce({ items: [], total: 0 });
    await act(async () => second.resolve({ items: [conversation], total: 1 }));
    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(read).toHaveBeenCalledTimes(3);
  });
});
