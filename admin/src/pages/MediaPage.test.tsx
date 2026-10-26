import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceAccountEpoch, setExpectedAccount } from '../../../src/shared/api/account-guard';
import App from '../App';
import SessionProvider from '../SessionProvider';
import { SessionContext, type SessionContextValue } from '../session-context';
import type { AdminMediaAsset, Session, User } from '../types';

const moderator: User = {
  id: 'moderator-1',
  handle: 'reviewer',
  name: '图片审核员',
  email: 'reviewer@example.test',
  avatar: '',
  bio: '',
  role: 'moderator',
  status: 'active',
  createdAt: '2026-10-27T02:00:00Z',
};
const asset: AdminMediaAsset = {
  id: 'media_' + 'ab'.repeat(16),
  url: '/api/v1/media/images/media_' + 'ab'.repeat(16),
  contentType: 'image/png',
  width: 1200,
  height: 800,
  bytes: 153600,
  createdAt: '2026-10-27T03:00:00Z',
  updatedAt: '2026-10-27T03:00:00Z',
  owner: { id: 'member-1', name: '图片作者', handle: 'author', avatar: '', bio: '' },
  status: 'ready',
  note: '',
  referenceCount: 14,
  publishedReferenceCount: 2,
  posts: [{ id: 'post-1', body: '需要核实的图片帖子', status: 'published' }],
};
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const failure = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { code: 'test_error', message } }), { status });
const session = (user = moderator): Session => ({
  user,
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
});
const mount = (path = '/media') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </MemoryRouter>,
  );
const system = {
  version: 'test',
  storage: 'PostgreSQL',
  environment: 'development',
  uptimeSeconds: 50,
  features: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  setExpectedAccount('');
});

