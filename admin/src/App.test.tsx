import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import SessionProvider from './SessionProvider';
import type { Overview, Post, Report, Session, User } from './types';

const admin: User = {
  id: 'admin-1',
  name: '运营管理员',
  handle: 'admin',
  email: 'admin@gongming.local',
  role: 'admin',
  status: 'active',
  avatar: '',
  bio: '共鸣运营',
  createdAt: '2026-10-27T02:00:00Z',
};
const member: User = {
  ...admin,
  id: 'member-1',
  name: '测试成员',
  handle: 'member',
  email: 'member@gongming.local',
  role: 'member',
};
const post: Post = {
  id: 'post-1',
  author: member,
  body: '需要核实的社区内容',
  images: [],
  topic: '生活',
  status: 'pending',
  createdAt: '2026-10-27T03:00:00Z',
  likeCount: 2,
  liked: false,
  commentCount: 1,
};
const report: Report = {
  id: 'report-1',
  reporterId: 'reporter-1',
  targetId: post.id,
  targetType: 'post',
  reason: '疑似误导性内容',
  status: 'open',
  note: '',
  createdAt: '2026-10-27T03:01:00Z',
};
const overview: Overview = {
  users: 8,
  posts: 5,
  conversations: 3,
  reports: 1,
  pendingReports: 1,
  hiddenPosts: 0,
  dailyActive: 2,
  series: [
    { date: '2026-10-26', users: 2, posts: 1, messages: 6 },
    { date: '2026-10-27', users: 1, posts: 2, messages: 5 },
  ],
  recentActivity: [],
};
const session = (user = admin): Session => ({
  user,
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
});
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const failure = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { code: 'test_error', message } }), { status });
const mount = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </MemoryRouter>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('admin console operational flows', () => {
  it('fills demo credentials without logging in and shows actual login failures', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(failure(401, '请先登录'))
      .mockResolvedValueOnce(failure(401, '密码错误'));
    vi.stubGlobal('fetch', fetch);
    mount('/users');
    await screen.findByRole('heading', { name: '登录运营工作台' });
    fireEvent.click(screen.getByRole('button', { name: '填入示例' }));
    expect(screen.getByLabelText('邮箱')).toHaveValue('admin@gongming.local');
    expect(screen.getByLabelText('密码')).toHaveValue('Admin2026!');
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '安全登录' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('密码错误');
    expect(screen.queryByRole('navigation', { name: '运营导航' })).not.toBeInTheDocument();
  });

  it('blocks a member account from operational routes before requesting admin data', async () => {
    const fetch = vi.fn().mockResolvedValue(ok(session(member)));
    vi.stubGlobal('fetch', fetch);
    mount('/overview');
    expect(
      await screen.findByRole('heading', { name: '当前账号没有运营权限' }),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps moderator user management read-only', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(
            url.endsWith('/auth/me')
              ? ok(session({ ...admin, role: 'moderator' }))
              : ok({ items: [member], total: 1 }),
          ),
        ),
    );
    mount('/users?detail=member-1');
    const dialog = await screen.findByRole('dialog', { name: '用户资料与权限' });
    expect(within(dialog).getByLabelText('角色')).toBeDisabled();
    expect(within(dialog).getByLabelText('账号状态')).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '检查并保存' })).toBeDisabled();
  });

  it('requires the exact handle for sensitive edits and preserves failed server authorization', async () => {
    const fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.endsWith('/auth/me')) return Promise.resolve(ok(session()));
      if (options?.method === 'PATCH')
        return Promise.resolve(failure(403, '最后一位管理员不能降级'));
      return Promise.resolve(ok({ items: [member], total: 1 }));
    });
    vi.stubGlobal('fetch', fetch);
    mount('/users?detail=member-1');
    const dialog = await screen.findByRole('dialog', { name: '用户资料与权限' });
    fireEvent.change(within(dialog).getByLabelText('角色'), { target: { value: 'moderator' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '检查并保存' }));
    const submit = within(dialog).getByRole('button', { name: '确认并保存' });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('确认账号标识'), {
      target: { value: 'member' },
    });
    fireEvent.click(submit);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('最后一位管理员不能降级');
    expect(screen.queryByText('账号变更已保存，服务端已记录此次操作。')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/v1/admin/users/member-1',
      expect.objectContaining({ method: 'PATCH', body: '{"role":"moderator"}' }),
    );
  });

  it('submits actual content visibility only after a second confirmation', async () => {
    let state = post.status;
    const fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.endsWith('/auth/me')) return Promise.resolve(ok(session()));
      if (options?.method === 'PATCH') {
        state = 'hidden';
        return Promise.resolve(ok({ ...post, status: state }));
      }
      return Promise.resolve(ok({ items: [{ ...post, status: state }], total: 1 }));
    });
    vi.stubGlobal('fetch', fetch);
    mount('/content?detail=post-1');
    const dialog = await screen.findByRole('dialog', { name: '内容审核' });
    fireEvent.change(within(dialog).getByLabelText('审核结果'), { target: { value: 'hidden' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '检查并提交' }));
    expect(fetch.mock.calls.some((call) => call[1]?.method === 'PATCH')).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: '确认审核' }));
    expect(await screen.findByText('审核结果已保存，内容可见性已更新。')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/admin/posts/post-1',
      expect.objectContaining({ body: '{"status":"hidden"}' }),
    );
  });

  it('requires a report handling note, submits it, and does not silently moderate the target', async () => {
    const fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.endsWith('/auth/me')) return Promise.resolve(ok(session()));
      if (options?.method === 'PATCH')
        return Promise.resolve(
          ok({ ...report, status: 'dismissed', note: '核实后未发现违规依据' }),
        );
      return Promise.resolve(ok({ items: [report], total: 1 }));
    });
    vi.stubGlobal('fetch', fetch);
    mount('/reports?status=open&detail=report-1');
    const dialog = await screen.findByRole('dialog', { name: '举报工单' });
    expect(within(dialog).getByRole('button', { name: '检查处理结论' })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('处理结果'), { target: { value: 'dismissed' } });
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: '核实后未发现违规依据' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '检查处理结论' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认提交结论' }));
    await screen.findByText('处理结论与说明已保存。');
    const writes = fetch.mock.calls.filter((call) => call[1]?.method === 'PATCH');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual([
      '/api/v1/admin/reports/report-1',
      expect.objectContaining({ body: '{"status":"dismissed","note":"核实后未发现违规依据"}' }),
    ]);
  });

  it('restores the login boundary when an operational request finds an expired session', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(url.endsWith('/auth/me') ? ok(session()) : failure(401, '登录已失效')),
        ),
    );
    mount('/content?status=pending');
    expect(await screen.findByRole('heading', { name: '登录运营工作台' })).toBeInTheDocument();
    expect(screen.getByText('登录已过期，请重新登录以继续刚才的操作。')).toBeInTheDocument();
  });

  it('uses API trend values and has a readable empty audit state', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(url.endsWith('/auth/me') ? ok(session()) : ok(overview)),
        ),
    );
    mount('/overview');
    await screen.findByRole('heading', { name: '运营总览' });
    await waitFor(() =>
      expect(screen.getByRole('img', { name: /2 天内消息变化，总计 11/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: '查看明细' }));
    expect(screen.getByRole('table', { name: '每日活跃明细' })).toHaveTextContent('2026-10-27');
    expect(screen.getByText('暂无运营操作')).toBeInTheDocument();
  });
});
