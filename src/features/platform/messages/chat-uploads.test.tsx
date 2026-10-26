import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { mediaApi } from '../media/media-api';
import type { MyMediaAsset, UploadedImage } from '../media/media-model';
import { member } from '../platform-test-fixtures';
import { useConversationUploads } from './useConversationUploads';
import { advanceAccountEpoch } from '@/shared/api/account-guard';
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
const file = () => new File(['png'], 'photo.png', { type: 'image/png' });
const savedImage = (): MyMediaAsset => ({
  ...image,
  owner: { ...member, id: 'owner' },
  previewAvailable: true,
  status: 'ready',
  worldReferenceCount: 0,
  messageReferenceCount: 0,
  messageReferences: [],
  note: '',
  referenceCount: 0,
  publishedReferenceCount: 0,
  circleReferenceCount: 0,
  circlePublishedReferenceCount: 0,
  circlePosts: [],
  posts: [],
  updatedAt: image.createdAt,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { resolve, promise };
}
beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => `blob:${crypto.randomUUID()}`),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});
afterEach(() => vi.restoreAllMocks());
it('uploads sequentially and moving a ready picture out never deletes server media', async () => {
  const first = deferred<UploadedImage>();
  const upload = vi
    .spyOn(mediaApi, 'uploadToConversation')
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue(image);
  const remove = vi.spyOn(mediaApi, 'remove');
  const { result } = renderHook(() => useConversationUploads('owner', 'chat', vi.fn()));
  act(() => result.current.add([file(), file()]));
  expect(upload).toHaveBeenCalledOnce();
  await act(async () => first.resolve(image));
  await waitFor(() =>
    expect(result.current.items.every((item) => item.status === 'ready')).toBe(true),
  );
  act(() => result.current.detach());
  expect(remove).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  expect(result.current.items).toEqual([]);
});
it('requires exact owner lookup after an unknown upload before manually retrying the same identifier', async () => {
  const upload = vi
    .spyOn(mediaApi, 'uploadToConversation')
    .mockRejectedValueOnce(new ApiError('timeout', 'TIMEOUT', 0))
    .mockResolvedValue(image);
  const mine = vi.spyOn(mediaApi, 'mine').mockResolvedValue({ items: [], total: 0 });
  const { result } = renderHook(() => useConversationUploads('owner', 'chat', vi.fn()));
  act(() => result.current.add([file()]));
  await waitFor(() => expect(result.current.items[0].status).toBe('uncertain'));
  const id = result.current.items[0].clientId;
  act(() => result.current.retry(id));
  expect(upload).toHaveBeenCalledOnce();
  await act(async () => result.current.recover(id));
  expect(mine).toHaveBeenCalledWith(
    { clientId: id, scope: 'conversation', conversationId: 'chat', limit: 2 },
    expect.any(AbortSignal),
  );
  expect(result.current.items[0].status).toBe('failed');
  act(() => result.current.retry(id));
  await waitFor(() => expect(result.current.items[0].status).toBe('ready'));
  expect(upload.mock.calls.map((call) => call[1])).toEqual([id, id]);
});
it('recovers a saved upload without another multipart request', async () => {
  vi.spyOn(mediaApi, 'uploadToConversation').mockRejectedValue(
    new ApiError('broken', 'INVALID_RESPONSE', 201),
  );
  vi.spyOn(mediaApi, 'mine').mockResolvedValue({
    items: [savedImage()],
    total: 1,
  });
  const { result } = renderHook(() => useConversationUploads('owner', 'chat', vi.fn()));
  act(() => result.current.add([file()]));
  await waitFor(() => expect(result.current.items[0].status).toBe('uncertain'));
  await act(async () => result.current.recover(result.current.items[0].clientId));
  expect(result.current.images[0].id).toBe(image.id);
  expect(mediaApi.uploadToConversation).toHaveBeenCalledOnce();
});
it('drops a cancelled File and preview, queries before reselecting, and retries with the original upload identifier', async () => {
  const old = deferred<UploadedImage>();
  const upload = vi
    .spyOn(mediaApi, 'uploadToConversation')
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue(image);
  const mine = vi.spyOn(mediaApi, 'mine').mockResolvedValue({ items: [], total: 0 });
  const { result } = renderHook(() => useConversationUploads('owner', 'chat', vi.fn()));
  const original = file();
  act(() => result.current.add([original]));
  const id = result.current.items[0].clientId;
  act(() => result.current.detach(id));
  expect(upload.mock.calls[0][3]?.aborted).toBe(true);
  expect(result.current.images).toEqual([]);
  expect(result.current.cancelled[0]).toMatchObject({
    clientId: id,
    file: undefined,
    preview: '',
    status: 'uncertain',
    retryAllowed: false,
  });
  expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  act(() => result.current.add([original]));
  expect(upload).toHaveBeenCalledOnce();
  await act(async () => old.resolve(image));
  expect(result.current.images).toEqual([]);
  await act(async () => result.current.recover(id));
  expect(mine).toHaveBeenCalledWith(
    { clientId: id, scope: 'conversation', conversationId: 'chat', limit: 2 },
    expect.any(AbortSignal),
  );
  expect(result.current.cancelled[0].retryAllowed).toBe(true);
  act(() => result.current.add([original]));
  await waitFor(() => expect(result.current.images).toHaveLength(1));
  expect(upload.mock.calls.map((call) => call[1])).toEqual([id, id]);
  expect(result.current.cancelled).toEqual([]);
});
it('keeps a cancelled saved upload detached until explicitly added back without another multipart request', async () => {
  const old = deferred<UploadedImage>();
  const upload = vi.spyOn(mediaApi, 'uploadToConversation').mockReturnValue(old.promise);
  vi.spyOn(mediaApi, 'mine').mockResolvedValue({ items: [savedImage()], total: 1 });
  const { result } = renderHook(() => useConversationUploads('owner', 'chat', vi.fn()));
  act(() => result.current.add([file()]));
  const id = result.current.items[0].clientId;
  act(() => result.current.detach(id));
  await act(async () => result.current.recover(id));
  expect(result.current.images).toEqual([]);
  expect(result.current.cancelled[0].status).toBe('ready');
  act(() => {
    if (result.current.restore(result.current.cancelled[0].image!)) result.current.detach(id);
  });
  expect(result.current.images[0].id).toBe(image.id);
  expect(result.current.cancelled).toEqual([]);
  await act(async () => old.resolve(image));
  expect(result.current.images).toHaveLength(1);
  expect(upload).toHaveBeenCalledOnce();
});
it('drops late uploads after scope A→B→A, permission clearing, or an account epoch change', async () => {
  const old = deferred<UploadedImage>();
  vi.spyOn(mediaApi, 'uploadToConversation').mockReturnValue(old.promise);
  const view = renderHook(({ id }) => useConversationUploads('owner', id, vi.fn()), {
    initialProps: { id: 'chat' },
  });
  act(() => view.result.current.add([file()]));
  view.rerender({ id: 'other' });
  view.rerender({ id: 'chat' });
  await act(async () => old.resolve(image));
  expect(view.result.current.items).toEqual([]);
  expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  act(() => view.result.current.add([file()]));
  act(() => view.result.current.clear());
  await act(async () => {});
  expect(view.result.current.items).toEqual([]);
  advanceAccountEpoch();
  act(() => view.result.current.add([file()]));
  expect(view.result.current.items).toEqual([]);
});
it('does not store File or image identifiers in local storage and cancels on unmount', async () => {
  const old = deferred<UploadedImage>(),
    write = vi.spyOn(Storage.prototype, 'setItem');
  vi.spyOn(mediaApi, 'uploadToConversation').mockReturnValue(old.promise);
  const view = renderHook(() => useConversationUploads('owner', 'chat', vi.fn()));
  act(() => view.result.current.add([file()]));
  const signal = vi.mocked(mediaApi.uploadToConversation).mock.calls[0][3];
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => old.resolve(image));
  expect(write).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
});
