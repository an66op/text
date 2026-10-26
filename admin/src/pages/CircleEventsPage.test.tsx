import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceAccountEpoch, setExpectedAccount } from '../../../src/shared/api/account-guard';
import App from '../App';
import SessionProvider from '../SessionProvider';
import { SessionContext, type SessionContextValue } from '../session-context';
import type { AdminCircleEvent, Report, Session, User } from '../types';

const operator: User = {
  id: 'operator-events',
  name: '活动审核员',
  handle: 'events-reviewer',
  email: 'events@example.test',
  avatar: '',
  bio: '',
  role: 'moderator',
  status: 'active',
  createdAt: '2026-10-27T02:00:00Z',
};
const event: AdminCircleEvent = {
  id: `cevent_${'a'.repeat(32)}`,
  circleId: `circle_${'b'.repeat(32)}`,
  creator: { id: 'event-owner', name: '圈主小林', handle: 'lin', avatar: '', bio: '' },
  title: '私圈周末创作',
  description: '只向当前圈子成员开放的活动介绍。',
  mode: 'online',
  location: 'https://meeting.example/private-room',
  startsAt: '2026-11-01T02:00:00Z',
  endsAt: '2026-11-01T04:00:00Z',
  registrationClosesAt: '2026-11-01T01:00:00Z',
  capacity: 12,
  registeredCount: 9,
  waitlistedCount: 2,
  lifecycle: 'published',
  moderation: 'hidden',
  phase: 'upcoming',
  registrationOpen: false,
  myRegistration: null,
  revision: 7,
  createdAt: '2026-10-27T03:00:00Z',
  updatedAt: '2026-10-27T03:00:00Z',
  circleName: '私密创作圈',
  circleStatus: 'active',
  moderationNote: '等待核实活动说明',
};
const session = (user = operator): Session => ({ user, expiresAt: '2099-10-27T03:00:00Z' });
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const failure = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { code: 'test_error', message } }), { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function service(handler: (url: string, options?: RequestInit) => Response | Promise<Response>) {
  const fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
    if (url.endsWith('/auth/context'))
      return Promise.resolve(
        ok({ generation: 'bootstrap-generation', expiresAt: '2099-12-31T00:00:00Z' }),
      );
    if (url.endsWith('/auth/me')) return Promise.resolve(ok(session()));
    if (url.endsWith('/admin/system'))
      return Promise.resolve(
        ok({ version: '0.8.0', environment: 'development', uptimeSeconds: 1, features: [] }),
      );
    return Promise.resolve(handler(url, options));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const mount = (path = `/circles/events?q=${event.id}&detail=${event.id}`) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </MemoryRouter>,
  );
const reviewDialog = () => screen.findByRole('dialog', { name: '活动审核详情' });
function prepare(
  dialog: HTMLElement,
  note = '已核实活动内容，记录处理依据',
  moderation = 'visible',
) {
  fireEvent.change(within(dialog).getByLabelText('平台可见性'), { target: { value: moderation } });
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: note } });
  fireEvent.click(within(dialog).getByRole('button', { name: '检查活动处理结果' }));
}
const confirm = (dialog: HTMLElement) =>
  fireEvent.click(within(dialog).getByRole('button', { name: '确认保存活动治理' }));
afterEach(() => {
  vi.unstubAllGlobals();
  setExpectedAccount('');
});

