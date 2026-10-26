import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setExpectedAccount } from '../../../src/shared/api/account-guard';
import App from '../App';
import SessionProvider from '../SessionProvider';
import { SessionContext, type SessionContextValue } from '../session-context';
import type {
  AdminCircle,
  AdminCirclePost,
  AdminMediaAsset,
  Report,
  Session,
  User,
} from '../types';

const operator: User = {
  id: 'moderator-1',
  name: '治理审核员',
  handle: 'reviewer',
  email: 'reviewer@example.test',
  avatar: '',
  bio: '',
  role: 'moderator',
  status: 'active',
  createdAt: '2026-10-27T02:00:00Z',
};
const owner = { id: 'user-owner', name: '圈主小林', handle: 'lin', avatar: '', bio: '摄影爱好者' };
const circle: AdminCircle = {
  id: 'circle_' + 'a'.repeat(32),
  name: '私密摄影圈',
  description: '成员讨论构图与后期。',
  cover: '',
  icon: '📷',
  category: '摄影',
  visibility: 'private',
  joinPolicy: 'approval',
  status: 'active',
  owner,
  role: 'guest',
  membership: 'none',
  memberCount: 7,
  createdAt: '2026-10-27T03:00:00Z',
  updatedAt: '2026-10-27T03:00:00Z',
  channelCount: 3,
  postCount: 8,
  moderationNote: '',
};
const imageURL = '/api/v1/media/images/media_' + 'd'.repeat(32);
const post: AdminCirclePost = {
  id: 'cpost_' + 'b'.repeat(32),
  circleId: circle.id,
  channelId: 'cchannel_' + 'c'.repeat(32),
  author: owner,
  title: '私圈管理频道内容',
  body: '这段内容仅供授权成员查看。',
  images: [imageURL],
  status: 'hidden',
  featured: true,
  pinned: false,
  likeCount: 2,
  liked: false,
  commentCount: 1,
  createdAt: circle.createdAt,
  updatedAt: circle.updatedAt,
  circleName: circle.name,
  channelName: '圈内管理讨论',
  moderationNote: '等待核实图片',
};
const system = {
  version: '0.6.0',
  storage: 'PostgreSQL',
  environment: 'development',
  uptimeSeconds: 50,
  features: [],
};
const session = (user = operator): Session => ({ user, expiresAt: '2099-10-27T03:00:00Z' });
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const failure = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { code: 'test_error', message } }), { status });
const mount = (path = '/circles') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </MemoryRouter>,
  );

