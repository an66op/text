import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import type { Conversation } from '@/shared/api/types';
import { AuthContext } from '../auth-context';
import { member, otherMember, signedIn } from '../platform-test-fixtures';
import ConversationDetailsPage from './ConversationDetailsPage';
import { conversationApi, type ConversationDetails } from './conversation-api';
import MemberPicker from './MemberPicker';

const stream = vi.hoisted(() => ({
  onEvent: undefined as ((event: { type: string; conversationId?: string }) => void) | undefined,
}));
vi.mock('../messages/usePlatformStream', () => ({
  usePlatformStream: (_userId: string, callback: typeof stream.onEvent) => {
    stream.onEvent = callback;
    return 'live';
  },
}));

const third = { ...member, id: 'third', name: '第三位成员', handle: 'third' };
const group: Conversation = {
  id: 'group-one',
  kind: 'group',
  title: '小岛会客厅',
  ownerId: member.id,
  members: [member.id, otherMember.id],
  createdAt: '2026-10-27T08:00:00Z',
};
const details = (conversation = group): ConversationDetails => ({
  conversation,
  memberProfiles: [member, otherMember].filter((person) =>
    conversation.members.includes(person.id),
  ),
});
const scene = (user = member) => (
  <MemoryRouter initialEntries={['/messages/group-one/details']}>
    <AuthContext.Provider value={signedIn(user)}>
      <Routes>
        <Route path="/messages/:conversationId/details" element={<ConversationDetailsPage />} />
        <Route path="/social" element={<p>已回到消息列表</p>} />
      </Routes>
    </AuthContext.Provider>
  </MemoryRouter>
);

