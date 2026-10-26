import type { UploadedImage } from './media-model';

export const uploadedImage: UploadedImage = {
  id: `media_${'a'.repeat(32)}`,
  url: `/api/v1/media/images/media_${'a'.repeat(32)}`,
  contentType: 'image/png',
  width: 640,
  height: 480,
  bytes: 1280,
  createdAt: '2026-10-27T08:00:00Z',
};
export const imageFile = (name = '日常.png') =>
  new File(['image-bytes'], name, { type: 'image/png' });
