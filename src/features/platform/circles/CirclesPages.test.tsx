import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { AuthContext, type AuthState } from '../auth-context';
import { member, otherMember, signedIn } from '../platform-test-fixtures';
import DirectoryPage from './DirectoryPage';
import CreatePage from './CreatePage';
import HomePage from './HomePage';
import ChannelPage from './ChannelPage';
import PostPage from './PostPage';
import ComposePage from './ComposePage';
import JoinPage from './JoinPage';
import InvitePage from './InvitePage';
import MembersPage from './MembersPage';
import ManagePage from './ManagePage';
import { circlesApi } from './api';
import {
  circle,
  channel,
  circlePost,
  deferred,
  homePath,
  invite,
  postPath,
  request,
} from './test-fixtures';
import type { Circle, Post } from './types';
import { mediaApi } from '../media/media-api';
import { imageFile, uploadedImage } from '../media/media-test-fixtures';

const secondPost: Post = {
  ...circlePost,
  id: `cpost_${'d'.repeat(32)}`,
  title: '第二篇作品',
  body: '第二篇独立正文',
};
function Navigation() {
  const navigate = useNavigate(),
    location = useLocation();
  return (
    <>
      <output aria-label="当前页面">{location.pathname + location.search + location.hash}</output>
      <button onClick={() => navigate(`${homePath}/posts/${secondPost.id}`)}>下一篇</button>
    </>
  );
}
function page(path: string, auth: AuthState = signedIn()) {
  return (
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <Navigation />
        <Routes>
          <Route path="/circles" element={<DirectoryPage />} />
          <Route path="/circles/new" element={<CreatePage />} />
          <Route path="/circles/s/:circleId" element={<HomePage />} />
          <Route path="/circles/s/:circleId/channels/:channelId" element={<ChannelPage />} />
          <Route path="/circles/s/:circleId/posts/:postId" element={<PostPage />} />
          <Route path="/circles/s/:circleId/compose" element={<ComposePage />} />
          <Route path="/circles/s/:circleId/join" element={<JoinPage />} />
          <Route path="/circles/s/:circleId/invite" element={<InvitePage />} />
          <Route path="/circles/s/:circleId/members" element={<MembersPage />} />
          <Route path="/circles/s/:circleId/manage" element={<ManagePage />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}
beforeEach(() => {
  vi.spyOn(circlesApi, 'circle').mockResolvedValue(circle);
  vi.spyOn(circlesApi, 'directory').mockResolvedValue({ items: [circle], total: 1 });
  vi.spyOn(circlesApi, 'channels').mockResolvedValue({ items: [channel], total: 1 });
  vi.spyOn(circlesApi, 'posts').mockResolvedValue({ items: [circlePost], total: 1 });
  vi.spyOn(circlesApi, 'post').mockImplementation(async (_id, id) =>
    id === secondPost.id ? secondPost : circlePost,
  );
  vi.spyOn(circlesApi, 'comments').mockResolvedValue({ items: [], total: 0 });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('real circle boundaries and navigation', () => {
  it('allows guests to discover introductions but never fetches private content before membership', async () => {
    const publicCircle: Circle = { ...circle, role: 'guest', membership: 'none' };
    vi.mocked(circlesApi.circle).mockResolvedValue(publicCircle);
    const view = render(page(homePath, { ...signedIn(), user: null, status: 'guest' }));
    await screen.findByRole('heading', { name: circle.name });
    expect(circlesApi.channels).not.toHaveBeenCalled();
    expect(circlesApi.posts).not.toHaveBeenCalled();
    expect(screen.queryByText(circlePost.body)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '加入 ↗' })).toHaveAttribute(
      'href',
      `${homePath}/join`,
    );
    view.unmount();
    render(page('/circles', { ...signedIn(), user: null, status: 'guest' }));
    await screen.findByRole('heading', { name: circle.name });
    expect(screen.getByRole('link', { name: '返回发现' })).toHaveAttribute('href', '/discover');
    expect(screen.getByRole('link', { name: '本机圈子演示 ↗' })).toHaveAttribute(
      'href',
      '/circles/demo',
    );
  });

  it('shows unavailable authentication explicitly without requesting or silently showing demo data', () => {
    render(
      page('/circles', { ...signedIn(), user: null, status: 'unavailable', error: '账号连接中断' }),
    );
    expect(screen.getByText('账号连接中断')).toBeInTheDocument();
    expect(circlesApi.directory).not.toHaveBeenCalled();
    expect(screen.queryByText(circle.name)).not.toBeInTheDocument();
  });

  it('remounts a same-circle post so a late like cannot replace the next post or its draft', async () => {
    const late = deferred<Post>();
    const like = vi.spyOn(circlesApi, 'like').mockReturnValue(late.promise);
    render(page(postPath));
    await screen.findByRole('button', { name: '点赞' });
    fireEvent.change(screen.getByRole('textbox', { name: '圈帖评论内容' }), {
      target: { value: '上一页草稿' },
    });
    fireEvent.click(screen.getByRole('button', { name: '点赞' }));
    fireEvent.click(screen.getByRole('button', { name: '下一篇' }));
    await screen.findByRole('heading', { name: secondPost.title });
    expect(like.mock.calls[0][3]?.aborted).toBe(true);
    expect(screen.getByRole('textbox', { name: '圈帖评论内容' })).toHaveValue('');
    await act(async () => late.resolve({ ...circlePost, liked: true, likeCount: 99 }));
    expect(screen.getByRole('heading', { name: secondPost.title })).toBeInTheDocument();
    expect(screen.queryByText(circlePost.body)).not.toBeInTheDocument();
    expect(screen.queryByText('99 人喜欢')).not.toBeInTheDocument();
  });

  it('locks private content after a permission denial and ignores an earlier mutation success', async () => {
    const late = deferred<Post>();
    vi.spyOn(circlesApi, 'like').mockReturnValue(late.promise);
    render(page(postPath));
    fireEvent.click(await screen.findByRole('button', { name: '点赞' }));
    vi.mocked(circlesApi.circle).mockRejectedValue(
      new ApiError('成员权限已失效', 'forbidden', 403),
    );
    act(() => window.dispatchEvent(new Event('focus')));
    await screen.findByText('成员权限已失效');
    expect(screen.queryByText(circlePost.body)).not.toBeInTheDocument();
    await act(async () => late.resolve({ ...circlePost, liked: true }));
    expect(screen.queryByText(circlePost.body)).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '圈帖评论内容' })).not.toBeInTheDocument();
  });

  it('isolates a late post response when the account changes', async () => {
    const old = deferred<Post>();
    vi.mocked(circlesApi.post).mockReturnValueOnce(old.promise).mockResolvedValue(secondPost);
    const view = render(page(postPath));
    await waitFor(() => expect(circlesApi.post).toHaveBeenCalledOnce());
    const oldSignal = vi.mocked(circlesApi.post).mock.calls[0][2]!;
    view.rerender(page(postPath, signedIn(otherMember)));
    await screen.findByRole('heading', { name: secondPost.title });
    expect(oldSignal.aborted).toBe(true);
    await act(async () => old.resolve(circlePost));
    expect(screen.queryByText(circlePost.body)).not.toBeInTheDocument();
  });

  it('allows announcement members to like and comment but not create main posts', async () => {
    vi.mocked(circlesApi.channels).mockResolvedValue({
      items: [{ ...channel, kind: 'announcement' }],
      total: 1,
    });
    const like = vi.spyOn(circlesApi, 'like').mockResolvedValue({ ...circlePost, liked: true });
    const comment = vi.spyOn(circlesApi, 'comment').mockResolvedValue({
      id: 'comment-one',
      postId: circlePost.id,
      author: member,
      body: '收到',
      createdAt: circle.createdAt,
    });
    const view = render(page(`${homePath}/channels/${channel.id}`));
    await screen.findByText('公告主帖由圈方发布，成员可以点赞和评论。');
    expect(screen.queryByRole('link', { name: /发布/ })).not.toBeInTheDocument();
    view.unmount();
    render(page(postPath));
    fireEvent.click(await screen.findByRole('button', { name: '点赞' }));
    await waitFor(() => expect(like).toHaveBeenCalled());
    fireEvent.change(screen.getByRole('textbox', { name: '圈帖评论内容' }), {
      target: { value: '收到' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() =>
      expect(comment).toHaveBeenCalledWith(
        circle.id,
        circlePost.id,
        '收到',
        expect.any(AbortSignal),
      ),
    );
  });

  it('keeps archived channel history readable while disabling interactions and creation', async () => {
    vi.mocked(circlesApi.channels).mockResolvedValue({
      items: [{ ...channel, archived: true }],
      total: 1,
    });
    render(page(homePath));
    await screen.findByRole('link', { name: '作品交流（归档）' });
    expect(await screen.findByRole('button', { name: `点赞：${circlePost.title}` })).toBeDisabled();
    expect(screen.queryByRole('link', { name: /分享作品/ })).not.toBeInTheDocument();
  });

  it('cannot restore a published post from a pre-moderation GET after the server confirms it hidden', async () => {
    const stale = deferred<Post>(),
      fresh = deferred<Post>();
    vi.mocked(circlesApi.circle).mockResolvedValue({ ...circle, role: 'admin' });
    vi.mocked(circlesApi.post)
      .mockResolvedValueOnce(circlePost)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);
    vi.spyOn(circlesApi, 'updatePost').mockResolvedValue({ ...circlePost, status: 'hidden' });
    render(page(postPath));
    await screen.findByRole('button', { name: '隐藏帖子' });
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(circlesApi.post).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '隐藏帖子' }));
    await screen.findByText('此帖已隐藏，仅作者与圈管理可见。');
    expect(screen.queryByRole('button', { name: '点赞' })).not.toBeInTheDocument();
    await act(async () => stale.resolve(circlePost));
    expect(circlesApi.post).toHaveBeenCalledTimes(3);
    expect(screen.getByText('此帖已隐藏，仅作者与圈管理可见。')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '圈帖评论内容' })).not.toBeInTheDocument();
    await act(async () => fresh.resolve({ ...circlePost, status: 'hidden' }));
  });

  it('can open the 31st server channel without treating it as missing', async () => {
    const channels = Array.from({ length: 40 }, (_, index) => ({
      ...channel,
      id: `channel-${index + 1}`,
      name: `讨论 ${index + 1}`,
    }));
    vi.mocked(circlesApi.channels).mockResolvedValue({ items: channels, total: 40 });
    render(page(`${homePath}/channels/channel-31`));
    await screen.findByRole('heading', { name: '讨论 31' });
    expect(circlesApi.posts).toHaveBeenCalledWith(
      circle.id,
      expect.objectContaining({ channelId: 'channel-31' }),
      expect.any(AbortSignal),
    );
  });
});

