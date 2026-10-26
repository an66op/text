import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { advanceAccountEpoch } from '@/shared/api/account-guard';
import { AuthContext, type AuthState } from '../auth-context';
import { circlesApi } from '../circles/api';
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
  circleReferenceCount: 0,
  circlePublishedReferenceCount: 0,
  circlePosts: [],
  posts: [],
  updatedAt: uploadedImage.createdAt,
};
const another = {
  ...asset,
  id: `media_${'b'.repeat(32)}`,
  url: `/api/v1/media/images/media_${'b'.repeat(32)}`,
};
const circleId = `circle_${'d'.repeat(32)}`;
const circlePost = {
  id: `cpost_${'e'.repeat(32)}`,
  circleId,
  channelId: `cchannel_${'f'.repeat(32)}`,
  body: '本人保存在圈内的作品',
  status: 'published' as const,
};
const circleAsset: MyMediaAsset = {
  ...asset,
  scope: 'circle',
  circleId,
  referenceCount: 1,
  circleReferenceCount: 1,
  circlePublishedReferenceCount: 1,
  circlePosts: [circlePost],
};
const page = (auth: AuthState = signedIn()) => (
  <MemoryRouter initialEntries={['/account/uploads']}>
    <AuthContext.Provider value={auth}>
      <MyUploadsPage />
    </AuthContext.Provider>
  </MemoryRouter>
);
function UploadNavigation({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => void navigate(to)}>
      {label}
    </button>
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.spyOn(mediaApi, 'mine').mockResolvedValue({ items: [asset], total: 1 });
  vi.spyOn(circlesApi, 'deletePost').mockResolvedValue({ ok: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('owned server image recovery', () => {
  it('follows a strict uploaded-image deep link and hides and aborts previous results while the target changes', async () => {
    const oldTarget = deferred<MyMediaPage>();
    const newTarget = deferred<MyMediaPage>();
    const newest = {
      ...asset,
      id: `media_${'c'.repeat(32)}`,
      url: `/api/v1/media/images/media_${'c'.repeat(32)}`,
      status: 'blocked' as const,
    };
    vi.mocked(mediaApi.mine)
      .mockResolvedValueOnce({ items: [asset], total: 1 })
      .mockReturnValueOnce(oldTarget.promise)
      .mockReturnValueOnce(newTarget.promise);
    render(
      <MemoryRouter initialEntries={[`/account/uploads?image=${asset.id}`]}>
        <AuthContext.Provider value={signedIn()}>
          <UploadNavigation to={`/account/uploads?image=${another.id}`} label="切换上传链接" />
          <UploadNavigation to={`/account/uploads?image=${newest.id}`} label="打开最新上传" />
          <MyUploadsPage />
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('textbox', { name: '搜索我的上传' })).toHaveValue(asset.id);
    expect(mediaApi.mine).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: asset.id, offset: 0, status: undefined }),
      expect.any(AbortSignal),
    );
    await screen.findByRole('article', { name: '上传 aaaaaaaa' });
    fireEvent.click(screen.getByRole('button', { name: '切换上传链接' }));
    expect(screen.queryByRole('article', { name: '上传 aaaaaaaa' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '搜索我的上传' })).toHaveValue(another.id);
    expect(mediaApi.mine).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: another.id, offset: 0, status: undefined }),
      expect.any(AbortSignal),
    );
    const oldSignal = vi.mocked(mediaApi.mine).mock.calls[1][1]!;
    fireEvent.click(screen.getByRole('button', { name: '打开最新上传' }));
    expect(oldSignal.aborted).toBe(true);
    expect(screen.getByRole('textbox', { name: '搜索我的上传' })).toHaveValue(newest.id);
    await act(async () => oldTarget.resolve({ items: [another], total: 1 }));
    expect(screen.queryByRole('article', { name: '上传 aaaaaaaa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('article', { name: '上传 bbbbbbbb' })).not.toBeInTheDocument();
    await act(async () => newTarget.resolve({ items: [newest], total: 1 }));
    await screen.findByRole('article', { name: '上传 cccccccc' });
    expect(screen.getByText('已屏蔽，暂不可预览')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: '上传图片 cccccccc' })).not.toBeInTheDocument();
  });

  it('does not turn arbitrary, duplicated or unsafe image query values into an upload search', async () => {
    for (const query of [
      'image=%3Cscript%3E',
      'image=media_123',
      `image=media_${'A'.repeat(32)}`,
      `image=${asset.id}&image=${another.id}`,
      `q=${asset.id}`,
    ]) {
      const view = render(
        <MemoryRouter initialEntries={[`/account/uploads?${query}`]}>
          <AuthContext.Provider value={signedIn()}>
            <MyUploadsPage />
          </AuthContext.Provider>
        </MemoryRouter>,
      );
      await screen.findByRole('article', { name: '上传 aaaaaaaa' });
      expect(screen.getByRole('textbox', { name: '搜索我的上传' })).toHaveValue('');
      expect(mediaApi.mine).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: '', offset: 0 }),
        expect.any(AbortSignal),
      );
      view.unmount();
    }
  });

  it('labels published circle references as circle-only and links to their protected detail instead of the world', async () => {
    const circleId = `circle_${'d'.repeat(32)}`;
    vi.mocked(mediaApi.mine).mockResolvedValue({
      items: [
        {
          ...asset,
          scope: 'circle',
          circleId,
          referenceCount: 1,
          circleReferenceCount: 1,
          circlePublishedReferenceCount: 1,
          circlePosts: [
            {
              id: 'circle-post',
              circleId,
              channelId: 'channel-one',
              body: '圈内作品',
              status: 'published',
            },
          ],
        },
      ],
      total: 1,
    });
    render(page());
    await screen.findByText('圈内可读');
    expect(screen.queryByText('已有公开引用')).not.toBeInTheDocument();
    expect(screen.getByText(/仅绑定所属圈子/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /已发布\s*圈内作品/ })).toHaveAttribute(
      'href',
      `/circles/s/${circleId}/posts/circle-post`,
    );
    expect(screen.queryByRole('button', { name: '删除上传 aaaaaaaa' })).not.toBeInTheDocument();
  });

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
    expect(screen.getByText('2 条引用 · 1 条世界公开')).toBeInTheDocument();
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

  it('cleans a whole circle post by known reference after confirmation, reloads server counts and keeps the original image', async () => {
    const deleting = deferred<{ ok: true }>();
    const reloading = deferred<MyMediaPage>();
    const removeImage = vi.spyOn(mediaApi, 'remove');
    const circleDetails = vi.spyOn(circlesApi, 'circle');
    const postDetails = vi.spyOn(circlesApi, 'post');
    vi.mocked(mediaApi.mine)
      .mockResolvedValueOnce({ items: [circleAsset], total: 1 })
      .mockReturnValueOnce(reloading.promise);
    vi.mocked(circlesApi.deletePost).mockReturnValue(deleting.promise);
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: '删除圈帖 eeeeeeee' }));
    const dialog = screen.getByRole('dialog', { name: '删除这篇本人圈帖？' });
    expect(dialog).toHaveTextContent('整篇圈帖 eeeeeeee');
    expect(dialog).toHaveTextContent('这篇帖子的全部图片引用');
    expect(dialog).toHaveTextContent(circlePost.body);
    expect(dialog).toHaveTextContent('原图片会继续保留');
    expect(circlesApi.deletePost).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '确认删除圈帖' }));
    expect(circlesApi.deletePost).toHaveBeenCalledWith(
      circleId,
      circlePost.id,
      expect.any(AbortSignal),
    );
    expect(screen.getByText('1 条引用 · 0 条世界公开 · 1 条圈内引用')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除上传 aaaaaaaa' })).not.toBeInTheDocument();
    await act(async () => deleting.resolve({ ok: true }));
    await screen.findByText('正在读取服务器上传…');
    expect(mediaApi.mine).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('1 条引用 · 0 条世界公开 · 1 条圈内引用')).not.toBeInTheDocument();
    const orphan = {
      ...circleAsset,
      referenceCount: 0,
      circleReferenceCount: 0,
      circlePublishedReferenceCount: 0,
      circlePosts: [],
    };
    await act(async () => reloading.resolve({ items: [orphan], total: 1 }));
    await screen.findByRole('button', { name: '删除上传 aaaaaaaa' });
    expect(screen.getByRole('article', { name: '上传 aaaaaaaa' })).toBeInTheDocument();
    expect(screen.getByText(/圈帖已删除，原图片仍保留/)).toBeInTheDocument();
    expect(removeImage).not.toHaveBeenCalled();
    expect(circleDetails).not.toHaveBeenCalled();
    expect(postDetails).not.toHaveBeenCalled();
  });

  it('reveals later circle references from the fresh server page and never infers that an image has become orphaned', async () => {
    const latestReferences = Array.from({ length: 10 }, (_, index) => ({
      ...circlePost,
      id: `cpost_${String(index).padStart(32, '0')}`,
      body: `较新的引用 ${index + 1}`,
    }));
    const olderReference = {
      ...circlePost,
      id: `cpost_${'9'.repeat(32)}`,
      body: '刷新后出现的较早引用',
    };
    vi.mocked(mediaApi.mine)
      .mockResolvedValueOnce({
        items: [
          {
            ...circleAsset,
            referenceCount: 11,
            circleReferenceCount: 11,
            circlePosts: latestReferences,
          },
        ],
        total: 1,
      })
      .mockResolvedValue({
        items: [
          {
            ...circleAsset,
            referenceCount: 10,
            circleReferenceCount: 10,
            circlePosts: [...latestReferences.slice(1), olderReference],
          },
        ],
        total: 1,
      });
    render(page());
    await screen.findByText('较新的引用 1');
    expect(screen.getByText(/最多展示最近 10 条引用/)).toBeInTheDocument();
    expect(screen.queryByText(olderReference.body)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '删除圈帖 00000000' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '确认删除圈帖' }),
    );
    await screen.findByText(olderReference.body);
    expect(screen.getByText('10 条引用 · 0 条世界公开 · 10 条圈内引用')).toBeInTheDocument();
    expect(screen.queryByText('较新的引用 1')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^删除圈帖 / })).toHaveLength(10);
    expect(screen.queryByRole('button', { name: '删除上传 aaaaaaaa' })).not.toBeInTheDocument();
  });

  it('retains a failed circle cleanup for manual retry and requires an explicit server acknowledgement', async () => {
    vi.mocked(mediaApi.mine).mockResolvedValue({ items: [circleAsset], total: 1 });
    vi.mocked(circlesApi.deletePost)
      .mockResolvedValueOnce({ ok: false } as unknown as { ok: true })
      .mockRejectedValueOnce(new ApiError('服务暂时无法处理，请稍后重试', 'unavailable', 503))
      .mockResolvedValue({ ok: true });
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: '删除圈帖 eeeeeeee' }));
    const confirm = () =>
      within(screen.getByRole('dialog')).getByRole('button', { name: '确认删除圈帖' });
    fireEvent.click(confirm());
    await screen.findByText('服务尚未确认圈帖已删除，请刷新引用后重试');
    expect(confirm()).toBeEnabled();
    expect(mediaApi.mine).toHaveBeenCalledOnce();
    expect(screen.getByText('1 条引用 · 0 条世界公开 · 1 条圈内引用')).toBeInTheDocument();
    fireEvent.click(confirm());
    await screen.findByText('服务暂时无法处理，请稍后重试');
    expect(circlesApi.deletePost).toHaveBeenCalledTimes(2);
    expect(mediaApi.mine).toHaveBeenCalledOnce();
    expect(screen.queryByText(/圈帖已删除，原图片仍保留/)).not.toBeInTheDocument();
    fireEvent.click(confirm());
    await screen.findByText(/圈帖已删除，原图片仍保留/);
    await waitFor(() => expect(mediaApi.mine).toHaveBeenCalledTimes(2));
  });

  it.each([403, 404])(
    'offers a fresh reference check instead of claiming cleanup succeeded on HTTP %s',
    async (status) => {
      vi.mocked(mediaApi.mine).mockResolvedValue({ items: [circleAsset], total: 1 });
      vi.mocked(circlesApi.deletePost).mockRejectedValue(
        new ApiError('圈帖当前无法处理', 'forbidden', status),
      );
      render(page());
      fireEvent.click(await screen.findByRole('button', { name: '删除圈帖 eeeeeeee' }));
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: '确认删除圈帖' }),
      );
      await screen.findByText('暂时无法清理此圈帖：圈帖当前无法处理。请刷新引用，确认最新状态。');
      expect(screen.queryByText(/圈帖已删除，原图片仍保留/)).not.toBeInTheDocument();
      expect(mediaApi.mine).toHaveBeenCalledOnce();
      vi.mocked(mediaApi.mine).mockResolvedValue({ items: [asset], total: 1 });
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '刷新引用' }));
      await screen.findByRole('button', { name: '删除上传 aaaaaaaa' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(circlesApi.deletePost).toHaveBeenCalledOnce();
      expect(screen.getByText('尚未确认圈帖已删除，正在重新读取服务器引用。')).toBeInTheDocument();
    },
  );

  it('does not offer circle deletion for world images or references outside the bound circle', async () => {
    vi.mocked(mediaApi.mine).mockResolvedValue({
      items: [
        { ...asset, referenceCount: 1, circlePosts: [circlePost] },
        {
          ...circleAsset,
          ...another,
          scope: 'circle',
          circleId: `circle_${'3'.repeat(32)}`,
          circlePosts: [circlePost],
        },
      ],
      total: 2,
    });
    render(page());
    await screen.findByRole('article', { name: '上传 aaaaaaaa' });
    expect(screen.queryByRole('button', { name: /^删除圈帖 / })).not.toBeInTheDocument();
    expect(circlesApi.deletePost).not.toHaveBeenCalled();
  });

  it('aborts a circle cleanup on account change and ignores its late success without refreshing the new account', async () => {
    const deleting = deferred<{ ok: true }>();
    vi.mocked(mediaApi.mine).mockResolvedValueOnce({ items: [circleAsset], total: 1 });
    vi.mocked(circlesApi.deletePost).mockReturnValue(deleting.promise);
    const view = render(page());
    fireEvent.click(await screen.findByRole('button', { name: '删除圈帖 eeeeeeee' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '确认删除圈帖' }),
    );
    const signal = vi.mocked(circlesApi.deletePost).mock.calls[0][2]!;
    vi.mocked(mediaApi.mine).mockResolvedValue({
      items: [{ ...another, owner: otherMember }],
      total: 1,
    });
    view.rerender(page(signedIn(otherMember)));
    await screen.findByRole('article', { name: '上传 bbbbbbbb' });
    expect(signal.aborted).toBe(true);
    await act(async () => deleting.resolve({ ok: true }));
    expect(mediaApi.mine).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/圈帖已删除，原图片仍保留/)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('rejects stale circle actions and late responses after the account epoch changes', async () => {
    const deleting = deferred<{ ok: true }>();
    vi.mocked(mediaApi.mine).mockResolvedValue({ items: [circleAsset], total: 1 });
    vi.mocked(circlesApi.deletePost).mockReturnValue(deleting.promise);
    const view = render(page());
    fireEvent.click(await screen.findByRole('button', { name: '删除圈帖 eeeeeeee' }));
    advanceAccountEpoch();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '确认删除圈帖' }),
    );
    expect(circlesApi.deletePost).not.toHaveBeenCalled();
    view.rerender(page());
    fireEvent.click(await screen.findByRole('button', { name: '删除圈帖 eeeeeeee' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '确认删除圈帖' }),
    );
    advanceAccountEpoch();
    await act(async () => deleting.resolve({ ok: true }));
    expect(screen.queryByText(/圈帖已删除，原图片仍保留/)).not.toBeInTheDocument();
    expect(mediaApi.mine).toHaveBeenCalledTimes(2);
  });

  it('aborts a circle cleanup when the page unmounts or the account permissions change', async () => {
    const deleting = deferred<{ ok: true }>();
    vi.mocked(mediaApi.mine).mockResolvedValue({ items: [circleAsset], total: 1 });
    vi.mocked(circlesApi.deletePost).mockReturnValue(deleting.promise);
    const view = render(page());
    fireEvent.click(await screen.findByRole('button', { name: '删除圈帖 eeeeeeee' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '确认删除圈帖' }),
    );
    const oldSignal = vi.mocked(circlesApi.deletePost).mock.calls[0][2]!;
    view.rerender(page(signedIn({ ...member, role: 'moderator' })));
    await screen.findByRole('button', { name: '删除圈帖 eeeeeeee' });
    expect(oldSignal.aborted).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '删除圈帖 eeeeeeee' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '确认删除圈帖' }),
    );
    const latestSignal = vi.mocked(circlesApi.deletePost).mock.calls[1][2]!;
    view.unmount();
    expect(latestSignal.aborted).toBe(true);
    await act(async () => deleting.resolve({ ok: true }));
    expect(mediaApi.mine).toHaveBeenCalledTimes(2);
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