function mockService(
  handler: (url: string, options?: RequestInit) => Response | Promise<Response>,
) {
  const fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
    if (url.endsWith('/auth/context'))
      return Promise.resolve(
        ok({ generation: 'bootstrap-generation', expiresAt: '2099-12-31T00:00:00Z' }),
      );
    if (url.endsWith('/auth/me')) return Promise.resolve(ok(session()));
    if (url.endsWith('/admin/system')) return Promise.resolve(ok(system));
    return Promise.resolve(handler(url, options));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
afterEach(() => {
  vi.unstubAllGlobals();
  setExpectedAccount('');
});

describe('independent platform circle governance', () => {
  it('opens a private circle for moderator governance without ordinary membership API calls', async () => {
    const fetch = mockService(() => ok({ items: [circle], total: 1 }));
    mount(`/circles?q=${circle.id}&detail=${circle.id}`);
    const dialog = await screen.findByRole('dialog', { name: '圈子治理详情' });
    expect(within(dialog).getByText('圈主小林')).toBeInTheDocument();
    expect(within(dialog).getByText('7 位成员 · 3 个频道 · 8 篇帖子')).toBeInTheDocument();
    expect(within(dialog).getByText('私密圈子 · 介绍受邀请与成员权限限制')).toBeInTheDocument();
    expect(within(dialog).getByText('有效邀请后，提交申请审核')).toBeInTheDocument();
    expect(within(dialog).getByText(/运营身份不授予圈内成员/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: '审核圈内帖子' })).toHaveAttribute(
      'href',
      `/circles/posts?circleId=${circle.id}`,
    );
    expect(within(dialog).getByRole('link', { name: '审核圈内活动' })).toHaveAttribute(
      'href',
      `/circles/events?circleId=${circle.id}`,
    );
    expect(within(dialog).getByRole('link', { name: '查看治理审计' })).toHaveAttribute(
      'href',
      `/audit?q=${circle.id}`,
    );
    expect(screen.queryByRole('button', { name: '加入圈子' })).not.toBeInTheDocument();
    expect(
      fetch.mock.calls.every(
        ([url]) =>
          (url as string).includes('/admin/') ||
          (url as string).endsWith('/auth/me') ||
          (url as string).endsWith('/auth/context'),
      ),
    ).toBe(true);
  });

  it('requires a reason and specific confirmation, retains a failed suspension, and refreshes the saved status', async () => {
    let current = circle,
      attempts = 0;
    const fetch = mockService((_url, options) => {
      if (options?.method === 'PATCH') {
        attempts += 1;
        if (attempts === 1) return failure(403, '运营权限已变化');
        current = {
          ...circle,
          status: 'suspended',
          moderationNote: '已核实持续违规，需要暂停',
          updatedAt: '2026-10-27T04:00:00Z',
        };
        return ok(current);
      }
      return ok({ items: [current], total: 1 });
    });
    mount(`/circles?detail=${circle.id}`);
    const dialog = await screen.findByRole('dialog', { name: '圈子治理详情' });
    const check = within(dialog).getByRole('button', { name: '检查处理结果' });
    expect(check).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '   ' } });
    expect(check).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('圈子状态'), { target: { value: 'suspended' } });
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: ' 已核实持续违规，需要暂停 ' },
    });
    fireEvent.click(check);
    const confirm = within(dialog).getByRole('region', { name: '确认圈子治理' });
    expect(confirm).toHaveTextContent(circle.name);
    expect(confirm).toHaveTextContent(circle.id);
    expect(confirm).toHaveTextContent('普通端将不能读取频道、帖子、评论及他人的圈内图片');
    expect(attempts).toBe(0);
    fireEvent.click(within(confirm).getByRole('button', { name: '确认保存处理结果' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('运营权限已变化');
    expect(within(dialog).getByRole('textbox')).toHaveValue(' 已核实持续违规，需要暂停 ');
    expect(screen.queryByText(/圈子治理已保存为/)).not.toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole('button', { name: '确认保存处理结果' }));
    await screen.findByText('圈子治理已保存为「已暂停」，说明已记录审计。');
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/admin/circles/${circle.id}`,
      expect.objectContaining({
        method: 'PATCH',
        body: '{"status":"suspended","note":"已核实持续违规，需要暂停"}',
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('table', { name: '圈子治理列表' })).toHaveTextContent('已暂停'),
    );
  });

  it('allows same-status note updates without implying automatic membership or publication', async () => {
    const fetch = mockService((_url, options) =>
      options?.method === 'PATCH'
        ? ok({ ...circle, moderationNote: '补充本次核实结论' })
        : ok({ items: [circle], total: 1 }),
    );
    mount(`/circles?detail=${circle.id}`);
    const dialog = await screen.findByRole('dialog', { name: '圈子治理详情' });
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: '补充本次核实结论' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '检查处理结果' }));
    expect(within(dialog).getByRole('region', { name: '确认圈子治理' })).toHaveTextContent(
      '不自动加入成员或发布帖子',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: '确认保存处理结果' }));
    await screen.findByText('圈子治理已保存为「正常」，说明已记录审计。');
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/admin/circles/${circle.id}`,
      expect.objectContaining({ body: '{"status":"active","note":"补充本次核实结论"}' }),
    );
  });

  it('keeps owner-archived circles read-only in platform governance', async () => {
    const fetch = mockService(() => ok({ items: [{ ...circle, status: 'archived' }], total: 1 }));
    mount(`/circles?status=archived&detail=${circle.id}`);
    const dialog = await screen.findByRole('dialog', { name: '圈子治理详情' });
    expect(within(dialog).getByText(/圈主已归档此圈子，平台治理只读/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    expect(fetch.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
  });

  it('reviews private circle posts under explicit platform rights and keeps publication conflicts retryable', async () => {
    let allowed = false;
    const fetch = mockService((_url, options) =>
      options?.method === 'PATCH'
        ? allowed
          ? ok({ ...post, status: 'published', moderationNote: '核实圈内图片与内容可用' })
          : failure(409, '圈子已暂停，不能发布')
        : ok({ items: [post], total: 1 }),
    );
    mount(`/circles/posts?circleId=${circle.id}&q=${post.id}&detail=${post.id}`);
    const dialog = await screen.findByRole('dialog', { name: '圈帖审核详情' });
    expect(within(dialog).getByText(/此视图不代表你是圈内成员/)).toHaveTextContent(
      '不授予世界或匿名访问',
    );
    expect(within(dialog).getByText(/公告频道仅圈主或圈管理员发布主帖/)).toHaveTextContent(
      '成员点赞、评论',
    );
    expect(within(dialog).getByRole('img', { name: '圈帖图片 1' })).toHaveAttribute(
      'src',
      imageURL,
    );
    expect(within(dialog).getByRole('link', { name: '管理圈内图片 1' })).toHaveAttribute(
      'href',
      `/media?q=${imageURL.split('/').at(-1)}&detail=${imageURL.split('/').at(-1)}`,
    );
    fireEvent.change(within(dialog).getByLabelText('圈帖状态'), { target: { value: 'published' } });
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: '核实圈内图片与内容可用' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '检查处理结果' }));
    const confirm = within(dialog).getByRole('region', { name: '确认圈帖审核' });
    expect(confirm).toHaveTextContent(`${circle.name} / ${post.channelName}`);
    expect(confirm).toHaveTextContent('不是公开到世界');
    fireEvent.click(within(confirm).getByRole('button', { name: '确认保存处理结果' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('圈子已暂停，不能发布');
    expect(within(dialog).getByRole('textbox')).toHaveValue('核实圈内图片与内容可用');
    expect(screen.queryByText(/圈帖已保存为/)).not.toBeInTheDocument();
    allowed = true;
    fireEvent.click(within(confirm).getByRole('button', { name: '确认保存处理结果' }));
    await screen.findByText('圈帖已保存为「圈内已发布」，处理说明已记录审计。');
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/admin/circle-posts/${post.id}`,
      expect.objectContaining({ body: '{"status":"published","note":"核实圈内图片与内容可用"}' }),
    );
  });

  it('keeps circle/status/search/page filters in the URL and exposes read failures for retry', async () => {
    let available = false;
    const fetch = mockService(() =>
      available ? ok({ items: [post], total: 45 }) : failure(503, '圈帖服务暂不可用'),
    );
    mount(`/circles/posts?circleId=${circle.id}&status=pending&offset=20`);
    expect(await screen.findByRole('alert')).toHaveTextContent('圈帖服务暂不可用');
    available = true;
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await screen.findByRole('table', { name: '圈帖审核列表' });
    expect(screen.getByText('第 2 页')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索圈帖标题、正文、ID 或作者'), {
      target: { value: '构图' },
    });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/api/v1/admin/circle-posts?circleId=${circle.id}&status=pending&q=${encodeURIComponent('构图')}&offset=0&limit=20`,
        expect.anything(),
      ),
    );
    await screen.findByRole('table', { name: '圈帖审核列表' });
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/api/v1/admin/circle-posts?circleId=${circle.id}&status=pending&q=${encodeURIComponent('构图')}&offset=20&limit=20`,
        expect.anything(),
      ),
    );
    await screen.findByRole('table', { name: '圈帖审核列表' });
    fireEvent.change(screen.getByLabelText('筛选圈子 ID'), { target: { value: 'circle_other' } });
    fireEvent.click(screen.getByRole('button', { name: '筛选圈子' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/api/v1/admin/circle-posts?circleId=circle_other&status=pending&q=${encodeURIComponent('构图')}&offset=0&limit=20`,
        expect.anything(),
      ),
    );
  });

  it('sends circle-post reports to the independent circle review route', async () => {
    const report: Report = {
      id: 'report-circle',
      reporterId: 'user-reporter',
      targetId: post.id,
      targetType: 'circle-post',
      reason: '圈内内容投诉',
      status: 'open',
      note: '',
      createdAt: post.createdAt,
    };
    mockService((url) =>
      ok({ items: url.includes('/admin/reports') ? [report] : [post], total: 1 }),
    );
    mount('/reports?detail=report-circle');
    const dialog = await screen.findByRole('dialog', { name: '举报工单' });
    const target = within(dialog).getByRole('link', { name: '查看被举报圈内帖子' });
    expect(target).toHaveAttribute('href', `/circles/posts?q=${post.id}&detail=${post.id}`);
    fireEvent.click(target);
    const review = await screen.findByRole('dialog', { name: '圈帖审核详情' });
    expect(within(review).getByText(post.body)).toBeInTheDocument();
    expect(within(review).getByText(/当前通过平台审核权限读取圈帖/)).toBeInTheDocument();
  });

  it('separates world and circle image references without labeling private posts public', async () => {
    const media: AdminMediaAsset = {
      id: imageURL.split('/').at(-1)!,
      url: imageURL,
      contentType: 'image/png',
      width: 800,
      height: 600,
      bytes: 1536,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      scope: 'circle',
      circleId: circle.id,
      owner,
      status: 'ready',
      note: '',
      referenceCount: 3,
      publishedReferenceCount: 0,
      posts: [],
      circleReferenceCount: 3,
      circlePublishedReferenceCount: 2,
      circlePosts: [
        {
          id: post.id,
          circleId: post.circleId,
          channelId: post.channelId,
          body: post.body,
          status: 'published',
        },
      ],
    };
    mockService(() => ok({ items: [media], total: 1 }));
    mount(`/media?detail=${media.id}`);
    const dialog = await screen.findByRole('dialog', { name: '图片审核' });
    expect(within(dialog).getByText('圈内图片 · 不授予匿名或世界访问')).toBeInTheDocument();
    expect(within(dialog).getByText('共 3 篇 · 0 篇世界公开 · 2 篇圈内已发布')).toBeInTheDocument();
    const circleRefs = within(dialog).getByRole('region', { name: '圈内引用帖子' });
    expect(circleRefs).toHaveTextContent('圈内已发布');
    expect(within(circleRefs).getByRole('link', { name: new RegExp(post.body) })).toHaveAttribute(
      'href',
      `/circles/posts?circleId=${circle.id}&q=${post.id}&detail=${post.id}`,
    );
    expect(within(dialog).getByRole('region', { name: '世界引用帖子' })).toHaveTextContent(
      '没有世界帖子引用这张图片',
    );
    expect(within(dialog).getByRole('link', { name: '查看所属圈子治理' })).toHaveAttribute(
      'href',
      `/circles?q=${circle.id}&detail=${circle.id}`,
    );
  });

  it('discards a delayed governance receipt after an operator switch and aborts the old view', async () => {
    let resolvePatch!: (value: Response) => void;
    let signal: AbortSignal | undefined;
    const other = { ...operator, id: 'moderator-2', name: '另一审核员' };
    const fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.endsWith('/admin/system')) return Promise.resolve(ok(system));
      if (options?.method === 'PATCH') {
        signal = options.signal as AbortSignal;
        return new Promise<Response>((resolve) => {
          resolvePatch = resolve;
        });
      }
      return Promise.resolve(ok({ items: [circle], total: 1 }));
    });
    vi.stubGlobal('fetch', fetch);
    const value = (user: User): SessionContextValue => ({
      session: session(user),
      status: 'authenticated',
      error: '',
      expired: false,
      refresh: async () => {},
      login: async () => {},
      logout: async () => {},
    });
    const tree = (user: User) => (
      <MemoryRouter initialEntries={[`/circles?detail=${circle.id}`]}>
        <SessionContext value={value(user)}>
          <App />
        </SessionContext>
      </MemoryRouter>
    );
    setExpectedAccount(operator.id);
    const view = render(tree(operator));
    const dialog = await screen.findByRole('dialog', { name: '圈子治理详情' });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '旧账号说明' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '检查处理结果' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认保存处理结果' }));
    await waitFor(() => expect(resolvePatch).toBeTypeOf('function'));
    setExpectedAccount(other.id);
    view.rerender(tree(other));
    const nextDialog = await screen.findByRole('dialog', { name: '圈子治理详情' });
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      resolvePatch(ok({ ...circle, status: 'suspended' }));
    });
    expect(screen.queryByText(/圈子治理已保存为/)).not.toBeInTheDocument();
    expect(within(nextDialog).getByRole('textbox')).toHaveValue('');
    expect(within(nextDialog).getByLabelText('圈子状态')).toHaveValue('active');
  });

  it('keeps an empty filtered queue and missing record readable', async () => {
    mockService(() => ok({ items: [], total: 0 }));
    mount(`/circles/posts?detail=${post.id}`);
    const missing = await screen.findByRole('dialog', { name: '未找到圈帖' });
    expect(within(missing).getByText('此圈帖不在当前列表')).toBeInTheDocument();
    expect(screen.getByText('没有符合条件的记录')).toBeInTheDocument();
    fireEvent.click(within(missing).getByRole('button', { name: '关闭详情' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
