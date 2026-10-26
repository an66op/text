import { afterEach, describe, expect, it, vi } from 'vitest';
import { mediaApi } from './media-api';
import { imageFileError, MAX_IMAGE_BYTES, validUploadedImage } from './media-model';
import { imageFile, uploadedImage } from './media-test-fixtures';

afterEach(() => vi.unstubAllGlobals());
describe('managed image request boundaries', () => {
  it('sends file and stable clientId as multipart without overriding the browser boundary', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: uploadedImage })));
    vi.stubGlobal('fetch', fetcher);
    const file = imageFile();
    await mediaApi.upload(file, 'same-client-id');
    const [path, options] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/v1/media/images');
    expect(options).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(options.body).toBeInstanceOf(FormData);
    expect((options.body as FormData).get('file')).toBe(file);
    expect((options.body as FormData).get('clientId')).toBe('same-client-id');
    expect(new Headers(options.headers).has('Content-Type')).toBe(false);
  });

  it('rejects empty, unsupported and oversized local files before starting an upload', () => {
    expect(imageFileError(new File([], 'empty.png', { type: 'image/png' }))).toContain('为空');
    expect(imageFileError(new File(['x'], 'vector.svg', { type: 'image/svg+xml' }))).toContain(
      'JPEG 或 PNG',
    );
    const file = imageFile();
    Object.defineProperty(file, 'size', { value: MAX_IMAGE_BYTES + 1 });
    expect(imageFileError(file)).toContain('8 MiB');
    const boundary = imageFile();
    Object.defineProperty(boundary, 'size', { value: MAX_IMAGE_BYTES });
    expect(imageFileError(boundary)).toBe('');
  });

  it('accepts only exact managed paths tied to the returned image ID and usable image metadata', () => {
    expect(validUploadedImage(uploadedImage)).toBe(true);
    for (const url of [
      'https://evil.test/image.png',
      `${uploadedImage.url}?token=1`,
      '//evil.test/image.png',
      '/api/v1/media/images/unknown',
    ])
      expect(validUploadedImage({ ...uploadedImage, url })).toBe(false);
    expect(validUploadedImage({ ...uploadedImage, id: `media_${'b'.repeat(32)}` })).toBe(false);
    expect(validUploadedImage({ ...uploadedImage, width: 8193 })).toBe(false);
    expect(validUploadedImage({ ...uploadedImage, bytes: MAX_IMAGE_BYTES + 1 })).toBe(false);
  });
});
