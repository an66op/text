import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { AuthContext, type AuthState } from '../auth-context';
import { member, otherMember, signedIn } from '../platform-test-fixtures';
import { mediaApi } from './media-api';
import { uploadedImage } from './media-test-fixtures';
import type { MyMediaAsset, MyMediaPage } from './media-model';
import MyUploadsPage from './MyUploadsPage';

const asset: MyMediaAsset = {
  ...uploadedImage,
  owner: member,
  status: 'ready',
  note: '',
  referenceCount: 0,
  publishedReferenceCount: 0,
  posts: [],
  updatedAt: uploadedImage.createdAt,
};
const another = {
  ...asset,
  id: `media_${'b'.repeat(32)}`,
  url: `/api/v1/media/images/media_${'b'.repeat(32)}`,
};
const page = (auth: AuthState = signedIn()) => (
  <MemoryRouter initialEntries={['/account/uploads']}>
    <AuthContext.Provider value={auth}>
      <MyUploadsPage />
    </AuthContext.Provider>
  </MemoryRouter>
);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.spyOn(mediaApi, 'mine').mockResolvedValue({ items: [asset], total: 1 });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('owned server image recovery', () => {
  it('shows private, publicly referenced and blocked states without fetching blocked previews or offering deletion for referenced images', async () => {
    const blocked = {
      ...another,
      status: 'blocked' as const,
      note: '图片需要更换，请查看社区规范',
    };
    const referenced = {
      ...asset,
      id: `media_${'c'.repeat(32)}`,
      url: `/api/v1/media/images/media_${'c'.repeat(32)}`,
      referenceCount: 2,
      publishedReferenceCount: 1,
      posts: [{ id: 'pending-post', body: '待审图片帖', status: 'pending' as const }],
    };
    vi.mocked(mediaApi.mine).mockResolvedValue({ items: [asset, blocked, referenced], total: 3 });
    render(page());
    await screen.findByRole('article', { name: '上传 aaaaaaaa' });
    expect(screen.getByText('私人上传')).toBeInTheDocument();
    expect(screen.getByText('已有公开引用')).toBeInTheDocument();
    expect(screen.getByText('已屏蔽，暂不可预览')).toBeInTheDocument();
    expect(screen.getByText('审核说明：图片需要更换，请查看社区规范')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: '上传图片 bbbbbbbb' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除上传 cccccccc' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /待审核\s*待审图片帖/ })).toHaveAttribute(
      'href',
      '/world/p/pending-post',
    );
    expect(screen.getByText(/100 张 \/ 100 MiB/)).toBeInTheDocument();
    expect(screen.getByText('2 条引用 · 1 条公开')).toBeInTheDocument();
  });

  it('deletes an orphaned image only after a concrete confirmation and server acknowledgement', async () => {
    const pending = deferred<{ ok: true }>();
    const remove = vi.spyOn(mediaApi, 'remove').mockReturnValue(pending.promise);
    render(page());
    await screen.findByRole('button', { name: '删除上传 aaaaaaaa' });
    fireEvent.click(screen.getByRole('button', { name: '删除上传 aaaaaaaa' }));
    const dialog = screen.getByRole('dialog', { name: '删除这张服务器图片？' });
    expect(dialog).toHaveTextContent('aaaaaaaa');
    expect(dialog).toHaveTextContent('2 KiB');
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '确认删除图片' }));
    expect(screen.getByRole('article', { name: '上传 aaaaaaaa' })).toBeInTheDocument();
    expect(remove).toHaveBeenCalledWith(asset.id, expect.any(AbortSignal));
    vi.mocked(mediaApi.mine).mockResolvedValue({ items: [], total: 0 });
    await act(async () => pending.resolve({ ok: true }));
    await screen.findByText('还没有服务器上传');
    expect(screen.queryByRole('article', { name: '上传 aaaaaaaa' })).not.toBeInTheDocument();
    expect(screen.getByText('图片 aaaaaaaa 已从服务器删除')).toBeInTheDocument();
  });

  it('retains the image and offers manual retry after permission failure', async () => {
    const remove = vi
      .spyOn(mediaApi, 'remove')
      .mockRejectedValueOnce(new ApiError('图片已有引用，无法删除', 'conflict', 409))
      .mockResolvedValue({ ok: true });
    render(page());
    await screen.findByRole('button', { name: '删除上传 aaaaaaaa' });
    fireEvent.click(screen.getByRole('button', { name: '删除上传 aaaaaaaa' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '确认删除图片' }),
    );
    await screen.findByText('图片已有引用，无法删除');
    expect(screen.getByRole('article', { name: '上传 aaaaaaaa' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: '确认删除图片' }),
    ).toBeEnabled();
    expect(remove).toHaveBeenCalledOnce();
    vi.mocked(mediaApi.mine).mockResolvedValue({ items: [], total: 0 });
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '确认删除图片' }),
    );
    await screen.findByText('还没有服务器上传');
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('isolates late account list and deletion responses and aborts both when ownership changes', async () => {
    const oldList = deferred<MyMediaPage>();
    const bobAsset = { ...another, owner: otherMember };
    vi.mocked(mediaApi.mine)
      .mockReturnValueOnce(oldList.promise)
      .mockResolvedValue({ items: [bobAsset], total: 1 });
    const view = render(page());
    const oldSignal = vi.mocked(mediaApi.mine).mock.calls[0][1]!;
    view.rerender(page(signedIn(otherMember)));
    await screen.findByRole('article', { name: '上传 bbbbbbbb' });
    await act(async () => oldList.resolve({ items: [asset], total: 1 }));
    expect(oldSignal.aborted).toBe(true);
    expect(screen.queryByRole('article', { name: '上传 aaaaaaaa' })).not.toBeInTheDocument();
    const deleting = deferred<{ ok: true }>();
    const remove = vi.spyOn(mediaApi, 'remove').mockReturnValue(deleting.promise);
    fireEvent.click(screen.getByRole('button', { name: '删除上传 bbbbbbbb' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '确认删除图片' }),
    );
    const deleteSignal = remove.mock.calls[0][1]!;
    vi.mocked(mediaApi.mine).mockResolvedValue({ items: [asset], total: 1 });
    view.rerender(page());
    await screen.findByRole('article', { name: '上传 aaaaaaaa' });
    await act(async () => deleting.resolve({ ok: true }));
    expect(deleteSignal.aborted).toBe(true);
    expect(remove).toHaveBeenCalledOnce();
    expect(screen.getByRole('article', { name: '上传 aaaaaaaa' })).toBeInTheDocument();
    expect(screen.queryByText('图片 bbbbbbbb 已从服务器删除')).not.toBeInTheDocument();
  });

  it('queries filters and offsets on the server and keeps errors distinct from an empty result', async () => {
    vi.mocked(mediaApi.mine)
      .mockResolvedValueOnce({ items: [asset], total: 13 })
      .mockResolvedValue({ items: [another], total: 13 });
    render(page());
    await screen.findByRole('article', { name: '上传 aaaaaaaa' });
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await screen.findByRole('article', { name: '上传 bbbbbbbb' });
    expect(mediaApi.mine).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 12, limit: 12 }),
      expect.any(AbortSignal),
    );
    fireEvent.change(screen.getByRole('textbox', { name: '搜索我的上传' }), {
      target: { value: 'media_abc' },
    });
    fireEvent.click(screen.getByRole('button', { name: '搜索上传' }));
    await waitFor(() =>
      expect(mediaApi.mine).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 0, q: 'media_abc' }),
        expect.any(AbortSignal),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '屏蔽' }));
    await waitFor(() =>
      expect(mediaApi.mine).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'blocked' }),
        expect.any(AbortSignal),
      ),
    );
    await screen.findByRole('button', { name: '刷新我的上传' });
    vi.mocked(mediaApi.mine).mockRejectedValueOnce(
      new ApiError('服务暂时离线', 'NETWORK_ERROR', 0),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新我的上传' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '刷新我的上传' }));
    await screen.findByText('服务暂时离线');
    expect(screen.queryByText('没有符合条件的上传')).not.toBeInTheDocument();
    expect(screen.queryByRole('article', { name: '上传 bbbbbbbb' })).not.toBeInTheDocument();
  });

  it('requires real authentication and does not substitute local uploads for checking or unavailable states', () => {
    const view = render(page({ ...signedIn(), status: 'guest', user: null }));
    expect(screen.getByRole('link', { name: '登录' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Faccount%2Fuploads',
    );
    view.rerender(page({ ...signedIn(), status: 'checking', user: null }));
    expect(screen.getByText('正在验证账号…')).toBeInTheDocument();
    view.rerender(
      page({ ...signedIn(), status: 'unavailable', user: null, error: '账号服务不可达' }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('账号服务不可达');
    expect(mediaApi.mine).not.toHaveBeenCalled();
  });

  it('does not expose another owner returned in an inconsistent server response', async () => {
    vi.mocked(mediaApi.mine).mockResolvedValue({
      items: [{ ...asset, owner: otherMember }],
      total: 1,
    });
    render(page());
    await screen.findByText('上传列表与当前账号不一致，请重新验证账号');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除上传 aaaaaaaa' })).not.toBeInTheDocument();
  });

  it('encodes account list filters using the authenticated API transport', async () => {
    vi.mocked(mediaApi.mine).mockRestore();
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: { items: [], total: 0 } })));
    vi.stubGlobal('fetch', fetcher);
    await mediaApi.mine({ status: 'ready', q: '图片 & 引用', limit: 12, offset: 24 });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/me/media?status=ready&q=%E5%9B%BE%E7%89%87+%26+%E5%BC%95%E7%94%A8&limit=12&offset=24',
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
