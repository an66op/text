import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/features/platform/auth-context';
import { member, otherMember, signedIn } from '@/features/platform/platform-test-fixtures';
import ContactsPage from './ContactsPage';
import FriendRequestsPanel from './FriendRequestsPanel';
import FriendshipActions from './FriendshipActions';
import { friendshipApi } from './friendship-api';
import type { FriendRequest, Relationship } from './friendship-types';
import { privacyApi } from '@/features/platform/privacy/privacy-api';

const incoming: FriendRequest = {
  id: 'live-incoming',
  from: otherMember,
  to: member,
  note: '前台新收到的申请',
  status: 'pending',
  createdAt: '2026-10-27T08:00:00Z',
  updatedAt: '2026-10-27T08:00:00Z',
};
const flush = async (milliseconds = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', undefined);
  vi.spyOn(privacyApi, 'capabilities').mockImplementation(async (userId) => ({
    userId,
    blockedByMe: false,
    canMessage: true,
    canInvite: true,
    canRequestFriend: true,
    revision: 0,
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('visible friendship refresh consistency', () => {
  it('shows new incoming applications with the refreshed badge without requiring a focus change', async () => {
    let items: FriendRequest[] = [];
    const requests = vi.spyOn(friendshipApi, 'requests').mockImplementation(async (direction) => ({
      items: direction === 'incoming' ? items : [],
      total: direction === 'incoming' ? items.length : 0,
    }));
    render(
      <MemoryRouter initialEntries={['/contacts?tab=requests']}>
        <AuthContext.Provider value={signedIn()}>
          <ContactsPage />
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    await flush();
    expect(screen.getByText('暂时没有待处理申请')).toBeInTheDocument();
    expect(screen.queryByLabelText('1 条待处理申请')).not.toBeInTheDocument();
    items = [incoming];
    await flush(30000);
    expect(screen.getByLabelText('1 条待处理申请')).toBeInTheDocument();
    expect(screen.getByText(incoming.note)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `接受${otherMember.name}的申请` })).toBeEnabled();
    expect(requests.mock.calls.some(([, , , limit]) => limit === 1)).toBe(true);
    expect(requests.mock.calls.some(([, , , limit]) => limit === undefined)).toBe(true);
    expect(screen.getByRole('button', { name: '刷新好友申请' })).toBeEnabled();
  });

  it('replaces stale pending buttons even when the total stays the same', async () => {
    let items = [incoming];
    vi.spyOn(friendshipApi, 'requests').mockImplementation(async () => ({ items, total: 1 }));
    render(
      <MemoryRouter>
        <FriendRequestsPanel incoming={1} outgoing={0} />
      </MemoryRouter>,
    );
    await flush();
    expect(screen.getByText(incoming.note)).toBeInTheDocument();
    items = [
      {
        ...incoming,
        id: 'another-pending',
        note: '相同数量的新申请',
        from: { ...otherMember, name: '新发起人' },
      },
    ];
    await flush(30000);
    expect(screen.queryByText(incoming.note)).not.toBeInTheDocument();
    expect(screen.getByText('相同数量的新申请')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '接受新发起人的申请' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: `接受${otherMember.name}的申请` }),
    ).not.toBeInTheDocument();
  });

  it('does not overlap pending list polls and aborts a live request when leaving the page', async () => {
    let finish!: (value: { items: FriendRequest[]; total: number }) => void;
    const requests = vi.spyOn(friendshipApi, 'requests').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(
      <MemoryRouter>
        <FriendRequestsPanel incoming={null} outgoing={null} />
      </MemoryRouter>,
    );
    await flush(90000);
    expect(requests).toHaveBeenCalledOnce();
    await act(async () => {
      finish({ items: [incoming], total: 1 });
    });
    await flush(30000);
    expect(requests).toHaveBeenCalledTimes(2);
    const signal = requests.mock.calls[1][2];
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await flush(90000);
    expect(requests).toHaveBeenCalledTimes(2);
  });

  it('updates a profile from outgoing verification to confirmed friendship while it remains visible', async () => {
    let relation: Relationship = {
      status: 'outgoing',
      request: { ...incoming, from: member, to: otherMember },
    };
    const relationship = vi
      .spyOn(friendshipApi, 'relationship')
      .mockImplementation(async () => relation);
    render(
      <AuthContext.Provider value={signedIn()}>
        <FriendshipActions person={otherMember} />
      </AuthContext.Provider>,
    );
    await flush();
    expect(screen.getByText('等待对方验证')).toBeInTheDocument();
    relation = { status: 'friends', since: '2026-10-27T09:00:00Z' };
    await flush(30000);
    expect(screen.getByText('已是好友')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '撤销申请' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新好友关系' })).toBeEnabled();
    expect(relationship).toHaveBeenCalledTimes(2);
  });
});
