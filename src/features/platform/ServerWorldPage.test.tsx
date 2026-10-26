import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { platformApi } from '@/shared/api/platformApi';
import { ApiError } from '@/shared/api/client';
import { AuthContext } from './auth-context';
import ServerWorldPage from './ServerWorldPage';
import { member, post, signedIn } from './platform-test-fixtures';

beforeEach(() => {
  vi.spyOn(platformApi, 'posts').mockResolvedValue({ items: [post], total: 1 });
  vi.spyOn(platformApi, 'likePost').mockResolvedValue({ ...post, liked: true, likeCount: 4 });
  vi.spyOn(platformApi, 'comments').mockResolvedValue({ items: [], total: 0 });
});
afterEach(() => vi.restoreAllMocks());
const view = (authenticated = true) =>
  render(
    <MemoryRouter>
      <AuthContext.Provider
        value={authenticated ? signedIn() : { ...signedIn(), user: null, status: 'guest' }}
      >
        <ServerWorldPage />
      </AuthContext.Provider>
    </MemoryRouter>,
  );

describe('server-backed world interactions', () => {
  it('lets guests browse server posts but sends write actions to internal login', async () => {
    view(false);
    await screen.findByText(post.body);
    expect(screen.getByRole('link', { name: '登录后点赞' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fworld',
    );
    expect(screen.queryByRole('button', { name: '发布世界帖子' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /本机内容/ })).toHaveAttribute('href', '/world/demo');
    expect(platformApi.likePost).not.toHaveBeenCalled();
  });

  it('uses the server returned target like state and preserves failures', async () => {
    view();
    await screen.findByText(post.body);
    fireEvent.click(screen.getByRole('button', { name: '点赞' }));
    await screen.findByRole('button', { name: '取消点赞', pressed: true });
    expect(platformApi.likePost).toHaveBeenCalledWith(post.id, true);
    vi.mocked(platformApi.likePost).mockRejectedValueOnce(
      new ApiError('登录已失效', 'unauthorized', 401),
    );
    fireEvent.click(screen.getByRole('button', { name: '取消点赞' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: '取消点赞', pressed: true })).toHaveTextContent('4');
  });

  it('sends topic filtering to the service and does not replace offline results with demo posts', async () => {
    view();
    await screen.findByText(post.body);
    fireEvent.click(screen.getByRole('button', { name: 'Web3' }));
    await waitFor(() =>
      expect(platformApi.posts).toHaveBeenLastCalledWith(
        expect.objectContaining({ topic: 'Web3', offset: 0 }),
        expect.any(AbortSignal),
      ),
    );
    vi.mocked(platformApi.posts).mockRejectedValueOnce(
      new ApiError('服务离线', 'NETWORK_ERROR', 0),
    );
    fireEvent.click(screen.getByRole('button', { name: '刷新世界' }));
    await screen.findByText('服务离线');
    expect(screen.queryByText(post.body)).not.toBeInTheDocument();
    expect(screen.queryByText('世界等待第一个声音')).not.toBeInTheDocument();
  });

  it('submits a real comment and a reasoned report without local fake success', async () => {
    const comment = vi.spyOn(platformApi, 'comment').mockResolvedValue({
      id: 'comment-one',
      postId: post.id,
      author: member,
      body: '让交流继续',
      createdAt: '2026-10-27T09:00:00Z',
    });
    const report = vi.spyOn(platformApi, 'reportPost').mockResolvedValue({ id: 'report-one' });
    view();
    await screen.findByText(post.body);
    fireEvent.click(screen.getByRole('button', { name: '评论' }));
    await screen.findByText('还没有评论，留下第一句吧。');
    fireEvent.change(screen.getByRole('textbox', { name: '评论内容' }), {
      target: { value: '让交流继续' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送评论' }));
    await screen.findByText('让交流继续');
    expect(comment).toHaveBeenCalledWith(post.id, '让交流继续');
    fireEvent.click(screen.getByRole('button', { name: '举报帖子' }));
    fireEvent.change(screen.getByRole('textbox', { name: '举报原因' }), {
      target: { value: '图片存在冒用问题，请核查' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交举报' }));
    await screen
      .findByRole('button', { name: '举报帖子' })
      .then((button) => expect(button).toBeDisabled());
    expect(report).toHaveBeenCalledWith(post.id, '图片存在冒用问题，请核查');
  });

  it('requires deletion confirmation and hides author-only tools from other members', async () => {
    const remove = vi.spyOn(platformApi, 'deletePost').mockResolvedValue({ ok: true });
    vi.mocked(platformApi.posts).mockResolvedValue({
      items: [{ ...post, author: member }],
      total: 1,
    });
    view();
    await screen.findByText(post.body);
    expect(screen.queryByRole('button', { name: '举报帖子' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '删除帖子' }));
    expect(remove).not.toHaveBeenCalled();
    vi.mocked(platformApi.posts).mockResolvedValueOnce({ items: [], total: 0 });
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await screen.findByText('世界等待第一个声音');
    expect(remove).toHaveBeenCalledWith(post.id);
  });

  it('publishes using the service and retains the draft on server rejection', async () => {
    const publish = vi
      .spyOn(platformApi, 'publishPost')
      .mockRejectedValueOnce(new ApiError('发布失败，请重试', 'unavailable', 503));
    view();
    await screen.findByText(post.body);
    fireEvent.click(screen.getByRole('button', { name: '发布世界帖子' }));
    const form = screen.getByRole('textbox', { name: '世界帖子内容' }).closest('form')!;
    fireEvent.change(within(form).getByRole('textbox', { name: '世界帖子内容' }), {
      target: { value: '我的新想法' },
    });
    fireEvent.click(within(form).getByRole('button', { name: '发布' }));
    await screen.findByText('发布失败，请重试');
    expect(screen.getByRole('textbox', { name: '世界帖子内容' })).toHaveValue('我的新想法');
    expect(publish).toHaveBeenCalledWith({ body: '我的新想法', topic: '城市生活', images: [] });
  });
});
