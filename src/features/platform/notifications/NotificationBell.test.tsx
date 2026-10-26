import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { AuthContext, type AuthState } from '../auth-context';
import { member, otherMember, signedIn } from '../platform-test-fixtures';
import { notificationsApi } from './api';
import NotificationBell from './NotificationBell';
import { notificationsChanged } from './notification-events';
import { deferred } from './test-fixtures';
import type { UnreadResult } from './types';

const bell = (auth: AuthState = signedIn()) => (
  <AuthContext.Provider value={auth}>
    <MemoryRouter>
      <NotificationBell />
    </MemoryRouter>
  </AuthContext.Provider>
);
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('real notification bell', () => {
  it('loads only the badge endpoint and keeps the full accessible count when visually capped', async () => {
    const count = vi
      .spyOn(notificationsApi, 'unread')
      .mockResolvedValue({ unreadTotal: 123, throughId: null });
    const list = vi.spyOn(notificationsApi, 'list');
    render(bell());
    expect(await screen.findByRole('link', { name: '通知，123 条未读' })).toHaveAttribute(
      'href',
      '/notifications',
    );
    expect(screen.getByText('99+')).toBeInTheDocument();
    expect(count).toHaveBeenCalledOnce();
    expect(list).not.toHaveBeenCalled();
  });

  it('does not show an unknown count as zero or fetch for guests', async () => {
    const count = vi
      .spyOn(notificationsApi, 'unread')
      .mockRejectedValue(new ApiError('计数服务不可达', 'network', 0));
    const view = render(bell());
    await waitFor(() =>
      expect(screen.getByRole('link')).toHaveAttribute('title', '计数服务不可达'),
    );
    expect(screen.getByRole('link')).toHaveAccessibleName('通知，未读数暂不可用');
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    view.rerender(bell({ ...signedIn(), user: null, status: 'guest' }));
    expect(screen.getByRole('link')).toHaveAccessibleName('通知，登录后查看');
    expect(count).toHaveBeenCalledOnce();
  });

  it('rechecks a changed event but ignores another account and isolates a late old-account badge', async () => {
    const old = deferred<UnreadResult>();
    const count = vi
      .spyOn(notificationsApi, 'unread')
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue({ unreadTotal: 2, throughId: null });
    const view = render(bell());
    await waitFor(() => expect(count).toHaveBeenCalledOnce());
    const signal = count.mock.calls[0][0]!;
    view.rerender(bell(signedIn(otherMember)));
    await screen.findByRole('link', { name: '通知，2 条未读' });
    expect(signal.aborted).toBe(true);
    await act(async () => old.resolve({ unreadTotal: 99, throughId: null }));
    expect(screen.getByRole('link')).toHaveAccessibleName('通知，2 条未读');
    act(() => notificationsChanged({ userId: member.id, unreadTotal: 10 }));
    expect(count).toHaveBeenCalledTimes(2);
    count.mockResolvedValue({ unreadTotal: 1, throughId: null });
    act(() => notificationsChanged({ userId: otherMember.id, unreadTotal: 1 }));
    await screen.findByRole('link', { name: '通知，1 条未读' });
  });

  it('updates by serial visible polling and stops its timer after unmount', async () => {
    vi.useFakeTimers();
    const slow = deferred<UnreadResult>();
    const count = vi
      .spyOn(notificationsApi, 'unread')
      .mockResolvedValueOnce({ unreadTotal: 2, throughId: null })
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValue({ unreadTotal: 0, throughId: null });
    const view = render(bell());
    await act(async () => {});
    expect(screen.getByRole('link')).toHaveAccessibleName('通知，2 条未读');
    await act(async () => vi.advanceTimersByTime(20000));
    await act(async () => vi.advanceTimersByTime(60000));
    expect(count).toHaveBeenCalledTimes(2);
    await act(async () => slow.resolve({ unreadTotal: 1, throughId: null }));
    expect(screen.getByRole('link')).toHaveAccessibleName('通知，1 条未读');
    await act(async () => vi.advanceTimersByTime(20000));
    expect(screen.getByRole('link')).toHaveAccessibleName('通知，0 条未读');
    view.unmount();
    await act(async () => vi.advanceTimersByTime(60000));
    expect(count).toHaveBeenCalledTimes(3);
  });
});
