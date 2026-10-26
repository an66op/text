import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/features/platform/auth-context';
import { member, otherMember, post, signedIn } from '@/features/platform/platform-test-fixtures';
import ServerPostPage from './ServerPostPage';

const path = `/api/v1/media/images/media_${'a'.repeat(32)}`;
const pending = { ...post, author: member, status: 'pending', images: [path] };
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(status >= 400 ? { error: data } : { data }), { status });
const scene = (who = member) => (
  <MemoryRouter initialEntries={['/world/p/pending-post']}>
    <AuthContext.Provider value={signedIn(who)}>
      <Routes>
        <Route path="/world/p/:postId" element={<ServerPostPage />} />
      </Routes>
    </AuthContext.Provider>
  </MemoryRouter>
);
afterEach(() => vi.unstubAllGlobals());

describe('uploaded image post review status', () => {
  it('lets the author inspect the pending photo and refresh the authoritative review result', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(pending))
      .mockResolvedValueOnce(response({ ...pending, status: 'published' }));
    vi.stubGlobal('fetch', fetchMock);
    render(scene());
    await screen.findByText('等待审核');
    expect(screen.getByText(/审核通过后会出现在世界/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '帖子图片 1' })).toHaveAttribute('src', path);
    fireEvent.click(screen.getByRole('button', { name: '刷新动态状态' }));
    await screen.findByRole('button', { name: '点赞' });
    expect(screen.queryByText('等待审核')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('discards an old private review response when the viewer changes', async () => {
    let finish!: (value: Response) => void;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(response({ code: 'not_found', message: '动态暂不可见' }, 404));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(scene());
    view.rerender(scene(otherMember));
    await screen.findByText('动态暂不可见');
    await act(async () => finish(response(pending)));
    expect(screen.queryByText(pending.body)).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: '帖子图片 1' })).not.toBeInTheDocument();
    expect(screen.queryByText('等待审核')).not.toBeInTheDocument();
  });
});