describe('hosted image moderation', () => {
  it('opens the standalone moderator route with original preview and bounded reference details', async () => {
    const fetch = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          url.endsWith('/auth/me')
            ? ok(session())
            : url.endsWith('/admin/system')
              ? ok(system)
              : ok({ items: [{ ...asset, status: 'blocked' }], total: 1 }),
        ),
      );
    vi.stubGlobal('fetch', fetch);
    mount(`/media?q=${asset.id}&status=blocked&detail=${asset.id}`);
    const dialog = await screen.findByRole('dialog', { name: '图片审核' });
    const links = within(screen.getByRole('navigation', { name: '运营导航' })).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(
      expect.arrayContaining([
        '内容审核03',
        '图片管理04',
        '举报中心05',
        '操作审计06',
        '系统状态07',
      ]),
    );
    expect(within(dialog).getByRole('img', { name: '托管图片预览' })).toHaveAttribute(
      'src',
      asset.url,
    );
    expect(within(dialog).getByText(/共 14 篇，预览最近最多 10 篇/)).toHaveTextContent('200 字');
    expect(within(dialog).getByText('image/png · 150 KiB')).toBeInTheDocument();
    expect(within(dialog).getByText('1,200 × 800 px')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /需要核实的图片帖子/ })).toHaveAttribute(
      'href',
      '/content?q=post-1&detail=post-1',
    );
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/admin/media?q=${asset.id}&status=blocked&offset=0&limit=20`,
      expect.anything(),
    );
  });

  it('requires a reason and concrete confirmation, preserves failures, then refreshes actual server data', async () => {
    let current = asset;
    let writes = 0;
    const fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.endsWith('/auth/me')) return Promise.resolve(ok(session()));
      if (url.endsWith('/admin/system')) return Promise.resolve(ok(system));
      if (options?.method === 'PATCH') {
        writes += 1;
        if (writes === 1) return Promise.resolve(failure(403, '当前权限已变更，请重新核实'));
        current = {
          ...asset,
          status: 'blocked',
          note: '已核实图片侵犯隐私',
          updatedAt: '2026-10-27T04:00:00Z',
          publishedReferenceCount: 0,
        };
        return Promise.resolve(ok(current));
      }
      return Promise.resolve(ok({ items: [current], total: 1 }));
    });
    vi.stubGlobal('fetch', fetch);
    mount(`/media?detail=${asset.id}`);
    const dialog = await screen.findByRole('dialog', { name: '图片审核' });
    const review = within(dialog).getByRole('button', { name: '检查图片处理' });
    expect(review).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '  ' } });
    expect(review).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('图片状态'), { target: { value: 'blocked' } });
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: ' 已核实图片侵犯隐私 ' },
    });
    fireEvent.click(review);
    expect(writes).toBe(0);
    const confirmation = within(dialog).getByRole('region', { name: '确认屏蔽图片' });
    expect(confirmation).toHaveTextContent(asset.id);
    expect(confirmation).toHaveTextContent('同时隐藏全部已发布的引用帖子');
    expect(confirmation).toHaveTextContent('待审核帖子保持待审核');
    fireEvent.click(within(confirmation).getByRole('button', { name: '确认屏蔽并保存' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '当前权限已变更，请重新核实',
    );
    expect(within(dialog).getByRole('textbox')).toHaveValue(' 已核实图片侵犯隐私 ');
    expect(screen.queryByText(/图片已保存为/)).not.toBeInTheDocument();
    fireEvent.click(within(confirmation).getByRole('button', { name: '确认屏蔽并保存' }));
    await screen.findByText('图片已保存为「已屏蔽」，处理说明与审计记录已更新。');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/admin/media/${asset.id}`,
      expect.objectContaining({
        method: 'PATCH',
        body: '{"status":"blocked","note":"已核实图片侵犯隐私"}',
      }),
    );
    expect(
      fetch.mock.calls.filter(([url]) => (url as string).includes('/admin/media?')).length,
    ).toBeGreaterThan(1);
    expect(screen.getByRole('table')).toHaveTextContent('已屏蔽');
  });

  it('allows updating the handling note without changing image availability', async () => {
    const fetch = vi
      .fn()
      .mockImplementation((url: string, options?: RequestInit) =>
        Promise.resolve(
          url.endsWith('/auth/me')
            ? ok(session())
            : url.endsWith('/admin/system')
              ? ok(system)
              : options?.method === 'PATCH'
                ? ok({ ...asset, note: '补充核实依据' })
                : ok({ items: [asset], total: 1 }),
        ),
      );
    vi.stubGlobal('fetch', fetch);
    mount(`/media?detail=${asset.id}`);
    const dialog = await screen.findByRole('dialog', { name: '图片审核' });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '补充核实依据' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '检查图片处理' }));
    expect(within(dialog).getByRole('region', { name: '确认图片可用' })).toHaveTextContent(
      '不会自动恢复发布',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: '确认可用并保存' }));
    await screen.findByText('图片已保存为「可用」，处理说明与审计记录已更新。');
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/admin/media/${asset.id}`,
      expect.objectContaining({ body: '{"status":"ready","note":"补充核实依据"}' }),
    );
  });

  it('persists search/filter/pagination in the route and can retry a failed read', async () => {
    let unavailable = true;
    const fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/auth/me')) return Promise.resolve(ok(session()));
      if (url.endsWith('/admin/system')) return Promise.resolve(ok(system));
      return Promise.resolve(
        unavailable ? failure(503, '图片服务暂时不可用') : ok({ items: [asset], total: 45 }),
      );
    });
    vi.stubGlobal('fetch', fetch);
    mount('/media?status=ready&offset=20');
    expect(await screen.findByRole('alert')).toHaveTextContent('图片服务暂时不可用');
    unavailable = false;
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await screen.findByRole('table', { name: '托管图片列表' });
    expect(screen.getByText('第 2 页')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索图片 ID、上传者或引用帖子 ID'), {
      target: { value: 'author' },
    });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/admin/media?q=author&status=ready&offset=0&limit=20',
        expect.anything(),
      ),
    );
    await screen.findByRole('table', { name: '托管图片列表' });
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/admin/media?q=author&status=ready&offset=20&limit=20',
        expect.anything(),
      ),
    );
    await screen.findByRole('table', { name: '托管图片列表' });
    fireEvent.change(screen.getByLabelText('筛选图片状态'), { target: { value: 'blocked' } });
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/admin/media?q=author&status=blocked&offset=0&limit=20',
        expect.anything(),
      ),
    );
  });

  it('keeps an empty queue and a missing detail readable, and allows preview retry', async () => {
    let populated = false;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(
            url.endsWith('/auth/me')
              ? ok(session())
              : url.endsWith('/admin/system')
                ? ok(system)
                : ok({ items: populated ? [asset] : [], total: populated ? 1 : 0 }),
          ),
        ),
    );
    mount(`/media?detail=${asset.id}`);
    const missing = await screen.findByRole('dialog', { name: '未找到图片' });
    expect(within(missing).getByText('这张图片不在当前列表')).toBeInTheDocument();
    expect(screen.getByText('没有符合条件的记录')).toBeInTheDocument();
    fireEvent.click(within(missing).getByRole('button', { name: '关闭详情' }));
    populated = true;
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    fireEvent.click(await screen.findByRole('button', { name: `审核图片 ${asset.id}` }));
    const dialog = await screen.findByRole('dialog', { name: '图片审核' });
    fireEvent.error(within(dialog).getByRole('img', { name: '托管图片预览' }));
    expect(within(dialog).getByText('图片预览暂时无法加载')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '重试图片预览' }));
    expect(within(dialog).getByRole('img', { name: '托管图片预览' })).toHaveAttribute(
      'src',
      asset.url,
    );
  });

  it('discards a late mutation receipt when the operator account changes', async () => {
    let resolvePatch!: (value: Response) => void;
    let patchSignal: AbortSignal | undefined;
    const newOperator = { ...moderator, id: 'moderator-2', handle: 'other', name: '另一位审核员' };
    const fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.endsWith('/admin/system')) return Promise.resolve(ok(system));
      if (options?.method === 'PATCH') {
        patchSignal = options.signal as AbortSignal;
        return new Promise<Response>((resolve) => {
          resolvePatch = resolve;
        });
      }
      return Promise.resolve(ok({ items: [asset], total: 1 }));
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
      <MemoryRouter initialEntries={[`/media?detail=${asset.id}`]}>
        <SessionContext value={value(user)}>
          <App />
        </SessionContext>
      </MemoryRouter>
    );
    setExpectedAccount(moderator.id);
    const view = render(tree(moderator));
    const oldDialog = await screen.findByRole('dialog', { name: '图片审核' });
    fireEvent.change(within(oldDialog).getByRole('textbox'), {
      target: { value: '原账号处理说明' },
    });
    fireEvent.click(within(oldDialog).getByRole('button', { name: '检查图片处理' }));
    fireEvent.click(within(oldDialog).getByRole('button', { name: '确认可用并保存' }));
    await waitFor(() => expect(resolvePatch).toBeTypeOf('function'));
    setExpectedAccount(newOperator.id);
    view.rerender(tree(newOperator));
    const newDialog = await screen.findByRole('dialog', { name: '图片审核' });
    expect(patchSignal?.aborted).toBe(true);
    expect(within(newDialog).getByRole('textbox')).toHaveValue('');
    const readsBefore = fetch.mock.calls.filter(
      ([, options]) => options?.method !== 'PATCH',
    ).length;
    await act(async () => {
      resolvePatch(ok({ ...asset, note: '原账号处理说明' }));
    });
    expect(screen.queryByText(/图片已保存为/)).not.toBeInTheDocument();
    expect(within(newDialog).getByRole('textbox')).toHaveValue('');
    expect(fetch.mock.calls.filter(([, options]) => options?.method !== 'PATCH')).toHaveLength(
      readsBefore,
    );
  });

  it('unlocks a retained dialog without accepting an obsolete account-epoch receipt', async () => {
    let resolvePatch!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (url.endsWith('/auth/me')) return Promise.resolve(ok(session()));
        if (url.endsWith('/admin/system')) return Promise.resolve(ok(system));
        if (options?.method === 'PATCH')
          return new Promise<Response>((resolve) => {
            resolvePatch = resolve;
          });
        return Promise.resolve(ok({ items: [asset], total: 1 }));
      }),
    );
    mount(`/media?detail=${asset.id}`);
    const dialog = await screen.findByRole('dialog', { name: '图片审核' });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '尚未确认的操作' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '检查图片处理' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认可用并保存' }));
    await waitFor(() => expect(resolvePatch).toBeTypeOf('function'));
    advanceAccountEpoch();
    await act(async () => {
      resolvePatch(ok({ ...asset, note: '尚未确认的操作' }));
    });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('登录会话已变化');
    expect(screen.queryByText(/图片已保存为/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '关闭详情' })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole('button', { name: '返回修改' }));
    expect(within(dialog).getByRole('textbox')).toHaveValue('尚未确认的操作');
  });

  it('links hosted images in content review to their media record with clear publishing semantics', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          url.endsWith('/auth/me')
            ? ok(session())
            : url.endsWith('/admin/system')
              ? ok(system)
              : ok({
                  items: [
                    {
                      id: 'post-1',
                      author: asset.owner,
                      body: '包含托管图片的帖子',
                      images: [asset.url],
                      topic: '',
                      status: 'pending',
                      createdAt: asset.createdAt,
                      likeCount: 0,
                      liked: false,
                      commentCount: 0,
                    },
                  ],
                  total: 1,
                }),
        ),
      ),
    );
    mount('/content?detail=post-1');
    const dialog = await screen.findByRole('dialog', { name: '内容审核' });
    expect(within(dialog).getByText(/图片可用不代表帖子已通过审核/)).toHaveTextContent(
      '恢复图片后仍需单独审核帖子',
    );
    expect(within(dialog).getByRole('link', { name: '管理图片 1' })).toHaveAttribute(
      'href',
      `/media?q=${asset.id}&detail=${asset.id}`,
    );
  });
});
