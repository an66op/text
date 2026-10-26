import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/features/platform/auth-context';
import { member, otherMember, signedIn } from '@/features/platform/platform-test-fixtures';
import { ApiError } from '@/shared/api/client';
import type { PublicUser } from '@/shared/api/types';
import ContactsPage from './ContactsPage';
import FriendshipActions from './FriendshipActions';
import { friendshipApi } from './friendship-api';
import { peopleApi } from './people-api';
import type { Friend, FriendRequest, Relationship } from './friendship-types';
import { privacyApi } from '@/features/platform/privacy/privacy-api';

const incoming: FriendRequest = {
  id: 'request-incoming',
  from: otherMember,
  to: member,
  note: '想一起交流阅读和城市漫游',
  status: 'pending',
  createdAt: '2026-10-27T08:00:00Z',
  updatedAt: '2026-10-27T08:00:00Z',
};
const outgoing: FriendRequest = {
  ...incoming,
  id: 'request-outgoing',
  from: member,
  to: otherMember,
  note: '你好，想认识同频的朋友',
};
const friend: Friend = { user: otherMember, since: '2026-10-27T09:00:00Z' };
const stranger: PublicUser = {
  id: 'stranger',
  name: '目录中的成员',
  handle: 'directory_member',
  avatar: '',
  bio: '还没有互相添加',
};
const contactScene = (user = member, route = '/contacts') => (
  <MemoryRouter initialEntries={[route]}>
    <AuthContext.Provider value={signedIn(user)}>
      <ContactsPage />
    </AuthContext.Provider>
  </MemoryRouter>
);
const relationshipScene = (person: PublicUser = otherMember) => (
  <MemoryRouter>
    <AuthContext.Provider value={signedIn()}>
      <FriendshipActions person={person} />
    </AuthContext.Provider>
  </MemoryRouter>
);
beforeEach(() => {
  vi.stubGlobal('WebSocket', undefined);
  vi.spyOn(privacyApi, 'capabilities').mockImplementation(async (userId) => ({
    userId,
    blockedByMe: false,
    canMessage: true,
    canInvite: true,
    canRequestFriend: true,
    revision: 0,
  }));
  vi.spyOn(friendshipApi, 'friends').mockResolvedValue({ items: [friend], total: 1 });
  vi.spyOn(friendshipApi, 'requests').mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(friendshipApi, 'relationship').mockResolvedValue({ status: 'none' });
  vi.spyOn(peopleApi, 'directory').mockResolvedValue({ items: [stranger], total: 1 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('real friendships and applications', () => {
  it('does not confuse refusing new applications with refusing an existing incoming application', async () => {
    vi.mocked(friendshipApi.relationship).mockResolvedValue({
      status: 'incoming',
      request: incoming,
    });
    vi.mocked(privacyApi.capabilities).mockResolvedValue({
      userId: otherMember.id,
      blockedByMe: false,
      canMessage: false,
      canRequestFriend: false,
      canInvite: false,
      revision: 2,
    });
    const respond = vi
      .spyOn(friendshipApi, 'respond')
      .mockResolvedValue({ ...incoming, status: 'accepted' });
    render(relationshipScene());
    const accept = await screen.findByRole('button', { name: '接受申请' });
    expect(accept).toBeEnabled();
    fireEvent.click(accept);
    await waitFor(() => expect(respond).toHaveBeenCalledWith(incoming.id, 'accept'));
  });
  it('keeps decline available when a known own block forbids accepting the pending application', async () => {
    vi.mocked(friendshipApi.relationship).mockResolvedValue({
      status: 'incoming',
      request: incoming,
    });
    vi.mocked(privacyApi.capabilities).mockResolvedValue({
      userId: otherMember.id,
      blockedByMe: true,
      canMessage: false,
      canRequestFriend: false,
      canInvite: false,
      revision: 2,
    });
    render(relationshipScene());
    await waitFor(() => expect(screen.getByRole('button', { name: '接受申请' })).toBeDisabled());
    expect(screen.getByRole('button', { name: '拒绝申请' })).toBeEnabled();
  });
  it('keeps the true friend list separate from member discovery', async () => {
    render(contactScene());
    await screen.findByText(otherMember.name);
    expect(screen.getByRole('tab', { name: '好友' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText(stranger.name)).not.toBeInTheDocument();
    expect(peopleApi.directory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: '发现' }));
    await screen.findByText(stranger.name);
    expect(
      screen.getByText('成员目录展示已加入共鸣的账号，目录中的成员不会自动成为好友。'),
    ).toBeInTheDocument();
    expect(screen.queryByText(otherMember.name)).not.toBeInTheDocument();
  });

  it('accepts an incoming application only after the server confirms and refreshes its pending badge', async () => {
    let isPending = true;
    vi.mocked(friendshipApi.requests).mockImplementation(async (direction) => ({
      items: direction === 'incoming' && isPending ? [incoming] : [],
      total: direction === 'incoming' && isPending ? 1 : 0,
    }));
    let finish!: (value: FriendRequest) => void;
    const respond = vi.spyOn(friendshipApi, 'respond').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(contactScene(member, '/contacts?tab=requests'));
    await screen.findByRole('button', { name: `接受${otherMember.name}的申请` });
    expect(await screen.findByLabelText('1 条待处理申请')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `接受${otherMember.name}的申请` }));
    expect(screen.queryByText(`已与 ${otherMember.name} 成为好友`)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: `接受${otherMember.name}的申请` })).toBeDisabled();
    await act(async () => {
      isPending = false;
      finish({ ...incoming, status: 'accepted' });
    });
    await screen.findByText(`已与 ${otherMember.name} 成为好友`);
    await waitFor(() => expect(screen.queryByLabelText('1 条待处理申请')).not.toBeInTheDocument());
    expect(respond).toHaveBeenCalledExactlyOnceWith(incoming.id, 'accept');
  });

  it('does not pretend a denied outgoing cancellation succeeded', async () => {
    vi.mocked(friendshipApi.requests).mockImplementation(async (direction) => ({
      items: direction === 'outgoing' ? [outgoing] : [],
      total: direction === 'outgoing' ? 1 : 0,
    }));
    const respond = vi
      .spyOn(friendshipApi, 'respond')
      .mockRejectedValue(new ApiError('只能撤销自己发出的申请', 'forbidden', 403));
    render(contactScene(member, '/contacts?tab=requests'));
    fireEvent.click(screen.getByRole('button', { name: /发出/ }));
    await screen.findByText(outgoing.note);
    expect(screen.queryByRole('button', { name: /接受.*的申请/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `撤销发给${otherMember.name}的申请` }));
    expect(await screen.findByRole('alert')).toHaveTextContent('只能撤销自己发出的申请');
    expect(screen.getByText(outgoing.note)).toBeInTheDocument();
    expect(screen.queryByText(`已撤销发给 ${otherMember.name} 的申请`)).not.toBeInTheDocument();
    expect(respond).toHaveBeenCalledWith(outgoing.id, 'cancel');
  });

  it('sends a note with the explicit target member and permits cancelling the returned outgoing request', async () => {
    let relation: Relationship = { status: 'none' };
    vi.mocked(friendshipApi.relationship).mockImplementation(async () => relation);
    const request = vi.spyOn(friendshipApi, 'request').mockImplementation(async () => {
      relation = { status: 'outgoing', request: outgoing };
      return outgoing;
    });
    const respond = vi.spyOn(friendshipApi, 'respond').mockImplementation(async () => {
      relation = { status: 'none' };
      return { ...outgoing, status: 'cancelled' };
    });
    render(relationshipScene());
    fireEvent.click(await screen.findByRole('button', { name: '添加好友' }));
    const note = screen.getByRole('textbox', { name: '申请说明' });
    expect(note).toHaveAttribute('maxlength', '300');
    fireEvent.change(note, { target: { value: '  一起交流读书心得吧  ' } });
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '发送申请' }));
    await screen.findByText('等待对方验证');
    expect(request).toHaveBeenCalledWith(otherMember.id, '一起交流读书心得吧');
    fireEvent.click(screen.getByRole('button', { name: '撤销申请' }));
    await screen.findByRole('button', { name: '添加好友' });
    expect(respond).toHaveBeenCalledWith(outgoing.id, 'cancel');
  });

  it('requires a concrete second confirmation for removing a friend and retains the relationship after failure', async () => {
    let relation: Relationship = { status: 'incoming', request: incoming };
    vi.mocked(friendshipApi.relationship).mockImplementation(async () => relation);
    const respond = vi.spyOn(friendshipApi, 'respond').mockImplementation(async () => {
      relation = { status: 'friends', since: friend.since };
      return { ...incoming, status: 'accepted' };
    });
    const remove = vi
      .spyOn(friendshipApi, 'remove')
      .mockRejectedValueOnce(new ApiError('服务暂时不可达', 'NETWORK_ERROR', 0));
    render(relationshipScene());
    fireEvent.click(await screen.findByRole('button', { name: '接受申请' }));
    await screen.findByText('已是好友');
    expect(respond).toHaveBeenCalledWith(incoming.id, 'accept');
    fireEvent.click(screen.getByRole('button', { name: '移除好友' }));
    let dialog = await screen.findByRole('dialog', { name: `移除 ${otherMember.name}？` });
    expect(dialog).toHaveTextContent(`确定移除 @${otherMember.handle} 的好友关系吗`);
    expect(dialog).toHaveTextContent('已有会话会保留');
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '移除好友' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '确认移除' }));
    await within(dialog).findByRole('alert');
    expect(screen.getByText('已是好友')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    remove.mockImplementationOnce(async () => {
      relation = { status: 'none' };
      return { ok: true };
    });
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: '确认移除' })).toBeEnabled(),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: '确认移除' }));
    await screen.findByRole('button', { name: '添加好友' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('ignores a previous member application response while preserving the new member note', async () => {
    let finish!: (value: FriendRequest) => void;
    vi.spyOn(friendshipApi, 'request').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(relationshipScene());
    fireEvent.click(await screen.findByRole('button', { name: '添加好友' }));
    fireEvent.change(screen.getByRole('textbox', { name: '申请说明' }), {
      target: { value: '给第一位成员的申请' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送申请' }));
    view.rerender(relationshipScene(stranger));
    fireEvent.click(await screen.findByRole('button', { name: '添加好友' }));
    fireEvent.change(screen.getByRole('textbox', { name: '申请说明' }), {
      target: { value: '给当前成员的草稿' },
    });
    await act(async () => {
      finish(outgoing);
    });
    expect(screen.getByRole('textbox', { name: '申请说明' })).toHaveValue('给当前成员的草稿');
    expect(screen.queryByText('好友申请已发送，等待对方确认')).not.toBeInTheDocument();
  });

  it('does not replace the new account friend list with a cancelled old-account response', async () => {
    let finish!: (value: { items: Friend[]; total: number }) => void;
    vi.mocked(friendshipApi.friends)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({ items: [{ ...friend, user: stranger }], total: 1 });
    const view = render(contactScene());
    view.rerender(contactScene(otherMember));
    await screen.findByText(stranger.name);
    await act(async () => {
      finish({ items: [friend], total: 1 });
    });
    expect(screen.getByText(stranger.name)).toBeInTheDocument();
    expect(screen.queryByText(otherMember.name)).not.toBeInTheDocument();
  });

  it('does not expose relationship mutation controls for your own member profile', () => {
    render(relationshipScene(member));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(friendshipApi.relationship).not.toHaveBeenCalled();
  });
});
