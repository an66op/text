import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '../auth-context';
import { member, signedIn } from '../platform-test-fixtures';
import { platformApi } from '@/shared/api/platformApi';
import { ApiError } from '@/shared/api/client';
import { mediaApi } from '../media/media-api';
import type { Conversation } from '@/shared/api/types';
import type { UploadedImage } from '../media/media-model';
import MessageThread from './MessageThread';
import { msg } from './message-media-fixtures';
import type { StreamEvent } from './usePlatformStream';
const conversation: Conversation = {
  id: 'chat',
  title: '真实聊天',
  kind: 'group',
  ownerId: member.id,
  members: [member.id],
  createdAt: '2026-10-27T08:00:00Z',
  mutationVersion: 0,
};
const image: UploadedImage = {
  id: 'media_' + 'a'.repeat(32),
  url: '/api/v1/media/images/media_' + 'a'.repeat(32),
  scope: 'conversation',
  conversationId: 'chat',
  width: 100,
  height: 100,
  bytes: 10,
  contentType: 'image/png',
  createdAt: '2026-10-27T08:00:00Z',
};
function scene(updateVersion = 0, event?: StreamEvent, conv = conversation) {
  return (
    <MemoryRouter>
      <AuthContext.Provider value={signedIn()}>
        <MessageThread
          conversation={conv}
          onBack={vi.fn()}
          onSent={vi.fn()}
          onRead={vi.fn()}
          updateVersion={updateVersion}
          streamStatus="live"
          streamEvent={event}
        />
      </AuthContext.Provider>
    </MemoryRouter>
  );
}
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:private-photo'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(platformApi, 'messages').mockResolvedValue({
    items: [msg()],
    total: 1,
    mutationVersion: 0,
  });
  vi.spyOn(platformApi, 'markConversationRead').mockResolvedValue({
    conversationId: 'chat',
    readSeq: 1,
    unreadCount: 0,
    lastReadMessageId: 'one',
  });
});
afterEach(() => vi.restoreAllMocks());
async function addImage(container: HTMLElement) {
  fireEvent.click(screen.getByRole('button', { name: '更多消息操作' }));
  expect(screen.getByRole('button', { name: '选择图片' })).toBeInTheDocument();
  fireEvent.change(container.querySelector('input[type=file]')!, {
    target: { files: [new File(['png'], 'photo.png', { type: 'image/png' })] },
  });
  await screen.findByText('已就绪');
}
it.each(['', '图片配文'])(
  'sends image payload with text %s from the single-line plus composer without persisting rich payload',
  async (body) => {
    vi.spyOn(mediaApi, 'uploadToConversation').mockResolvedValue(image);
    const send = vi
      .spyOn(platformApi, 'sendMessage')
      .mockImplementation(async (id, body, clientId) => ({
        ...msg('sent'),
        conversationId: id,
        body,
        clientId,
        images: [{ ...image, available: true }],
      }));
    const view = render(scene());
    await screen.findByText('private-one');
    await addImage(view.container);
    expect(screen.getByRole('textbox', { name: '服务器消息内容' }).tagName).toBe('INPUT');
    if (body)
      fireEvent.change(screen.getByRole('textbox', { name: '服务器消息内容' }), {
        target: { value: body },
      });
    fireEvent.click(screen.getByRole('button', { name: '发送服务器消息' }));
    await screen.findByRole('button', { name: '查看消息图片' });
    expect(send.mock.calls[0][1]).toBe(body);
    expect(send.mock.calls[0][3]).toEqual({ imageIds: [image.id], replyToId: undefined });
    expect(JSON.stringify(localStorage)).not.toContain(image.id);
    expect(JSON.stringify(localStorage)).not.toContain('blob:');
  },
);
it('closes the full-screen viewer and clears all images after a retraction event and ignores stale resolve content', async () => {
  const live = { ...msg(), images: [{ ...image, available: true }] };
  vi.mocked(platformApi.messages).mockResolvedValue({
    items: [live],
    total: 1,
    mutationVersion: 0,
  });
  vi.spyOn(platformApi, 'resolveMessages').mockResolvedValue({
    items: [live],
    missingIds: [],
    mutationVersion: 0,
  });
  const view = render(scene());
  fireEvent.click(await screen.findByRole('button', { name: '查看消息图片' }));
  expect(screen.getByRole('dialog', { name: '图片全屏查看' })).toBeInTheDocument();
  view.rerender(scene(1, { type: 'message.retracted', conversationId: 'chat', messageId: 'one' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: '图片全屏查看' })).not.toBeInTheDocument(),
  );
  expect(screen.getByText('消息已撤回')).toBeInTheDocument();
  expect(screen.queryByText('private-one')).not.toBeInTheDocument();
});
it('retains text and requires cancelling a retracted source instead of silently changing the reply intent', async () => {
  vi.spyOn(platformApi, 'resolveMessages').mockResolvedValue({
    items: [{ ...msg(), status: 'retracted', body: '', images: [], replyTo: null, revision: 2 }],
    missingIds: [],
    mutationVersion: 1,
  });
  const view = render(scene());
  fireEvent.click(await screen.findByRole('button', { name: '回复消息：private-one' }));
  fireEvent.change(screen.getByRole('textbox', { name: '服务器消息内容' }), {
    target: { value: '还想说的话' },
  });
  view.rerender(scene(1, { type: 'message.retracted', conversationId: 'chat', messageId: 'one' }));
  await screen.findByText('原消息已不可用，请取消引用后发送');
  expect(screen.getByRole('textbox', { name: '服务器消息内容' })).toHaveValue('还想说的话');
  expect(screen.getByRole('button', { name: '发送服务器消息' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '取消引用' }));
  expect(screen.getByRole('button', { name: '发送服务器消息' })).toBeEnabled();
});
it('confirms a lost send by client ID even when it has already been retracted', async () => {
  const send = vi
    .spyOn(platformApi, 'sendMessage')
    .mockRejectedValue(new ApiError('lost', 'TIMEOUT', 0));
  vi.spyOn(platformApi, 'messageByClient').mockImplementation(async (_id, clientId) => ({
    ...msg('sent'),
    clientId,
    status: 'retracted',
    body: '',
    images: [],
    replyTo: null,
    revision: 2,
  }));
  render(scene());
  await screen.findByText('private-one');
  fireEvent.change(screen.getByRole('textbox', { name: '服务器消息内容' }), {
    target: { value: 'lost text' },
  });
  fireEvent.click(screen.getByRole('button', { name: '发送服务器消息' }));
  await screen.findByText('消息已撤回');
  expect(send).toHaveBeenCalledOnce();
  expect(screen.queryByRole('article', { name: '消息尚未确认' })).not.toBeInTheDocument();
  expect(localStorage.getItem(`gongming-message-draft-v1:${member.id}:chat`)).not.toContain(
    'lost text',
  );
});
it('keeps unknown retraction across dialog close and reopen, queries before allowing another delete', async () => {
  const remove = vi
    .spyOn(platformApi, 'retractMessage')
    .mockRejectedValue(new ApiError('结果丢失', 'TIMEOUT', 0));
  const detail = vi.spyOn(platformApi, 'message').mockResolvedValue(msg());
  render(scene());
  fireEvent.click(await screen.findByRole('button', { name: '撤回消息：private-one' }));
  fireEvent.click(screen.getByRole('button', { name: '确认撤回' }));
  await within(screen.getByRole('dialog')).findByText('结果丢失');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
  fireEvent.click(screen.getByRole('button', { name: '撤回消息：private-one' }));
  fireEvent.click(screen.getByRole('button', { name: '查询撤回结果' }));
  await screen.findByRole('button', { name: '确认撤回' });
  expect(remove).toHaveBeenCalledOnce();
  expect(detail).toHaveBeenCalledOnce();
});
it('clears image File drafts and reply UI when broadcast ownership changes', async () => {
  vi.spyOn(mediaApi, 'uploadToConversation').mockResolvedValue(image);
  const conv = { ...conversation, kind: 'channel' as const };
  const view = render(scene(0, undefined, conv));
  await screen.findByText('private-one');
  await addImage(view.container);
  fireEvent.click(screen.getByRole('button', { name: '回复消息：private-one' }));
  view.rerender(scene(0, undefined, { ...conv, ownerId: 'other' }));
  await waitFor(() => expect(screen.queryByAltText('待发送图片')).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: '取消引用' })).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
});

