import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { platformApi } from '@/shared/api/platformApi';
import type { Conversation, MessagePage, PlatformMessage } from '@/shared/api/types';
import { AuthContext } from '../auth-context';
import { member, otherMember, signedIn } from '../platform-test-fixtures';
import PlatformMessagesPage from '../PlatformMessagesPage';
import {
  emptyMessageDraft,
  mergeMessages,
  messageDraftKey,
  readMessageDraft,
  saveMessageDraft,
} from './message-drafts';
import { useThreadMessages } from './useThreadMessages';
import { useMessageDraft } from './useMessageDraft';

const first: Conversation = {
  id: 'first',
  title: '第一场对话',
  kind: 'direct',
  ownerId: member.id,
  members: [member.id, otherMember.id],
  createdAt: '2026-10-27T08:00:00Z',
  unreadCount: 2,
  readSeq: 0,
};
const second: Conversation = { ...first, id: 'second', title: '第二场对话' };
const message = (
  seq: number,
  conversationId = first.id,
  body = `服务器消息 ${seq}`,
): PlatformMessage => ({
  id: `${conversationId}-message-${seq}`,
  seq,
  conversationId,
  sender: otherMember,
  body,
  createdAt: `2026-10-27T08:${String(seq).padStart(2, '0')}:00Z`,
});
const scene = () => (
  <MemoryRouter initialEntries={['/social?conversation=first']}>
    <AuthContext.Provider value={signedIn()}>
      <PlatformMessagesPage />
    </AuthContext.Provider>
  </MemoryRouter>
);
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('WebSocket', undefined);
  vi.spyOn(platformApi, 'conversations').mockResolvedValue({ items: [first, second], total: 2 });
  vi.spyOn(platformApi, 'messages').mockImplementation(async (id) => ({
    items: [message(1, id)],
    total: 1,
    hasMore: false,
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('account message reliability', () => {
  it('preserves malformed draft data and isolates accounts and conversations', () => {
    const key = messageDraftKey('alice', 'conversation/one');
    localStorage.setItem(key, '{invalid');
    expect(() => readMessageDraft(key)).toThrow('原始数据已保留');
    expect(localStorage.getItem(key)).toBe('{invalid');
    expect(readMessageDraft(messageDraftKey('bob', 'conversation/one'))).toEqual(
      emptyMessageDraft(),
    );
    expect(messageDraftKey('alice:one', 'two')).not.toBe(messageDraftKey('alice', 'one:two'));
  });

  it('keeps failed messages across remount and retries only when requested with the original client ID', async () => {
    const send = vi
      .spyOn(platformApi, 'sendMessage')
      .mockRejectedValueOnce(new ApiError('连接中断', 'NETWORK_ERROR', 0));
    const view = render(scene());
    await screen.findByText('服务器消息 1');
    fireEvent.change(screen.getByRole('textbox', { name: '服务器消息内容' }), {
      target: { value: '这一条不能重复送达' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送服务器消息' }));
    await screen.findByRole('article', { name: '消息尚未确认' });
    const originalId = send.mock.calls[0][2];
    const persisted = readMessageDraft(messageDraftKey(member.id, first.id));
    expect(persisted.pending[0]).toMatchObject({
      clientId: originalId,
      body: '这一条不能重复送达',
    });
    view.unmount();
    render(scene());
    await screen.findByRole('article', { name: '消息尚未确认' });
    expect(send).toHaveBeenCalledOnce();
    const confirmed = {
      ...message(2),
      sender: member,
      body: '这一条不能重复送达',
      clientId: originalId,
    };
    send.mockResolvedValueOnce(confirmed);
    vi.mocked(platformApi.messages).mockResolvedValue({
      items: [message(1), confirmed],
      total: 2,
      hasMore: false,
    });
    fireEvent.click(screen.getByRole('button', { name: /重试发送：这一条不能重复送达/ }));
    await waitFor(() =>
      expect(screen.queryByRole('article', { name: '消息尚未确认' })).not.toBeInTheDocument(),
    );
    expect(send).toHaveBeenLastCalledWith(first.id, '这一条不能重复送达', originalId);
    expect(readMessageDraft(messageDraftKey(member.id, first.id)).pending).toEqual([]);
  });

  it('does not replace a different conversation draft when an earlier send completes late', async () => {
    let finish!: (value: PlatformMessage) => void;
    const send = vi.spyOn(platformApi, 'sendMessage').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(scene());
    await screen.findByText('服务器消息 1');
    fireEvent.change(screen.getByRole('textbox', { name: '服务器消息内容' }), {
      target: { value: '第一场的待发消息' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送服务器消息' }));
    fireEvent.click(screen.getByRole('button', { name: /第二场对话/ }));
    await screen.findByRole('heading', { name: '第二场对话' });
    fireEvent.change(screen.getByRole('textbox', { name: '服务器消息内容' }), {
      target: { value: '第二场的草稿' },
    });
    const confirmed = {
      ...message(2),
      sender: member,
      body: '第一场的待发消息',
      clientId: send.mock.calls[0][2],
    };
    await act(async () => {
      finish(confirmed);
    });
    expect(screen.getByRole('textbox', { name: '服务器消息内容' })).toHaveValue('第二场的草稿');
    expect(screen.queryByText('第一场的待发消息')).not.toBeInTheDocument();
    vi.mocked(platformApi.messages).mockImplementation(async (id) => ({
      items: id === first.id ? [message(1), confirmed] : [message(1, id)],
      total: 2,
      hasMore: false,
    }));
    fireEvent.click(screen.getByRole('button', { name: /第一场对话/ }));
    await screen.findByText('第一场的待发消息', { selector: 'article:not(.pending) p' });
    await waitFor(() =>
      expect(readMessageDraft(messageDraftKey(member.id, first.id)).pending).toEqual([]),
    );
    expect(send).toHaveBeenCalledOnce();
  });

  it('does not send if its client ID and pending body cannot be saved before dispatch', async () => {
    const send = vi.spyOn(platformApi, 'sendMessage');
    render(scene());
    await screen.findByText('服务器消息 1');
    fireEvent.change(screen.getByRole('textbox', { name: '服务器消息内容' }), {
      target: { value: '保留这句话' },
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('存储空间不足', 'QuotaExceededError');
    });
    fireEvent.click(screen.getByRole('button', { name: '发送服务器消息' }));
    await screen.findByRole('alert');
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: '服务器消息内容' })).toHaveValue('保留这句话');
  });

  it('preserves a new draft typed while the preceding message is still sending', async () => {
    let finish!: (value: PlatformMessage) => void;
    const send = vi.spyOn(platformApi, 'sendMessage').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(scene());
    await screen.findByText('服务器消息 1');
    const input = screen.getByRole('textbox', { name: '服务器消息内容' });
    fireEvent.change(input, { target: { value: '正在发送的句子' } });
    fireEvent.click(screen.getByRole('button', { name: '发送服务器消息' }));
    fireEvent.change(input, { target: { value: '接着写的下一句' } });
    await act(async () => {
      finish({
        ...message(2),
        sender: member,
        body: '正在发送的句子',
        clientId: send.mock.calls[0][2],
      });
    });
    expect(input).toHaveValue('接着写的下一句');
    expect(readMessageDraft(messageDraftKey(member.id, first.id)).draft).toBe('接着写的下一句');
  });

  it('does not drop another tab pending message before its storage event is delivered', () => {
    const { result } = renderHook(() => useMessageDraft(member.id, first.id));
    const key = messageDraftKey(member.id, first.id);
    const pending = {
      clientId: 'other-tab-message',
      body: '另一标签页待发',
      createdAt: new Date().toISOString(),
      error: '离线',
    };
    saveMessageDraft(key, { ...emptyMessageDraft(), pending: [pending] });
    act(() => {
      result.current.setDraft('当前标签草稿');
    });
    expect(readMessageDraft(key).pending).toEqual([pending]);
    expect(result.current.state.draft).toBe('当前标签草稿');
  });

  it('merges older history, live messages, and acknowledgments by server ID and sequence', async () => {
    let finish!: (value: MessagePage) => void;
    vi.mocked(platformApi.messages).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useThreadMessages(member.id, first.id, 0));
    act(() => result.current.apply([message(7)], result.current.capturePermission()));
    await act(async () => {
      finish({ items: [message(6)], total: 7, hasMore: true });
    });
    expect(result.current.messages.map((entry) => entry.seq)).toEqual([6, 7]);
    vi.mocked(platformApi.messages).mockResolvedValueOnce({
      items: [message(5)],
      total: 7,
      hasMore: true,
    });
    await act(async () => {
      await result.current.loadOlder();
    });
    expect(platformApi.messages).toHaveBeenLastCalledWith(first.id, expect.any(AbortSignal), {
      beforeSeq: 6,
    });
    expect(result.current.messages.map((entry) => entry.seq)).toEqual([5, 6, 7]);
    vi.mocked(platformApi.messages).mockResolvedValueOnce({
      items: [message(7)],
      total: 7,
      hasMore: false,
    });
    act(() => result.current.refresh());
    await waitFor(() =>
      expect(platformApi.messages).toHaveBeenLastCalledWith(first.id, expect.any(AbortSignal), {
        afterSeq: 6,
      }),
    );
    expect(mergeMessages(result.current.messages, [message(7)]).map((entry) => entry.seq)).toEqual([
      5, 6, 7,
    ]);
  });

  it('revokes both read lanes before ignoring a delayed private history 200 that arrives after membership 404', async () => {
    vi.mocked(platformApi.messages).mockResolvedValueOnce({
      items: [message(6)],
      total: 6,
      hasMore: true,
    });
    const { result } = renderHook(() => useThreadMessages(member.id, first.id, 0));
    await waitFor(() => expect(result.current.messages[0]?.seq).toBe(6));
    let finishHistory!: (value: MessagePage) => void;
    vi.mocked(platformApi.messages).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishHistory = resolve;
        }),
    );
    let history!: Promise<void>;
    act(() => {
      history = result.current.loadOlder();
    });
    const historySignal = vi.mocked(platformApi.messages).mock.calls.at(-1)![1]!;
    const oldPermission = result.current.capturePermission();
    vi.mocked(platformApi.messages).mockRejectedValueOnce(
      new ApiError('你已被移出会话', 'not_found', 404),
    );
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.accessDenied).toBe(true));
    expect(historySignal.aborted).toBe(true);
    expect(result.current.messages).toEqual([]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.historyLoading).toBe(false);
    await act(async () => {
      finishHistory({ items: [message(1, first.id, 'private-history')], total: 6, hasMore: false });
      await history;
    });
    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBe('你已被移出会话');
    expect(result.current.accessDenied).toBe(true);
    act(() => {
      expect(result.current.apply([message(7, first.id, 'old-send-ack')], oldPermission)).toBe(
        false,
      );
      expect(
        result.current.apply(
          [message(8, first.id, 'unconfirmed-update')],
          result.current.capturePermission(),
        ),
      ).toBe(false);
    });
    expect(result.current.messages).toEqual([]);
  });

  it('keeps a delayed successful send unconfirmed after the server revokes membership', async () => {
    let finishSend!: (value: PlatformMessage) => void;
    const send = vi.spyOn(platformApi, 'sendMessage').mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSend = resolve;
        }),
    );
    render(scene());
    await screen.findByText('服务器消息 1');
    fireEvent.change(screen.getByRole('textbox', { name: '服务器消息内容' }), {
      target: { value: '撤销权限前发出的消息' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送服务器消息' }));
    const clientId = send.mock.calls[0][2];
    vi.mocked(platformApi.messages).mockRejectedValueOnce(
      new ApiError('你已被移出会话', 'not_found', 404),
    );
    act(() => window.dispatchEvent(new Event('focus')));
    await screen.findByText('当前无法访问这个会话');
    await act(async () => {
      finishSend({
        ...message(2),
        sender: member,
        body: '撤销权限前发出的消息',
        clientId,
      });
    });
    expect(screen.queryByText('服务器消息 1')).not.toBeInTheDocument();
    expect(
      screen.queryByText('撤销权限前发出的消息', { selector: 'article:not(.pending) p' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: '消息尚未确认' })).toBeInTheDocument();
    expect(readMessageDraft(messageDraftKey(member.id, first.id)).pending[0]).toMatchObject({
      clientId,
      error: expect.stringContaining('会话权限已更新'),
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it('keeps revoked access until a new server read succeeds and never accepts an older epoch after recovery', async () => {
    vi.useFakeTimers();
    vi.mocked(platformApi.messages).mockResolvedValueOnce({
      items: [message(6)],
      total: 6,
      hasMore: true,
    });
    const { result } = renderHook(() => useThreadMessages(member.id, first.id, 0));
    await act(async () => {});
    const oldPermission = result.current.capturePermission();
    let finishHistory!: (value: MessagePage) => void;
    vi.mocked(platformApi.messages).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishHistory = resolve;
        }),
    );
    let history!: Promise<void>;
    act(() => {
      history = result.current.loadOlder();
    });
    vi.mocked(platformApi.messages).mockRejectedValueOnce(
      new ApiError('成员已移除', 'forbidden', 403),
    );
    await act(async () => result.current.refresh());
    expect(result.current.accessDenied).toBe(true);
    let finishRecovery!: (value: MessagePage) => void;
    vi.mocked(platformApi.messages).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRecovery = resolve;
        }),
    );
    act(() => result.current.refresh());
    expect(result.current.accessDenied).toBe(true);
    expect(result.current.messages).toEqual([]);
    await act(async () => {
      finishRecovery({
        items: [message(10, first.id, 'fresh-authorized-history')],
        total: 1,
        hasMore: false,
      });
    });
    expect(result.current.accessDenied).toBe(false);
    expect(result.current.messages.map((entry) => entry.body)).toEqual([
      'fresh-authorized-history',
    ]);
    await act(async () => {
      finishHistory({
        items: [message(1, first.id, 'revoked-private-history')],
        total: 6,
        hasMore: false,
      });
      await history;
    });
    act(() => {
      expect(
        result.current.apply([message(7, first.id, 'old-ack-after-rejoin')], oldPermission),
      ).toBe(false);
    });
    expect(result.current.messages.map((entry) => entry.body)).toEqual([
      'fresh-authorized-history',
    ]);
    vi.mocked(platformApi.messages).mockResolvedValueOnce({
      items: [message(11, first.id, 'new-live-message')],
      total: 2,
      hasMore: false,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    expect(result.current.messages.map((entry) => entry.body)).toEqual([
      'fresh-authorized-history',
      'new-live-message',
    ]);
    expect(platformApi.messages).toHaveBeenLastCalledWith(first.id, expect.any(AbortSignal), {
      afterSeq: 10,
    });
  });
});
