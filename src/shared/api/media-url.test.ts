import { describe, expect, it } from 'vitest';
import { imageUrl } from '@/features/platform/platform-format';
import { hostedImageId } from './media-url';

describe('trusted hosted image paths', () => {
  const id = `media_${'a'.repeat(32)}`;
  const path = `/api/v1/media/images/${id}`;
  it('renders the exact API image URL and existing remote photos', () => {
    expect(hostedImageId(path)).toBe(id);
    expect(imageUrl(path)).toBe(path);
    expect(imageUrl('https://example.test/photo.jpg')).toBe('https://example.test/photo.jpg');
  });
  it.each([
    `${path}?private=1`,
    `${path}#x`,
    `${path}/../account`,
    '//example.test/image.jpg',
    '/api/v1/auth/me',
    '/assets/photo.png',
    `/api/v1/media/images/media_${'A'.repeat(32)}`,
    'javascript:alert(1)',
    'data:image/svg+xml,<svg/>',
    'https://user:secret@example.test/image.jpg',
  ])('rejects an untrusted image path: %s', (value) => {
    expect(hostedImageId(value)).toBe('');
    expect(imageUrl(value)).toBe('');
  });
});