beforeEach(() => {
  stream.onEvent = undefined;
  vi.stubGlobal('WebSocket', undefined);
  vi.spyOn(conversationApi, 'details').mockResolvedValue(details());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('server conversation management', () => {
  it('shows a non-owner only member access and an explicit leave confirmation', async () => {
    const leave = vi.spyOn(conversationApi, 'leave').mockResolvedValue({ ok: true });
    render(scene(otherMember));
    await screen.findByRole('heading', { name: group.title });
    expect(screen.queryByLabelText('聊天名称')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '退出群组' }));
    const modal = screen.getByRole('dialog', { name: '退出群组' });
    expect(within(modal).getByText(/再次加入需要管理者添加/)).toBeInTheDocument();
    expect(leave).not.toHaveBeenCalled();
    fireEvent.click(within(modal).getByRole('button', { name: '确认退出' }));
    await screen.findByText('已回到消息列表');
    expect(leave).toHaveBeenCalledExactlyOnceWith(group.id);
  });

  it('changes the owner only after review and removes management controls after transfer', async () => {
    const next = { ...group, ownerId: otherMember.id };
    const transfer = vi.spyOn(conversationApi, 'transfer').mockResolvedValue(next);
    render(scene());
    await screen.findByLabelText('聊天名称');
    fireEvent.click(screen.getByRole('button', { name: '转交给另一位成员' }));
    const modal = screen.getByRole('dialog', { name: '转交群组' });
    expect(transfer).not.toHaveBeenCalled();
    expect(within(modal).getByText(/你会成为普通成员/)).toBeInTheDocument();
    vi.mocked(conversationApi.details).mockResolvedValue(details(next));
    fireEvent.click(within(modal).getByRole('button', { name: '确认转交' }));
    await screen.findByText('管理身份已转交');
    expect(transfer).toHaveBeenCalledExactlyOnceWith(group.id, otherMember.id);
    expect(screen.queryByLabelText('聊天名称')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '退出群组' })).toBeInTheDocument();
  });

  it('keeps a rejected remove visible inside the modal and does not optimistically discard the member', async () => {
    vi.spyOn(conversationApi, 'remove').mockRejectedValue(
      new ApiError('管理身份已变更', 'forbidden', 403),
    );
    render(scene());
    await screen.findByLabelText('聊天名称');
    fireEvent.click(screen.getByRole('button', { name: '移除另一位成员' }));
    const modal = screen.getByRole('dialog', { name: '移除成员' });
    fireEvent.click(within(modal).getByRole('button', { name: '确认移除' }));
    await within(modal).findByRole('alert');
    expect(within(modal).getByText('管理身份已变更')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /另一位成员/ })).toBeInTheDocument();
    expect(within(modal).getByRole('button', { name: '确认移除' })).toBeEnabled();
  });

  it('clears private membership details when a later refresh denies access', async () => {
    render(scene());
    await screen.findByRole('heading', { name: group.title });
    vi.mocked(conversationApi.details).mockRejectedValue(
      new ApiError('你尚未加入', 'not_found', 404),
    );
    fireEvent.focus(window);
    await screen.findByText('你尚未加入');
    expect(screen.queryByRole('link', { name: /另一位成员/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: group.title })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('聊天名称')).not.toBeInTheDocument();
  });

  it('ignores an old private response when the account changes before it resolves', async () => {
    let resolve!: (value: ConversationDetails) => void;
    vi.mocked(conversationApi.details)
      .mockImplementationOnce(
        () =>
          new Promise((finish) => {
            resolve = finish;
          }),
      )
      .mockRejectedValue(new ApiError('你尚未加入', 'not_found', 404));
    const view = render(scene());
    await waitFor(() => expect(conversationApi.details).toHaveBeenCalledOnce());
    view.rerender(scene(third));
    await screen.findByText('你尚未加入');
    await act(async () => {
      resolve(details());
    });
    expect(screen.queryByRole('heading', { name: group.title })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /另一位成员/ })).not.toBeInTheDocument();
  });

  it('never shows member management on a direct conversation', async () => {
    vi.mocked(conversationApi.details).mockResolvedValue(details({ ...group, kind: 'direct' }));
    render(scene());
    await screen.findByRole('heading', { name: group.title });
    expect(screen.queryByLabelText('聊天名称')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /移除|转交|退出|添加/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回到对话' })).toHaveAttribute(
      'href',
      '/social?conversation=group-one',
    );
  });

  it('closes an outdated removal confirmation when ownership changes on another device', async () => {
    const remove = vi.spyOn(conversationApi, 'remove');
    render(scene());
    await screen.findByLabelText('聊天名称');
    fireEvent.click(screen.getByRole('button', { name: '移除另一位成员' }));
    expect(screen.getByRole('dialog', { name: '移除成员' })).toBeInTheDocument();
    vi.mocked(conversationApi.details).mockResolvedValue(
      details({ ...group, ownerId: otherMember.id }),
    );
    fireEvent.focus(window);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByLabelText('聊天名称')).not.toBeInTheDocument();
    expect(screen.getByText('成员或管理身份已变化，请重新选择操作')).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
  });

  it('does not starve an in-flight detail request with ordinary chat notifications', async () => {
    let resolve!: (value: ConversationDetails) => void;
    vi.mocked(conversationApi.details).mockImplementationOnce(
      () =>
        new Promise((finish) => {
          resolve = finish;
        }),
    );
    render(scene());
    await waitFor(() => expect(conversationApi.details).toHaveBeenCalledOnce());
    act(() => {
      for (let index = 0; index < 20; index += 1) {
        stream.onEvent?.({ type: 'message.created', conversationId: group.id });
        stream.onEvent?.({ type: 'conversation.read', conversationId: group.id });
      }
    });
    await act(async () => {
      resolve(details());
    });
    await screen.findByRole('heading', { name: group.title });
    expect(conversationApi.details).toHaveBeenCalledOnce();
    act(() => stream.onEvent?.({ type: 'conversation.updated', conversationId: group.id }));
    await waitFor(() => expect(conversationApi.details).toHaveBeenCalledTimes(2));
  });
});

describe('member candidate selection', () => {
  it('can paginate past existing members without selecting them again', async () => {
    vi.spyOn(conversationApi, 'candidates')
      .mockResolvedValueOnce({ items: [member, otherMember], total: 3 })
      .mockResolvedValueOnce({ items: [third], total: 3 });
    const add = vi.fn();
    render(<MemberPicker existingIds={group.members} busy={false} onAdd={add} onClose={vi.fn()} />);
    const more = await screen.findByRole('button', { name: '查看更多成员' });
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    fireEvent.click(more);
    fireEvent.click(await screen.findByRole('checkbox', { name: /第三位成员/ }));
    fireEvent.click(screen.getByRole('button', { name: '添加 1 位成员' }));
    expect(add).toHaveBeenCalledExactlyOnceWith([third.id]);
    expect(conversationApi.candidates).toHaveBeenLastCalledWith('', 2, expect.any(AbortSignal));
  });
});
