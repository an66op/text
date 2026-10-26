import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { mediaApi } from './media-api';
import type { UploadedImage } from './media-model';
import { imageFile, uploadedImage } from './media-test-fixtures';
import { useImageUploads } from './useImageUploads';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  let preview = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:preview-${++preview}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
describe('owned image upload lifecycle', () => {
  it('queues multiple selected files and sends only one image at a time', async () => {
    const first = deferred<UploadedImage>();
    const upload = vi
      .spyOn(mediaApi, 'upload')
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(uploadedImage);
    const { result } = renderHook(() => useImageUploads('alice'));
    act(() => result.current.add([imageFile('one.png'), imageFile('two.png')]));
    expect(upload).toHaveBeenCalledOnce();
    expect(result.current.items.map((item) => item.status)).toEqual(['uploading', 'queued']);
    expect(result.current.ready).toBe(false);
    await act(async () => first.resolve(uploadedImage));
    expect(upload).toHaveBeenCalledTimes(2);
    expect(result.current.items.map((item) => item.status)).toEqual(['ready', 'ready']);
    expect(result.current.ready).toBe(true);
  });

  it('retains a failed file and retries an uncertain timeout with the original client ID only on demand', async () => {
    const upload = vi
      .spyOn(mediaApi, 'upload')
      .mockRejectedValueOnce(new ApiError('操作可能已完成，请重试确认', 'TIMEOUT', 0))
      .mockResolvedValue(uploadedImage);
    const { result } = renderHook(() => useImageUploads('alice'));
    act(() => result.current.add([imageFile()]));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('failed'));
    const clientId = upload.mock.calls[0][1];
    expect(upload).toHaveBeenCalledOnce();
    expect(result.current.items[0]).toMatchObject({
      clientId,
      error: expect.stringContaining('可能已完成'),
    });
    act(() => result.current.retry(clientId));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('ready'));
    expect(upload.mock.calls[1][1]).toBe(clientId);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
  });

  it('keeps a successful preview when deletion is denied and releases it only after a successful manual retry', async () => {
    vi.spyOn(mediaApi, 'upload').mockResolvedValue(uploadedImage);
    const remove = vi
      .spyOn(mediaApi, 'remove')
      .mockRejectedValueOnce(new ApiError('图片已被引用，无法删除', 'forbidden', 403))
      .mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useImageUploads('alice'));
    act(() => result.current.add([imageFile()]));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const clientId = result.current.items[0].clientId;
    await act(async () => {
      await result.current.remove(clientId);
    });
    expect(result.current.items[0]).toMatchObject({
      status: 'remove-failed',
      image: uploadedImage,
      error: '图片已被引用，无法删除',
    });
    expect(result.current.ready).toBe(false);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledOnce();
    await act(async () => {
      await result.current.remove(clientId);
    });
    expect(result.current.items).toEqual([]);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
  });

  it('cancels a queued file without uploading it and ignores a late success for a removed in-flight file', async () => {
    const first = deferred<UploadedImage>();
    const upload = vi
      .spyOn(mediaApi, 'upload')
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(uploadedImage);
    const remove = vi.spyOn(mediaApi, 'remove');
    const { result } = renderHook(() => useImageUploads('alice'));
    act(() => result.current.add([imageFile('one.png'), imageFile('two.png')]));
    const [one, two] = result.current.items;
    const signal = upload.mock.calls[0][2]!;
    await act(async () => {
      await result.current.remove(two.clientId);
      await result.current.remove(one.clientId);
    });
    expect(signal.aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(result.current.items).toEqual([]);
    act(() => result.current.add([imageFile('three.png')]));
    expect(upload).toHaveBeenCalledOnce();
    await act(async () => first.resolve(uploadedImage));
    expect(upload).toHaveBeenCalledTimes(2);
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].file.name).toBe('three.png');
    expect(result.current.items[0].status).toBe('ready');
    expect(remove).not.toHaveBeenCalled();
  });

  it('aborts and releases all old-account previews without background deletion or late response writes', async () => {
    const pending = deferred<UploadedImage>();
    const upload = vi
      .spyOn(mediaApi, 'upload')
      .mockResolvedValueOnce(uploadedImage)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(uploadedImage);
    const remove = vi.spyOn(mediaApi, 'remove');
    const { result, rerender } = renderHook(({ userId }) => useImageUploads(userId), {
      initialProps: { userId: 'alice' },
    });
    act(() => result.current.add([imageFile('ready.png'), imageFile('pending.png')]));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    const oldAdd = result.current.add;
    const signal = upload.mock.calls[1][2]!;
    rerender({ userId: 'bob' });
    expect(signal.aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(result.current.items).toEqual([]);
    act(() => {
      oldAdd([imageFile('old-callback.png')]);
      result.current.add([imageFile('bob.png')]);
    });
    await waitFor(() => expect(result.current.items[0]?.status).toBe('ready'));
    await act(async () => pending.resolve(uploadedImage));
    expect(result.current.items.map((item) => item.file.name)).toEqual(['bob.png']);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(remove).not.toHaveBeenCalled();
  });

  it('cancels an old deletion and ignores its completion after the account changes', async () => {
    vi.spyOn(mediaApi, 'upload').mockResolvedValue(uploadedImage);
    const pending = deferred<{ ok: true }>();
    const remove = vi.spyOn(mediaApi, 'remove').mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(({ userId }) => useImageUploads(userId), {
      initialProps: { userId: 'alice' },
    });
    act(() => result.current.add([imageFile('alice.png')]));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('ready'));
    let deleting!: Promise<void>;
    act(() => {
      deleting = result.current.remove(result.current.items[0].clientId);
    });
    const signal = remove.mock.calls[0][1]!;
    rerender({ userId: 'bob' });
    expect(signal.aborted).toBe(true);
    act(() => result.current.add([imageFile('bob.png')]));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('ready'));
    await act(async () => {
      pending.resolve({ ok: true });
      await deleting;
    });
    expect(result.current.items.map((item) => item.file.name)).toEqual(['bob.png']);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledOnce();
  });

  it('blocks unsafe server upload paths and validates local type, size and count before creating previews', async () => {
    const upload = vi
      .spyOn(mediaApi, 'upload')
      .mockResolvedValue({ ...uploadedImage, url: 'https://other.test/private.png' });
    const { result } = renderHook(() => useImageUploads('alice'));
    act(() => result.current.add([new File(['x'], 'bad.svg', { type: 'image/svg+xml' })]));
    expect(result.current.error).toContain('JPEG 或 PNG');
    expect(upload).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    act(() => result.current.add(Array.from({ length: 10 }, () => imageFile())));
    expect(result.current.error).toContain('最多 9 张');
    expect(upload).not.toHaveBeenCalled();
    act(() => result.current.add([imageFile()]));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('failed'));
    expect(result.current.ready).toBe(false);
    expect(result.current.items[0].error).toContain('上传结果不完整');
  });
});
