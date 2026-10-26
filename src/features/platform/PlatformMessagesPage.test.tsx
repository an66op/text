import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { platformApi } from '@/shared/api/platformApi';
import { ApiError } from '@/shared/api/client';
import type { Conversation } from '@/shared/api/types';
import { AuthContext } from './auth-context';
import PlatformMessagesPage from './PlatformMessagesPage';
import { member, otherMember, signedIn } from './platform-test-fixtures';

const conversation: Conversation = {
  id: 'channel-one',
  title: '共鸣播报',
  kind: 'channel',
  members: [member.id, otherMember.id],
  ownerId: otherMember.id,
  createdAt: '2026-10-27T08:00:00Z',
};
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('WebSocket', undefined);
  vi.spyOn(platformApi, 'conversations').mockResolvedValue({ items: [conversation], total: 1 });
  vi.spyOn(platformApi, 'messages').mockResolvedValue({
    items: [
      {
        id: 'message-one',
        seq: 1,
        conversationId: conversation.id,
        sender: otherMember,
        body: '欢迎加入频道',
        createdAt: '2026-10-27T08:00:00Z',
      },
    ],
    total: 1,
  });
  vi.spyOn(platformApi, 'directory').mockResolvedValue({ items: [member, otherMember], total: 2 });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const view = (route = '/messages', user = member) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <AuthContext.Provider value={signedIn(user)}>
        <PlatformMessagesPage />
      </AuthContext.Provider>
    </MemoryRouter>,
  );

describe('account communications', () => {
  it('requires a session and never loads private conversations for guests', () => {
    render(
      <MemoryRouter>
        <PlatformMessagesPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: '登录' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fmessages',
    );
    expect(platformApi.conversations).not.toHaveBeenCalled();
  });

  it('shows a member-only channel as read-only while allowing owners to publish', async () => {
    const rendered = view('/messages?conversation=channel-one');
    await screen.findByText('欢迎加入频道');
    expect(screen.getByText('你已加入频道，只有频道主和管理员可以发布消息')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '服务器消息内容' })).not.toBeInTheDocument();
    rendered.unmount();
    view('/messages?conversation=channel-one', otherMember);
    await screen.findByText('欢迎加入频道');
    expect(screen.getByRole('textbox', { name: '服务器消息内容' })).toBeInTheDocument();
  });

  it('keeps a failed send draft and applies only the returned server message', async () => {
    const send = vi
      .spyOn(platformApi, 'sendMessage')
      .mockRejectedValueOnce(new ApiError('没有发布权限', 'forbidden', 403));
    view('/messages?conversation=channel-one', otherMember);
    await screen.findByText('欢迎加入频道');
    fireEvent.change(screen.getByRole('textbox', { name: '服务器消息内容' }), {
      target: { value: '新的播报' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送服务器消息' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('textbox', { name: '服务器消息内容' })).toHaveValue('');
    expect(screen.getByRole('article', { name: '消息尚未确认' })).toHaveTextContent('新的播报');
    expect(
      screen.queryByText('新的播报', { selector: 'article:not(.pending) p' }),
    ).not.toBeInTheDocument();
    const clientId = send.mock.calls[0][2];
    send.mockResolvedValueOnce({
      id: 'message-two',
      seq: 2,
      clientId,
      conversationId: conversation.id,
      sender: otherMember,
      body: '新的播报',
      createdAt: '2026-10-27T09:00:00Z',
    });
    vi.mocked(platformApi.messages).mockResolvedValue({
      items: [
        {
          id: 'message-two',
          seq: 2,
          clientId,
          conversationId: conversation.id,
          sender: otherMember,
          body: '新的播报',
          createdAt: '2026-10-27T09:00:00Z',
        },
      ],
      total: 1,
    });
    fireEvent.click(screen.getByRole('button', { name: '重试发送：新的播报' }));
    await screen.findByText('新的播报', { selector: 'article:not(.pending) p' });
    expect(screen.getByRole('textbox', { name: '服务器消息内容' })).toHaveValue('');
    expect(send).toHaveBeenLastCalledWith(conversation.id, '新的播报', clientId);
  });

  it('creates a group from server directory identities', async () => {
    const create = vi.spyOn(platformApi, 'createConversation').mockResolvedValue({
      ...conversation,
      id: 'group-one',
      kind: 'group',
      title: '周末小队',
      ownerId: member.id,
    });
    view();
    await screen.findByRole('button', { name: /共鸣播报/ });
    fireEvent.click(screen.getByRole('button', { name: '创建会话' }));
    const dialog = await screen.findByRole('dialog', { name: '创建会话' });
    fireEvent.click(within(dialog).getByRole('button', { name: '群组' }));
    await within(dialog).findByText(otherMember.name);
    fireEvent.change(within(dialog).getByRole('textbox', { name: '群组名称' }), {
      target: { value: '周末小队' },
    });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /另一位成员/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: '创建群组' }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        title: '周末小队',
        kind: 'group',
        memberIds: [otherMember.id],
      }),
    );
  });

  it('does not overlap polling requests and cancels read requests on unmount', async () => {
    let finish!: (value: { items: Conversation[]; total: number }) => void;
    vi.mocked(platformApi.conversations).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.useFakeTimers();
    const rendered = view();
    expect(platformApi.conversations).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(platformApi.conversations).toHaveBeenCalledOnce();
    await act(async () => {
      finish({ items: [conversation], total: 1 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(platformApi.conversations).toHaveBeenCalledTimes(2);
    const signal = vi.mocked(platformApi.conversations).mock.calls[1][0];
    rendered.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('clears message content on server membership denial', async () => {
    vi.mocked(platformApi.messages).mockRejectedValue(
      new ApiError('你不是会话成员', 'forbidden', 403),
    );
    view('/messages?conversation=channel-one', otherMember);
    await screen.findByText('你不是会话成员');
    expect(screen.queryByText('欢迎加入频道')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '服务器消息内容' })).not.toBeInTheDocument();
  });
});
