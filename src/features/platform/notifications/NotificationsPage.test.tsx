import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { AuthContext, type AuthState } from '../auth-context';
import { member, otherMember, signedIn } from '../platform-test-fixtures';
import { notificationsApi } from './api';
import { NOTIFICATIONS_CHANGED, notificationsChanged } from './notification-events';
import NotificationsPage from './NotificationsPage';
import type { NotificationsPageResult, ReadAllResult, ReadResult } from './types';
import { deferred, notice, readAt, result } from './test-fixtures';
import { useNotificationInbox } from './useNotificationInbox';

const page = (path = '/notifications', auth: AuthState = signedIn()) => (
  <AuthContext.Provider value={auth}>
    <MemoryRouter initialEntries={[path]}>
      <NotificationsPage />
    </MemoryRouter>
  </AuthContext.Provider>
);
beforeEach(() => {
  vi.spyOn(notificationsApi, 'list').mockResolvedValue(result());
});
afterEach(() => vi.restoreAllMocks());

describe('server notification inbox', () => {
  it('has distinct loading, empty and retryable server error states', async () => {
    const first = deferred<NotificationsPageResult>();
    vi.mocked(notificationsApi.list)
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(new ApiError('通知服务暂不可用', 'unavailable', 503))
      .mockResolvedValue(result([]));
    render(page());
    expect(screen.getByText('正在读取通知…')).toBeInTheDocument();
    await act(async () => first.resolve(result([])));
    await screen.findByText('暂无通知');
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await screen.findByText('通知服务暂不可用');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await screen.findByText('暂无通知');
  });

  it.each(['guest', 'checking', 'unavailable'] as const)(
    'does not fetch another inbox in auth state %s',
    async (status) => {
      const auth: AuthState = {
        ...signedIn(),
        user: null,
        status,
        error: status === 'unavailable' ? '账号连接已断开' : '',
      };
      render(page('/notifications?unread=true', auth));
      expect(notificationsApi.list).not.toHaveBeenCalled();
      if (status === 'guest')
        expect(screen.getByRole('link', { name: '登录' })).toHaveAttribute(
          'href',
          '/login?returnTo=%2Fnotifications%3Funread%3Dtrue',
        );
      else
        expect(
          screen.getByText(status === 'checking' ? '正在验证账号…' : '账号连接已断开'),
        ).toBeInTheDocument();
    },
  );

  it('uses server category, unread and pagination filters and resets the page when a filter changes', async () => {
    vi.mocked(notificationsApi.list).mockResolvedValue(
      result([notice], { total: 21, unreadTotal: 4 }),
    );
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: '下一页' }));
    await waitFor(() =>
      expect(notificationsApi.list).toHaveBeenLastCalledWith(
        { category: 'all', unread: false, limit: 20, offset: 20 },
        expect.any(AbortSignal),
      ),
    );
    fireEvent.click(screen.getByRole('tab', { name: '互动' }));
    await waitFor(() =>
      expect(notificationsApi.list).toHaveBeenLastCalledWith(
        { category: 'interactions', unread: false, limit: 20, offset: 0 },
        expect.any(AbortSignal),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /未读4/ }));
    await waitFor(() =>
      expect(notificationsApi.list).toHaveBeenLastCalledWith(
        { category: 'interactions', unread: true, limit: 20, offset: 0 },
        expect.any(AbortSignal),
      ),
    );
    expect(screen.getByRole('tab', { name: '互动' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps a notification unread and leaves an independently authorized target link after a network write failure', async () => {
    const read = vi
      .spyOn(notificationsApi, 'read')
      .mockRejectedValue(new ApiError('连接已中断，请重试', 'network', 0));
    render(page());
    const item = await screen.findByRole('article', { name: '圈子评论' });
    fireEvent.click(within(item).getByRole('button', { name: '标为已读' }));
    await screen.findByText('连接已中断，请重试');
    expect(within(item).getByLabelText('未读')).toBeInTheDocument();
    expect(within(item).queryByText('已读')).not.toBeInTheDocument();
    expect(within(item).getByRole('link', { name: '查看' })).toHaveAttribute(
      'href',
      `/circles/s/circle_${'b'.repeat(32)}/posts/cpost_${'c'.repeat(32)}`,
    );
    expect(read).toHaveBeenCalledOnce();
  });

  it('applies the server readAt only after acknowledgement and rejects a pre-read GET that arrives later', async () => {
    const stale = deferred<NotificationsPageResult>(),
      fresh = deferred<NotificationsPageResult>(),
      write = deferred<ReadResult>();
    vi.mocked(notificationsApi.list)
      .mockResolvedValueOnce(result())
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);
    vi.spyOn(notificationsApi, 'read').mockReturnValue(write.promise);
    render(page());
    let item = await screen.findByRole('article', { name: '圈子评论' });
    act(() => notificationsChanged({ userId: member.id, unreadTotal: 1, source: 'another-view' }));
    await waitFor(() => expect(notificationsApi.list).toHaveBeenCalledTimes(2));
    fireEvent.click(within(item).getByRole('button', { name: '标为已读' }));
    expect(within(item).getByLabelText('未读')).toBeInTheDocument();
    await act(async () => write.resolve({ ok: true, unreadTotal: 0, readAt }));
    expect(within(item).getByText('已读')).toBeInTheDocument();
    await act(async () => stale.resolve(result()));
    expect(notificationsApi.list).toHaveBeenCalledTimes(3);
    item = screen.getByRole('article', { name: '圈子评论' });
    expect(within(item).getByText('已读')).toBeInTheDocument();
    expect(within(item).queryByLabelText('未读')).not.toBeInTheDocument();
    await act(async () => fresh.resolve(result([{ ...notice, readAt }], { unreadTotal: 0 })));
  });

  it('replaces redacted items as a whole and never restores their old context from a late read receipt', async () => {
    const write = deferred<ReadResult>();
    const hidden = { ...notice, available: false };
    vi.spyOn(notificationsApi, 'read').mockReturnValue(write.promise);
    render(page());
    fireEvent.click(
      within(await screen.findByRole('article', { name: '圈子评论' })).getByRole('button', {
        name: '标为已读',
      }),
    );
    vi.mocked(notificationsApi.list).mockResolvedValue(result([hidden]));
    act(() => window.dispatchEvent(new Event('focus')));
    await screen.findByText('原内容当前不可访问');
    expect(screen.queryByText(notice.context!.title)).not.toBeInTheDocument();
    expect(screen.queryByText(otherMember.name)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '查看' })).not.toBeInTheDocument();
    await act(async () => write.resolve({ ok: true, unreadTotal: 0, readAt }));
    expect(screen.getAllByText('原内容当前不可访问')).toHaveLength(1);
    expect(screen.queryByText(notice.context!.excerpt)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '查看' })).not.toBeInTheDocument();
  });

  it.each([401, 403, 404, 409])(
    'clears private projections on a denied read (%s) and blocks an older GET',
    async (status) => {
      const stale = deferred<NotificationsPageResult>(),
        fresh = deferred<NotificationsPageResult>();
      vi.mocked(notificationsApi.list)
        .mockResolvedValueOnce(result())
        .mockReturnValueOnce(stale.promise)
        .mockReturnValueOnce(fresh.promise);
      vi.spyOn(notificationsApi, 'read').mockRejectedValue(
        new ApiError('账号或权限已变化', 'account_changed', status),
      );
      render(page());
      const item = await screen.findByRole('article', { name: '圈子评论' });
      act(() => notificationsChanged({ userId: member.id, unreadTotal: 1, source: 'other' }));
      fireEvent.click(within(item).getByRole('button', { name: '标为已读' }));
      await screen.findByText('账号或权限已变化');
      expect(screen.queryByText(notice.context!.title)).not.toBeInTheDocument();
      await act(async () => stale.resolve(result()));
      expect(notificationsApi.list).toHaveBeenCalledTimes(3);
      expect(screen.queryByText(notice.context!.title)).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: '查看' })).not.toBeInTheDocument();
      await act(async () =>
        fresh.resolve(
          result([{ ...notice, available: false, actor: null, context: null, target: null }]),
        ),
      );
      await screen.findByText('原内容当前不可访问');
    },
  );

  it('uses the clicked list snapshot upper bound and preserves a newer notification arriving during read-all', async () => {
    const upperBound = `notice_${'d'.repeat(32)}`,
      nextId = `notice_${'e'.repeat(32)}`;
    const next = { ...notice, id: nextId, context: { title: '后来新到的通知', excerpt: '' } };
    const write = deferred<ReadAllResult>();
    vi.mocked(notificationsApi.list).mockResolvedValue(result([notice], { throughId: upperBound }));
    const all = vi.spyOn(notificationsApi, 'readAll').mockReturnValue(write.promise);
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: '截至当前全部已读' }));
    expect(all).toHaveBeenCalledWith(upperBound, expect.any(AbortSignal));
    vi.mocked(notificationsApi.list).mockResolvedValue(
      result([next, notice], { throughId: nextId, unreadTotal: 2 }),
    );
    act(() => window.dispatchEvent(new Event('focus')));
    await screen.findByText('后来新到的通知');
    vi.mocked(notificationsApi.list).mockResolvedValue(
      result([next, { ...notice, readAt }], { throughId: nextId, unreadTotal: 1 }),
    );
    await act(async () => write.resolve({ ok: true, markedRead: 1, unreadTotal: 1 }));
    await screen.findByText(/之后新到的通知保留未读/);
    await screen.findByText('后来新到的通知');
    const items = screen.getAllByRole('article');
    expect(within(items[0]).getByLabelText('未读')).toBeInTheDocument();
    expect(within(items[1]).getByText('已读')).toBeInTheDocument();
    expect(all).toHaveBeenCalledOnce();
  });

  it('removes an unread-filter row only after single-read acknowledgement and refreshes the page boundary', async () => {
    const write = deferred<ReadResult>();
    vi.spyOn(notificationsApi, 'read').mockReturnValue(write.promise);
    render(page('/notifications?unread=true'));
    const item = await screen.findByRole('article', { name: '圈子评论' });
    fireEvent.click(within(item).getByRole('button', { name: '标为已读' }));
    expect(item).toBeInTheDocument();
    vi.mocked(notificationsApi.list).mockResolvedValue(
      result([], { unreadTotal: 0, throughId: notice.id }),
    );
    await act(async () => write.resolve({ ok: true, unreadTotal: 0, readAt }));
    await screen.findByText('没有未读通知');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('retains unread rows when read-all fails and retries with the same current snapshot only on demand', async () => {
    const all = vi
      .spyOn(notificationsApi, 'readAll')
      .mockRejectedValueOnce(
        new ApiError('请求超时，操作可能已完成；请先刷新确认，再重试', 'timeout', 0),
      )
      .mockResolvedValue({ ok: true, markedRead: 1, unreadTotal: 0 });
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: '截至当前全部已读' }));
    await screen.findByText(/请求超时，操作可能已完成/);
    expect(within(screen.getByRole('article')).getByLabelText('未读')).toBeInTheDocument();
    expect(all).toHaveBeenCalledOnce();
    vi.mocked(notificationsApi.list).mockResolvedValue(
      result([{ ...notice, readAt }], { unreadTotal: 0 }),
    );
    fireEvent.click(screen.getByRole('button', { name: '截至当前全部已读' }));
    await screen.findByText(/已将 1 条通知标为已读/);
    expect(all).toHaveBeenLastCalledWith(notice.id, expect.any(AbortSignal));
  });

  it('clears account A immediately and ignores its late write or change event after account B mounts', async () => {
    const write = deferred<ReadResult>();
    const read = vi.spyOn(notificationsApi, 'read').mockReturnValue(write.promise);
    const events: Event[] = [],
      handler = (event: Event) => events.push(event);
    window.addEventListener(NOTIFICATIONS_CHANGED, handler);
    try {
      const view = render(page());
      fireEvent.click(
        within(await screen.findByRole('article', { name: '圈子评论' })).getByRole('button', {
          name: '标为已读',
        }),
      );
      vi.mocked(notificationsApi.list).mockResolvedValue(result([]));
      view.rerender(page('/notifications', signedIn(otherMember)));
      await screen.findByText('暂无通知');
      expect(read.mock.calls[0][1]?.aborted).toBe(true);
      await act(async () => write.resolve({ ok: true, unreadTotal: 0, readAt }));
      expect(events).toHaveLength(0);
      expect(screen.queryByText(notice.context!.title)).not.toBeInTheDocument();
    } finally {
      window.removeEventListener(NOTIFICATIONS_CHANGED, handler);
    }
  });

  it('retained write callbacks cannot send requests after their owner unmounts', async () => {
    const read = vi.spyOn(notificationsApi, 'read'),
      all = vi.spyOn(notificationsApi, 'readAll');
    const view = renderHook(() => useNotificationInbox(member.id, 'session-a', 'all', false, 0));
    await waitFor(() => expect(view.result.current.data).not.toBeNull());
    const markRead = view.result.current.markRead,
      readAll = view.result.current.readAll;
    view.unmount();
    await act(async () => {
      await markRead(notice.id);
      await readAll();
    });
    expect(read).not.toHaveBeenCalled();
    expect(all).not.toHaveBeenCalled();
  });

  it('shows an information-only report result without original content or a target', async () => {
    vi.mocked(notificationsApi.list).mockResolvedValue(
      result([{ ...notice, kind: 'report-review', category: 'system', outcome: 'resolved' }]),
    );
    render(page());
    await screen.findByText('你的举报已处理完成');
    expect(screen.queryByText(notice.context!.title)).not.toBeInTheDocument();
    expect(screen.queryByText(otherMember.name)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '查看' })).not.toBeInTheDocument();
    expect(screen.queryByText('原内容当前不可访问')).not.toBeInTheDocument();
  });
});