describe('server-confirmed circle entry and creation', () => {
  it('retains create input and client ID after an uncertain failure until a server success', async () => {
    const create = vi
      .spyOn(circlesApi, 'create')
      .mockRejectedValueOnce(new ApiError('请求超时，请重试确认', 'timeout', 0))
      .mockResolvedValue(circle);
    render(page('/circles/new'));
    fireEvent.change(screen.getByRole('textbox', { name: '圈子名称' }), {
      target: { value: '新创作圈' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建圈子' }));
    await screen.findByText('请求超时，请重试确认');
    const first = create.mock.calls[0][0];
    expect(screen.getByRole('textbox', { name: '圈子名称' })).toHaveValue('新创作圈');
    expect(screen.getByLabelText('当前页面')).toHaveTextContent('/circles/new');
    fireEvent.click(screen.getByRole('button', { name: '创建圈子' }));
    await screen.findByRole('heading', { name: circle.name });
    expect(create.mock.calls[1][0].clientId).toBe(first.clientId);
  });

  it('does not auto redeem a fragment invitation and shows a real pending result', async () => {
    vi.mocked(circlesApi.circle).mockRejectedValue(new ApiError('找不到圈子', 'not_found', 404));
    const pendingCircle: Circle = {
      ...circle,
      visibility: 'private',
      joinPolicy: 'approval',
      membership: 'none',
      role: 'guest',
    };
    const preview = vi.spyOn(circlesApi, 'previewInvite').mockResolvedValue(pendingCircle);
    const join = vi.spyOn(circlesApi, 'join').mockResolvedValue({
      status: 'pending',
      circle: { ...pendingCircle, membership: 'pending' },
      request,
    });
    render(page(`${homePath}/join#invite=private-token`));
    expect(preview).not.toHaveBeenCalled();
    expect(join).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '预览邀请' }));
    await screen.findByRole('heading', { name: circle.name });
    expect(preview).toHaveBeenCalledWith('private-token', expect.any(AbortSignal));
    fireEvent.click(screen.getByRole('button', { name: '提交入圈申请' }));
    await screen.findByText('申请已提交，等待圈方审核');
    expect(join).toHaveBeenCalledWith(
      circle.id,
      { note: '', inviteToken: 'private-token' },
      expect.any(AbortSignal),
    );
    expect(screen.getByLabelText('当前页面')).toHaveTextContent(
      `${homePath}/join#invite=private-token`,
    );
  });

  it('shows existing private pending applications without needing the original invitation again', async () => {
    vi.mocked(circlesApi.circle).mockResolvedValue({
      ...circle,
      membership: 'pending',
      role: 'guest',
      visibility: 'private',
    });
    render(page(`${homePath}/join`));
    await screen.findByText('申请已提交，等待圈方审核');
    expect(screen.getByRole('link', { name: '查看我的申请' })).toHaveAttribute(
      'href',
      '/circles?tab=requests',
    );
    expect(screen.queryByRole('button', { name: '预览邀请' })).not.toBeInTheDocument();
  });

  it('does not put a private invite token into the login returnTo or send preview requests for guests', () => {
    const preview = vi.spyOn(circlesApi, 'previewInvite');
    render(
      page(`${homePath}/join#invite=secret-token`, { ...signedIn(), user: null, status: 'guest' }),
    );
    const login = screen.getByRole('link', { name: '登录' });
    expect(login.getAttribute('href')).not.toContain('secret-token');
    expect(login.getAttribute('href')).not.toContain('%23');
    expect(screen.getByText(/登录后请重新打开原邀请链接/)).toBeInTheDocument();
    expect(preview).not.toHaveBeenCalled();
    expect(circlesApi.circle).not.toHaveBeenCalled();
  });

  it('never claims entry after an expired invitation is rejected', async () => {
    vi.mocked(circlesApi.circle).mockRejectedValue(new ApiError('找不到圈子', 'not_found', 404));
    vi.spyOn(circlesApi, 'previewInvite').mockRejectedValue(
      new ApiError('邀请无效或已失效', 'not_found', 404),
    );
    const join = vi.spyOn(circlesApi, 'join');
    render(page(`${homePath}/join#invite=expired`));
    fireEvent.click(screen.getByRole('button', { name: '预览邀请' }));
    await screen.findByText('邀请无效或已失效');
    expect(screen.getByRole('button', { name: '加入圈子' })).toBeDisabled();
    expect(join).not.toHaveBeenCalled();
  });

  it('publishes uploaded images only on explicit submit and shows the server pending receipt with its detail link', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:circle-preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const upload = vi
      .spyOn(mediaApi, 'upload')
      .mockResolvedValue({ ...uploadedImage, scope: 'circle', circleId: circle.id });
    const create = vi
      .spyOn(circlesApi, 'createPost')
      .mockResolvedValue({ ...circlePost, images: [uploadedImage.url], status: 'pending' });
    render(page(`${homePath}/compose`));
    await screen.findByRole('textbox', { name: '帖子标题' });
    fireEvent.change(screen.getByRole('textbox', { name: '帖子标题' }), {
      target: { value: '圈内作品' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '帖子正文' }), {
      target: { value: '只在这里分享' },
    });
    fireEvent.change(screen.getByLabelText('选择圈帖图片'), { target: { files: [imageFile()] } });
    await waitFor(() => expect(screen.getByRole('button', { name: '提交帖子' })).toBeEnabled());
    expect(upload).toHaveBeenCalledWith(
      expect.any(File),
      expect.any(String),
      expect.any(AbortSignal),
      circle.id,
    );
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '提交帖子' }));
    await screen.findByRole('heading', { name: '已提交圈方审核' });
    expect(create).toHaveBeenCalledWith(
      circle.id,
      expect.objectContaining({ images: [uploadedImage.url], channelId: channel.id }),
      expect.any(AbortSignal),
    );
    expect(screen.getByRole('link', { name: '查看帖子' })).toHaveAttribute('href', postPath);
    expect(screen.queryByText('帖子已发布')).not.toBeInTheDocument();
  });

  it('clears circle content and cancels queued images immediately when an upload is denied', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:circle-preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const upload = vi
      .spyOn(mediaApi, 'upload')
      .mockRejectedValue(new ApiError('圈内成员权限失效', 'not_found', 404));
    render(page(`${homePath}/compose`));
    await screen.findByRole('textbox', { name: '帖子标题' });
    fireEvent.change(screen.getByLabelText('选择圈帖图片'), {
      target: { files: [imageFile('one.png'), imageFile('two.png')] },
    });
    await screen.findByText('圈内成员权限失效');
    expect(screen.queryByRole('combobox', { name: '发布频道' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '帖子正文' })).not.toBeInTheDocument();
    expect(upload).toHaveBeenCalledOnce();
    expect(upload.mock.calls[0][2]?.aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});

