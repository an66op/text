import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { platformApi } from '@/shared/api/platformApi';
import type { PlatformPost } from '@/shared/api/types';
import { AuthContext } from './auth-context';
import { member, otherMember, post, signedIn } from './platform-test-fixtures';
import { mediaApi } from './media/media-api';
import { imageFile, uploadedImage } from './media/media-test-fixtures';
import ServerWorldPage, { WorldPost } from './ServerWorldPage';
import WorldComposer from './WorldComposer';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(platformApi, 'posts').mockResolvedValue({ items: [post], total: 1 });
});
afterEach(() => vi.restoreAllMocks());
const composer = (onPublished = vi.fn(), user = member) => (
  <MemoryRouter>
    <AuthContext.Provider value={signedIn(user)}>
      <WorldComposer onClose={vi.fn()} onPublished={onPublished} />
    </AuthContext.Provider>
  </MemoryRouter>
);
const selectImage = () =>
  fireEvent.change(screen.getByLabelText('选择帖子图片'), { target: { files: [imageFile()] } });

describe('managed image world publishing', () => {
  it('blocks publishing until upload completes, then shows the server pending status and real detail link', async () => {
    const pending = deferred<typeof uploadedImage>();
    vi.spyOn(mediaApi, 'upload').mockReturnValue(pending.promise);
    const remove = vi.spyOn(mediaApi, 'remove');
    const publish = vi.spyOn(platformApi, 'publishPost').mockResolvedValue({
      ...post,
      id: 'pending-image-post',
      author: member,
      body: '我的图片帖',
      images: [uploadedImage.url],
      status: 'pending',
    });
    render(
      <MemoryRouter>
        <AuthContext.Provider value={signedIn()}>
          <ServerWorldPage />
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    await screen.findByText(post.body);
    fireEvent.click(screen.getByRole('button', { name: '发布世界帖子' }));
    fireEvent.change(screen.getByRole('textbox', { name: '世界帖子内容' }), {
      target: { value: '我的图片帖' },
    });
    selectImage();
    expect(screen.getByAltText('选中的图片 1：日常.png')).toHaveAttribute(
      'src',
      'blob:local-preview',
    );
    expect(screen.getByRole('button', { name: '发布' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('textbox', { name: '世界帖子内容' }).closest('form')!);
    expect(publish).not.toHaveBeenCalled();
    await act(async () => pending.resolve(uploadedImage));
    expect(screen.getByRole('button', { name: '发布' })).toBeEnabled();
    expect(publish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    await screen.findByText('已提交审核');
    expect(screen.getByRole('link', { name: '查看帖子' })).toHaveAttribute(
      'href',
      '/world/p/pending-image-post',
    );
    expect(screen.queryByText('帖子已发布')).not.toBeInTheDocument();
    expect(screen.queryByText('我的图片帖')).not.toBeInTheDocument();
    expect(publish).toHaveBeenCalledWith({
      body: '我的图片帖',
      topic: '城市生活',
      images: [uploadedImage.url],
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-preview');
    expect(remove).not.toHaveBeenCalled();
  });

  it('shows upload permission failures, retains the local preview and retries the same client ID on demand', async () => {
    const upload = vi
      .spyOn(mediaApi, 'upload')
      .mockRejectedValueOnce(new ApiError('没有上传权限', 'forbidden', 403))
      .mockResolvedValue(uploadedImage);
    const publish = vi.spyOn(platformApi, 'publishPost');
    render(composer());
    fireEvent.change(screen.getByRole('textbox', { name: '世界帖子内容' }), {
      target: { value: '保留图片草稿' },
    });
    selectImage();
    await screen.findByText('没有上传权限');
    expect(screen.getByRole('button', { name: '发布' })).toBeDisabled();
    expect(screen.getByAltText('选中的图片 1：日常.png')).toBeInTheDocument();
    const clientId = upload.mock.calls[0][1];
    expect(upload).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '重试上传图片 1' }));
    await screen.findByText('已上传');
    expect(upload.mock.calls[1][1]).toBe(clientId);
    expect(screen.getByRole('button', { name: '发布' })).toBeEnabled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('retains an uploaded preview and a retry action when deletion fails', async () => {
    vi.spyOn(mediaApi, 'upload').mockResolvedValue(uploadedImage);
    vi.spyOn(mediaApi, 'remove')
      .mockRejectedValueOnce(new ApiError('暂时无法删除', 'unavailable', 503))
      .mockResolvedValue({ ok: true });
    render(composer());
    selectImage();
    await screen.findByText('已上传');
    fireEvent.click(screen.getByRole('button', { name: '移除图片 1' }));
    await screen.findByText('暂时无法删除');
    expect(screen.getByAltText('选中的图片 1：日常.png')).toBeInTheDocument();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重试移除图片 1' }));
    await waitFor(() =>
      expect(screen.queryByAltText('选中的图片 1：日常.png')).not.toBeInTheDocument(),
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it('does not publish an old account result into the new account composer', async () => {
    const pending = deferred<PlatformPost>();
    const published = vi.fn();
    vi.spyOn(platformApi, 'publishPost').mockReturnValue(pending.promise);
    const view = render(composer(published));
    fireEvent.change(screen.getByRole('textbox', { name: '世界帖子内容' }), {
      target: { value: '旧账号待发布' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    view.rerender(composer(published, otherMember));
    fireEvent.change(screen.getByRole('textbox', { name: '世界帖子内容' }), {
      target: { value: '新账号草稿' },
    });
    await act(async () => pending.resolve({ ...post, author: member, body: '旧账号待发布' }));
    expect(published).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: '世界帖子内容' })).toHaveValue('新账号草稿');
    expect(screen.getByRole('button', { name: '发布' })).toBeEnabled();
  });

  it('keeps optional external image links and text-only publishing compatible', async () => {
    const publish = vi
      .spyOn(platformApi, 'publishPost')
      .mockResolvedValue({ ...post, author: member });
    const onPublished = vi.fn();
    render(composer(onPublished));
    fireEvent.change(screen.getByRole('textbox', { name: '世界帖子内容' }), {
      target: { value: '兼容图片链接' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加图片链接' }));
    fireEvent.change(screen.getByRole('textbox', { name: '帖子图片链接' }), {
      target: { value: 'https://images.example.test/photo.png' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    await waitFor(() => expect(onPublished).toHaveBeenCalledOnce());
    expect(publish).toHaveBeenCalledWith({
      body: '兼容图片链接',
      topic: '城市生活',
      images: ['https://images.example.test/photo.png'],
    });
  });

  it.each(['pending', 'hidden'] as const)(
    'hides public interactions for %s posts while retaining author deletion',
    (status) => {
      render(
        <MemoryRouter>
          <AuthContext.Provider value={signedIn()}>
            <WorldPost
              post={{
                ...post,
                author: member,
                status,
                images: Array.from({ length: 9 }, () => uploadedImage.url),
              }}
              onReplace={vi.fn()}
              onDeleted={vi.fn()}
            />
          </AuthContext.Provider>
        </MemoryRouter>,
      );
      expect(screen.queryByRole('button', { name: '点赞' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '评论' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '举报帖子' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '删除帖子' })).toBeInTheDocument();
      expect(screen.getAllByRole('img', { name: /^帖子图片/ })).toHaveLength(9);
      expect(screen.getByRole('img', { name: '帖子图片 1' })).toHaveAttribute(
        'src',
        uploadedImage.url,
      );
    },
  );
});