describe('independent circle event governance', () => {
  it('shows private activity through staff APIs with separate lifecycle and moderation, aggregate counts and plain-text location', async () => {
    const fetch = service(() =>
      ok({
        items: [
          { ...event, attendeeNotes: '不得展示的附言', attendees: [{ private: '不得展示的名单' }] },
        ],
        total: 1,
      }),
    );
    mount();
    const dialog = await reviewDialog();
    expect(within(dialog).getByText(event.description)).toBeInTheDocument();
    expect(within(dialog).getByText('即将开始')).toBeInTheDocument();
    expect(within(dialog).getByText('平台屏蔽')).toBeInTheDocument();
    expect(within(dialog).getByText('已确认 9 / 12 人 · 候补 2 人')).toBeInTheDocument();
    expect(within(dialog).getByText('2026/11/01 10:00')).toBeInTheDocument();
    expect(within(dialog).getByText(event.location)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: event.location })).not.toBeInTheDocument();
    expect(screen.queryByText('不得展示的附言')).not.toBeInTheDocument();
    expect(screen.queryByText('不得展示的名单')).not.toBeInTheDocument();
    expect(within(dialog).getByText(/运营身份不会加入圈子/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: '查看活动审计' })).toHaveAttribute(
      'href',
      `/audit?q=${event.id}`,
    );
    expect(screen.getByRole('link', { name: '活动审核' })).toHaveAttribute('aria-current', 'page');
    expect(
      fetch.mock.calls.every(
        ([url]) =>
          (url as string).includes('/admin/') ||
          (url as string).endsWith('/auth/me') ||
          (url as string).endsWith('/auth/context'),
      ),
    ).toBe(true);
    expect(
      fetch.mock.calls.some(
        ([url]) =>
          (url as string).includes('attendees') || (url as string).includes('registration'),
      ),
    ).toBe(false);
  });

  it('requires a specific confirmation and reason, retains a failed restore, and uses the actual revision and server receipt', async () => {
    let current = { ...event, phase: 'ended' as const },
      attempts = 0;
    const fetch = service((_url, options) => {
      if (options?.method === 'PATCH') {
        attempts += 1;
        if (attempts === 1) return failure(503, '活动治理服务暂不可用');
        current = { ...current, moderation: 'visible', revision: 8 };
        return ok(current);
      }
      return ok({ items: [current], total: 1 });
    });
    mount();
    const dialog = await reviewDialog();
    expect(within(dialog).getByRole('button', { name: '检查活动处理结果' })).toBeDisabled();
    prepare(dialog, '  已核实，恢复历史阅读  ');
    const check = within(dialog).getByRole('region', { name: '确认活动治理' });
    expect(check).toHaveTextContent(event.id);
    expect(check).toHaveTextContent(event.circleName);
    expect(check).toHaveTextContent('版本 7');
    expect(check).toHaveTextContent('不延长报名截止，截止后不再接受报名');
    expect(check).toHaveTextContent('保留已确认登记；未截止的有效候补可按顺序递补');
    expect(check).toHaveTextContent('不恢复已取消登记');
    expect(attempts).toBe(0);
    confirm(dialog);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('活动治理服务暂不可用');
    expect(within(dialog).getByRole('textbox')).toHaveValue('  已核实，恢复历史阅读  ');
    expect(screen.queryByText(/活动已保存为/)).not.toBeInTheDocument();
    confirm(dialog);
    await screen.findByText('活动已保存为「圈内可见」，版本 8，说明已记录审计。');
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/admin/circle-events/${event.id}`,
      expect.objectContaining({
        method: 'PATCH',
        body: '{"moderation":"visible","note":"已核实，恢复历史阅读","revision":7}',
      }),
    );
    await screen.findByRole('table', { name: '活动审核列表' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps cancelled activities read-only and cannot revive them through moderation', async () => {
    const fetch = service(() =>
      ok({ items: [{ ...event, lifecycle: 'cancelled', phase: 'cancelled' }], total: 1 }),
    );
    mount();
    const dialog = await reviewDialog();
    expect(within(dialog).getByText(/生命周期终态只读/)).toHaveTextContent(
      '不能恢复、重新开放报名',
    );
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(dialog).getByText('已取消')).toBeInTheDocument();
    expect(within(dialog).getByText('平台屏蔽')).toBeInTheDocument();
    expect(fetch.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
  });

  it.each(['suspended', 'archived'] as const)(
    'blocks visible writes for a %s circle but allows hiding with a reason',
    async (circleStatus) => {
      const fetch = service((_url, options) =>
        options?.method === 'PATCH'
          ? ok({ ...event, circleStatus, revision: 8 })
          : ok({ items: [{ ...event, circleStatus }], total: 1 }),
      );
      mount();
      const dialog = await reviewDialog();
      expect(
        within(dialog).getByRole('option', { name: '圈内可见 · 按当前成员权限阅读' }),
      ).toBeDisabled();
      fireEvent.change(within(dialog).getByLabelText('平台可见性'), {
        target: { value: 'visible' },
      });
      fireEvent.change(within(dialog).getByRole('textbox'), {
        target: { value: '核实后继续屏蔽' },
      });
      expect(within(dialog).getByRole('button', { name: '检查活动处理结果' })).toBeDisabled();
      fireEvent.change(within(dialog).getByLabelText('平台可见性'), {
        target: { value: 'hidden' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: '检查活动处理结果' }));
      confirm(dialog);
      await screen.findByText('活动已保存为「平台屏蔽」，版本 8，说明已记录审计。');
      expect(fetch).toHaveBeenCalledWith(
        `/api/v1/admin/circle-events/${event.id}`,
        expect.objectContaining({
          body: '{"moderation":"hidden","note":"核实后继续屏蔽","revision":7}',
        }),
      );
    },
  );

  it('preserves the operator draft on a revision conflict and requires another confirmation after a deliberate refresh', async () => {
    let current = event,
      attempts = 0;
    const fetch = service((_url, options) => {
      if (options?.method === 'PATCH') {
        attempts += 1;
        if (attempts === 1) {
          current = { ...event, title: '管理员已更新的标题', revision: 8 };
          return failure(409, '活动版本已变化，请刷新');
        }
        current = { ...current, moderation: 'visible', revision: 9 };
        return ok(current);
      }
      return ok({ items: [current], total: 1 });
    });
    mount();
    const dialog = await reviewDialog();
    prepare(dialog, '应当保留的审核说明');
    confirm(dialog);
    await within(dialog).findByText('活动版本已变化，请刷新');
    expect(within(dialog).getByRole('textbox')).toHaveValue('应当保留的审核说明');
    expect(attempts).toBe(1);
    fireEvent.click(within(dialog).getByRole('button', { name: '刷新活动记录' }));
    const refreshed = await reviewDialog();
    expect(within(refreshed).getByText('管理员已更新的标题')).toBeInTheDocument();
    expect(within(refreshed).getByText('revision 8')).toBeInTheDocument();
    expect(within(refreshed).getByRole('textbox')).toHaveValue('应当保留的审核说明');
    expect(within(refreshed).getByLabelText('平台可见性')).toHaveValue('visible');
    expect(
      within(refreshed).queryByRole('region', { name: '确认活动治理' }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(refreshed).getByRole('button', { name: '检查活动处理结果' }));
    confirm(refreshed);
    await screen.findByText('活动已保存为「圈内可见」，版本 9，说明已记录审计。');
    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining('/admin/circle-events?'),
      expect.anything(),
    );
    expect(
      fetch.mock.calls
        .filter(([, options]) => options?.method === 'PATCH')
        .map(([, options]) => JSON.parse(options!.body as string).revision),
    ).toEqual([7, 8]);
  });

  it('replaces a conflicted draft with a read-only terminal activity when cancellation wins the race', async () => {
    let current = event;
    const fetch = service((_url, options) => {
      if (options?.method === 'PATCH') {
        current = { ...event, lifecycle: 'cancelled', phase: 'cancelled', revision: 8 };
        return failure(409, '活动已经取消');
      }
      return ok({ items: [current], total: 1 });
    });
    mount();
    const dialog = await reviewDialog();
    prepare(dialog);
    confirm(dialog);
    await within(dialog).findByText('活动已经取消');
    fireEvent.click(within(dialog).getByRole('button', { name: '刷新活动记录' }));
    const refreshed = await reviewDialog();
    expect(within(refreshed).getByText(/生命周期终态只读/)).toBeInTheDocument();
    expect(within(refreshed).queryByRole('textbox')).not.toBeInTheDocument();
    expect(fetch.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(1);
  });

  it.each([403, 404])(
    'clears private records on write permission loss (HTTP %s) and only restores them through a new server read',
    async (status) => {
      const fetch = service((_url, options) =>
        options?.method === 'PATCH'
          ? failure(status, '活动治理访问权限已失效')
          : ok({ items: [event], total: 1 }),
      );
      mount();
      const dialog = await reviewDialog();
      prepare(dialog);
      confirm(dialog);
      expect(await screen.findByRole('alert')).toHaveTextContent('活动治理访问权限已失效');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.queryByText(event.title)).not.toBeInTheDocument();
      expect(screen.queryByText(event.description)).not.toBeInTheDocument();
      expect(screen.queryByText(/活动已保存为/)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
      await reviewDialog();
      expect(
        fetch.mock.calls.filter(
          ([url, options]) =>
            (url as string).includes('/admin/circle-events?') && options?.method !== 'PATCH',
        ),
      ).toHaveLength(2);
    },
  );

  it('refuses unchanged or unrelated write receipts instead of displaying a fabricated success', async () => {
    service((_url, options) =>
      options?.method === 'PATCH' ? ok(event) : ok({ items: [event], total: 1 }),
    );
    mount();
    const dialog = await reviewDialog();
    prepare(dialog, '同状态补充审核依据', 'hidden');
    confirm(dialog);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('服务尚未确认新的活动版本');
    expect(within(dialog).getByRole('textbox')).toHaveValue('同状态补充审核依据');
    expect(screen.queryByText(/活动已保存为/)).not.toBeInTheDocument();
  });

  it('encodes server filters, resets page and details on filter changes and distinguishes a read error from an empty queue', async () => {
    let available = false;
    const fetch = service(() =>
      available ? ok({ items: [event], total: 45 }) : failure(503, '活动列表暂不可达'),
    );
    mount(
      `/circles/events?circleId=${event.circleId}&lifecycle=published&moderation=hidden&offset=20`,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('活动列表暂不可达');
    expect(screen.queryByText('没有符合条件的记录')).not.toBeInTheDocument();
    available = true;
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await screen.findByRole('table', { name: '活动审核列表' });
    expect(screen.getByText('第 2 页')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索活动标题、ID、圈名或创建者标识'), {
      target: { value: '创作 & 周末' },
    });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/api/v1/admin/circle-events?circleId=${event.circleId}&lifecycle=published&moderation=hidden&q=${encodeURIComponent('创作 & 周末').replaceAll('%20', '+')}&offset=0&limit=20`,
        expect.anything(),
      ),
    );
    await screen.findByRole('table', { name: '活动审核列表' });
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith(
        expect.stringContaining('offset=20&limit=20'),
        expect.anything(),
      ),
    );
    fireEvent.change(screen.getByLabelText('筛选活动平台可见性'), { target: { value: 'visible' } });
    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith(
        expect.stringContaining('moderation=visible&q='),
        expect.anything(),
      ),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('筛选活动所属圈子 ID'), {
      target: { value: 'circle_other' },
    });
    fireEvent.click(screen.getByRole('button', { name: '筛选圈子' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith(
        expect.stringContaining('circleId=circle_other&lifecycle=published&moderation=visible'),
        expect.anything(),
      ),
    );
  });

  it('aborts old filtered reads and never restores their private activity after a new search succeeds', async () => {
    const old = deferred<Response>();
    let oldSignal: AbortSignal | undefined;
    service((url, options) => {
      if (!url.includes('q=new')) {
        oldSignal = options?.signal as AbortSignal;
        return old.promise;
      }
      return ok({ items: [], total: 0 });
    });
    mount('/circles/events?q=old');
    await screen.findByText('正在读取活动治理记录…');
    fireEvent.change(screen.getByLabelText('搜索活动标题、ID、圈名或创建者标识'), {
      target: { value: 'new' },
    });
    fireEvent.submit(screen.getByRole('search'));
    await screen.findByText('没有符合条件的记录');
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => old.resolve(ok({ items: [event], total: 1 })));
    expect(screen.queryByText(event.title)).not.toBeInTheDocument();
  });

  it('rejects a stale account-epoch confirmation before sending any governance write', async () => {
    const fetch = service(() => ok({ items: [event], total: 1 }));
    mount();
    const dialog = await reviewDialog();
    prepare(dialog);
    advanceAccountEpoch();
    confirm(dialog);
    expect(await screen.findByRole('alert')).toHaveTextContent('登录会话已变化');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetch.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
  });

  it('aborts delayed writes when operators change or lose staff rights and discards late receipts', async () => {
    const delayed = deferred<Response>();
    let signal: AbortSignal | undefined;
    service((_url, options) => {
      if (options?.method === 'PATCH') {
        signal = options.signal as AbortSignal;
        return delayed.promise;
      }
      return ok({ items: [event], total: 1 });
    });
    const state = (user: User): SessionContextValue => ({
      session: session(user),
      status: 'authenticated',
      error: '',
      expired: false,
      refresh: async () => {},
      login: async () => {},
      logout: async () => {},
    });
    const tree = (user: User) => (
      <MemoryRouter initialEntries={[`/circles/events?detail=${event.id}`]}>
        <SessionContext value={state(user)}>
          <App />
        </SessionContext>
      </MemoryRouter>
    );
    setExpectedAccount(operator.id);
    const view = render(tree(operator));
    const dialog = await reviewDialog();
    prepare(dialog);
    confirm(dialog);
    await waitFor(() => expect(signal).toBeDefined());
    const other = { ...operator, id: 'other-operator', name: '新的运营人员' };
    setExpectedAccount(other.id);
    view.rerender(tree(other));
    const next = await reviewDialog();
    expect(signal?.aborted).toBe(true);
    expect(within(next).getByRole('textbox')).toHaveValue('');
    view.rerender(tree({ ...other, role: 'member' }));
    await screen.findByText('当前账号没有运营权限');
    await act(async () => delayed.resolve(ok({ ...event, moderation: 'visible', revision: 8 })));
    expect(screen.queryByText(/活动已保存为/)).not.toBeInTheDocument();
    expect(screen.queryByText(event.description)).not.toBeInTheDocument();
  });

  it('routes circle-event reports to independent event governance and refuses unknown report targets', async () => {
    let targetType: Report['targetType'] = 'circle-event';
    const report = (): Report => ({
      id: 'report-event',
      reporterId: 'member-one',
      targetType,
      targetId: event.id,
      reason: '活动内容投诉',
      status: 'open',
      note: '',
      createdAt: event.createdAt,
    });
    service((url) =>
      ok({ items: url.includes('/admin/reports') ? [report()] : [event], total: 1 }),
    );
    const view = mount('/reports?detail=report-event');
    const dialog = await screen.findByRole('dialog', { name: '举报工单' });
    const target = within(dialog).getByRole('link', { name: '查看被举报圈内活动' });
    expect(target).toHaveAttribute('href', `/circles/events?q=${event.id}&detail=${event.id}`);
    fireEvent.click(target);
    await reviewDialog();
    view.unmount();
    for (const unknownType of ['unexpected-domain', '__proto__', 'constructor']) {
      targetType = unknownType as Report['targetType'];
      const unknownView = mount('/reports?detail=report-event');
      const unknown = await screen.findByRole('dialog', { name: '举报工单' });
      expect(within(unknown).getByText('未知对象')).toBeInTheDocument();
      expect(within(unknown).queryByRole('link', { name: /^查看被举报/ })).not.toBeInTheDocument();
      unknownView.unmount();
    }
  });
});