describe('server role and moderation controls', () => {
  it('opens the requests tab from an authorized notification deep link and cancels it when the URL tab changes', async () => {
    vi.mocked(circlesApi.circle).mockResolvedValue({ ...circle, role: 'admin' });
    const pending = deferred<{ items: (typeof request)[]; total: number }>();
    const requests = vi.spyOn(circlesApi, 'requests').mockReturnValue(pending.promise);
    const members = vi.spyOn(circlesApi, 'members').mockResolvedValue({ items: [], total: 0 });
    render(page(`${homePath}/members?tab=requests`));
    expect(await screen.findByRole('tab', { name: '审批' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await waitFor(() =>
      expect(requests).toHaveBeenCalledWith(
        circle.id,
        { status: 'pending', limit: 20, offset: 0 },
        expect.any(AbortSignal),
      ),
    );
    expect(members).not.toHaveBeenCalled();
    const signal = requests.mock.calls[0][2]!;
    fireEvent.click(screen.getByRole('tab', { name: '成员' }));
    await waitFor(() => expect(members).toHaveBeenCalled());
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve({ items: [request], total: 1 }));
    expect(screen.queryByText(request.note)).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '成员' })).toHaveAttribute('aria-selected', 'true');
  });

  it('does not request approval or banned member lists from URL tabs without current circle permissions', async () => {
    const requests = vi.spyOn(circlesApi, 'requests');
    const members = vi.spyOn(circlesApi, 'members').mockResolvedValue({ items: [], total: 0 });
    render(page(`${homePath}/members?tab=requests`));
    await screen.findByText('没有符合条件的成员。');
    expect(requests).not.toHaveBeenCalled();
    expect(members).toHaveBeenCalledWith(
      circle.id,
      { status: 'active', q: '', limit: 20, offset: 0 },
      expect.any(AbortSignal),
    );
    expect(screen.queryByRole('tab', { name: '审批' })).not.toBeInTheDocument();
  });

  it('closes a stale destructive confirmation when the target becomes a protected circle owner', async () => {
    vi.mocked(circlesApi.circle).mockResolvedValue({ ...circle, role: 'owner', owner: member });
    const list = vi.spyOn(circlesApi, 'members').mockResolvedValue({
      items: [{ user: otherMember, role: 'member', status: 'active', joinedAt: circle.createdAt }],
      total: 1,
    });
    const remove = vi.spyOn(circlesApi, 'removeMember');
    render(page(`${homePath}/members`));
    fireEvent.click(await screen.findByRole('button', { name: '移除成员' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    list.mockResolvedValue({
      items: [{ user: otherMember, role: 'owner', status: 'active', joinedAt: circle.createdAt }],
      total: 1,
    });
    act(() => window.dispatchEvent(new Event('focus')));
    await screen.findByText('成员状态已变化，请重新查看后再操作。');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
  });

  it('bans a previously removed member with an explicit ban confirmation and never treats unban as rejoining', async () => {
    vi.mocked(circlesApi.circle).mockResolvedValue({ ...circle, role: 'owner', owner: member });
    vi.spyOn(circlesApi, 'members').mockImplementation(async (_id, query) => ({
      items: [
        {
          user: otherMember,
          role: 'member',
          status: query.status === 'banned' ? 'banned' : 'removed',
          joinedAt: circle.createdAt,
        },
      ],
      total: 1,
    }));
    const remove = vi.spyOn(circlesApi, 'removeMember').mockResolvedValue({ ok: true });
    const unban = vi.spyOn(circlesApi, 'unban').mockResolvedValue({ ok: true });
    render(page(`${homePath}/members`));
    fireEvent.click(await screen.findByRole('tab', { name: '移除' }));
    fireEvent.click(await screen.findByRole('button', { name: '封禁成员' }));
    expect(screen.getByRole('checkbox', { name: '同时封禁，禁止重新加入' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '确认封禁' }));
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith(circle.id, otherMember.id, true, expect.any(AbortSignal)),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: '封禁' }));
    fireEvent.click(await screen.findByRole('button', { name: '解除封禁' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('不会自动加入');
    fireEvent.click(screen.getByRole('button', { name: '确认解禁' }));
    await waitFor(() =>
      expect(unban).toHaveBeenCalledWith(circle.id, otherMember.id, expect.any(AbortSignal)),
    );
    await screen.findByText('已解除封禁，成员需重新申请加入');
  });

  it('transfers ownership only after confirmation and refreshes the current server role', async () => {
    vi.mocked(circlesApi.circle).mockResolvedValue({ ...circle, role: 'owner', owner: member });
    vi.spyOn(circlesApi, 'members').mockResolvedValue({
      items: [{ user: otherMember, role: 'member', status: 'active', joinedAt: circle.createdAt }],
      total: 1,
    });
    const pending = deferred<Circle>();
    const transfer = vi.spyOn(circlesApi, 'transfer').mockReturnValue(pending.promise);
    render(page(`${homePath}/members`));
    fireEvent.click(await screen.findByRole('button', { name: '转交圈主' }));
    expect(transfer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认转交圈主' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const changed = { ...circle, role: 'admin' as const, owner: otherMember };
    vi.mocked(circlesApi.circle).mockResolvedValue(changed);
    await act(async () => pending.resolve(changed));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '转交圈主' })).not.toBeInTheDocument(),
    );
    expect(transfer).toHaveBeenCalledWith(circle.id, otherMember.id, expect.any(AbortSignal));
    expect(screen.getByRole('button', { name: '退出圈子' })).toBeInTheDocument();
  });

  it('saves only editable circle fields instead of echoing server identity or authorization fields', async () => {
    vi.mocked(circlesApi.circle).mockResolvedValue({ ...circle, role: 'admin' });
    const update = vi
      .spyOn(circlesApi, 'update')
      .mockResolvedValue({ ...circle, description: '新的介绍' });
    render(page(`${homePath}/manage`));
    fireEvent.change(await screen.findByRole('textbox', { name: '圈子简介' }), {
      target: { value: '新的介绍' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存圈子资料' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1]).toEqual({
      name: circle.name,
      description: '新的介绍',
      category: circle.category,
      cover: '',
      icon: circle.icon,
      visibility: circle.visibility,
      joinPolicy: circle.joinPolicy,
    });
  });

  it('confirms member removal with a concrete target and keeps the member after a failed server response', async () => {
    vi.mocked(circlesApi.circle).mockResolvedValue({ ...circle, role: 'owner', owner: member });
    vi.spyOn(circlesApi, 'members').mockResolvedValue({
      items: [{ user: otherMember, role: 'member', status: 'active', joinedAt: circle.createdAt }],
      total: 1,
    });
    const remove = vi
      .spyOn(circlesApi, 'removeMember')
      .mockRejectedValue(new ApiError('服务器暂不可用', 'unavailable', 503));
    render(page(`${homePath}/members`));
    fireEvent.click(await screen.findByRole('button', { name: '移除成员' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(otherMember.name);
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '确认移除' }));
    await within(dialog).findByText('服务器暂不可用');
    expect(screen.getByText(otherMember.name)).toBeInTheDocument();
    expect(remove).toHaveBeenCalledWith(circle.id, otherMember.id, false, expect.any(AbortSignal));
  });

  it('does not expose owner actions to a member or rely on platform staff privileges', async () => {
    render(page(`${homePath}/manage`, signedIn({ ...member, role: 'admin' })));
    await screen.findByText('只有当前圈主或圈管理员可以管理。');
    expect(screen.queryByRole('button', { name: '归档圈子' })).not.toBeInTheDocument();
  });

  it('loads pending review items and waits for server approval before changing their state', async () => {
    vi.mocked(circlesApi.circle).mockResolvedValue({ ...circle, role: 'admin' });
    const pending = { ...circlePost, status: 'pending' as const };
    vi.mocked(circlesApi.posts).mockResolvedValue({ items: [pending], total: 1 });
    const result = deferred<Post>();
    const update = vi.spyOn(circlesApi, 'updatePost').mockReturnValue(result.promise);
    render(page(`${homePath}/manage`));
    fireEvent.click(await screen.findByRole('tab', { name: '审核' }));
    fireEvent.click(await screen.findByRole('button', { name: '审核发布' }));
    expect(screen.queryByText('已审核发布到圈内')).not.toBeInTheDocument();
    expect(circlesApi.posts).toHaveBeenCalledWith(
      circle.id,
      expect.objectContaining({ status: 'pending' }),
      expect.any(AbortSignal),
    );
    expect(update).toHaveBeenCalledWith(
      circle.id,
      circlePost.id,
      { status: 'published' },
      expect.any(AbortSignal),
    );
    vi.mocked(circlesApi.posts).mockResolvedValue({ items: [], total: 0 });
    await act(async () => result.resolve(circlePost));
    await screen.findByText('已审核发布到圈内');
    await screen.findByText('当前没有这个状态的帖子。');
  });

  it('shares a newly created token only in a fragment and revokes it only after confirmation', async () => {
    vi.mocked(circlesApi.circle).mockResolvedValue({ ...circle, role: 'owner', owner: member });
    vi.spyOn(circlesApi, 'invites').mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(circlesApi, 'createInvite').mockResolvedValue({
      ...invite,
      token: 'only-this-receipt',
    });
    const late = deferred<{ ok: true }>();
    const revoke = vi.spyOn(circlesApi, 'revokeInvite').mockReturnValue(late.promise);
    render(page(`${homePath}/invite`));
    fireEvent.click(await screen.findByRole('button', { name: '创建邀请' }));
    const input = await screen.findByRole('textbox', { name: '圈子邀请链接' });
    expect(input).toHaveValue(`${window.location.origin}${homePath}/join#invite=only-this-receipt`);
    vi.mocked(circlesApi.invites).mockResolvedValue({ items: [invite], total: 1 });
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    fireEvent.click(await screen.findByRole('button', { name: '撤销邀请' }));
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认撤销' }));
    expect(input).toBeInTheDocument();
    vi.mocked(circlesApi.invites).mockResolvedValue({
      items: [{ ...invite, revoked: true }],
      total: 1,
    });
    await act(async () => late.resolve({ ok: true }));
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: '圈子邀请链接' })).not.toBeInTheDocument(),
    );
    await screen.findByText(/已撤销/);
  });

  it('paginates older invitations so an active invite beyond the first page can be revoked', async () => {
    vi.mocked(circlesApi.circle).mockResolvedValue({ ...circle, role: 'owner', owner: member });
    const older = { ...invite, id: `cinvite_${'d'.repeat(32)}` };
    const list = vi
      .spyOn(circlesApi, 'invites')
      .mockImplementation(async (_id, _signal, offset) => ({
        items: [offset ? older : invite],
        total: 31,
      }));
    render(page(`${homePath}/invite`));
    fireEvent.click(await screen.findByRole('button', { name: '下一页' }));
    await screen.findByText('邀请 dddddddd');
    expect(list).toHaveBeenLastCalledWith(circle.id, expect.any(AbortSignal), 20);
    expect(screen.getByRole('button', { name: '撤销邀请' })).toBeEnabled();
  });
});