it('does not acknowledge a 2xx send receipt without its client ID and queries the original request', async () => {
  vi.spyOn(platformApi, 'sendMessage').mockResolvedValue({ ...msg('wrong'), clientId: undefined });
  const lookup = vi
    .spyOn(platformApi, 'messageByClient')
    .mockRejectedValue(new ApiError('offline', 'NETWORK_ERROR', 0));
  render(scene());
  await screen.findByText('private-one');
  fireEvent.change(screen.getByRole('textbox', { name: '服务器消息内容' }), {
    target: { value: 'retain until confirmed' },
  });
  fireEvent.click(screen.getByRole('button', { name: '发送服务器消息' }));
  await waitFor(() => expect(lookup).toHaveBeenCalledOnce());
  expect(screen.getByRole('article', { name: '消息尚未确认' })).toHaveTextContent(
    'retain until confirmed',
  );
  expect(screen.queryByText('private-wrong')).not.toBeInTheDocument();
});
it('does not unlock an unknown retraction on a mismatched message detail', async () => {
  const remove = vi
    .spyOn(platformApi, 'retractMessage')
    .mockRejectedValue(new ApiError('timeout', 'TIMEOUT', 0));
  vi.spyOn(platformApi, 'message').mockResolvedValue(msg('another-id'));
  render(scene());
  fireEvent.click(await screen.findByRole('button', { name: '撤回消息：private-one' }));
  fireEvent.click(screen.getByRole('button', { name: '确认撤回' }));
  await within(screen.getByRole('dialog')).findByText('timeout');
  fireEvent.click(screen.getByRole('button', { name: '查询撤回结果' }));
  await within(screen.getByRole('dialog')).findByText('撤回查询回执与原消息不一致，请重新查询');
  expect(screen.getByRole('button', { name: '查询撤回结果' })).toBeInTheDocument();
  expect(remove).toHaveBeenCalledOnce();
});
it('can query a retained text send after channel transfer but cannot issue a second publish', async () => {
  vi.spyOn(platformApi, 'sendMessage').mockRejectedValue(new ApiError('failed', 'forbidden', 403));
  const lookup = vi
    .spyOn(platformApi, 'messageByClient')
    .mockRejectedValue(new ApiError('not found', 'not_found', 404));
  const channel = { ...conversation, kind: 'channel' as const };
  const view = render(scene(0, undefined, channel));
  await screen.findByText('private-one');
  fireEvent.change(screen.getByRole('textbox', { name: '服务器消息内容' }), {
    target: { value: 'old owner publish' },
  });
  fireEvent.click(screen.getByRole('button', { name: '发送服务器消息' }));
  await screen.findByRole('article', { name: '消息尚未确认' });
  view.rerender(scene(0, undefined, { ...channel, ownerId: 'new-owner' }));
  const query = screen.getByRole('button', { name: '重试发送：old owner publish' });
  expect(query).toBeEnabled();
  fireEvent.click(query);
  await waitFor(() => expect(lookup).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '重试发送：old owner publish' })).toBeDisabled(),
  );
  expect(platformApi.sendMessage).toHaveBeenCalledOnce();
});
it('does not label an invisible conversation 404 as a safe absent send', async () => {
  vi.spyOn(platformApi, 'sendMessage').mockRejectedValue(new ApiError('timeout', 'TIMEOUT', 0));
  vi.spyOn(platformApi, 'messageByClient').mockRejectedValue(
    new ApiError('not found', 'not_found', 404),
  );
  render(scene());
  await screen.findByText('private-one');
  vi.mocked(platformApi.messages).mockRejectedValue(new ApiError('会话已不可见', 'not_found', 404));
  fireEvent.change(screen.getByRole('textbox', { name: '服务器消息内容' }), {
    target: { value: 'preserve own text' },
  });
  fireEvent.click(screen.getByRole('button', { name: '发送服务器消息' }));
  await screen.findByText('当前无法访问这个会话');
  expect(
    screen.queryByText('尚未查询到这条消息，核实后可使用同一请求重试'),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('article', { name: '消息尚未确认' })).toHaveTextContent(
    'preserve own text',
  );
});
