import { hostedImageId } from '@/shared/api/media-url';
import type { PublicUser } from '@/shared/api/types';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_POST_IMAGES = 9;

export type UploadedImage = {
  id: string;
  url: string;
  contentType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  bytes: number;
  createdAt: string;
};
export type MyMediaAsset = UploadedImage & {
  owner: PublicUser;
  status: 'ready' | 'blocked';
  note: string;
  referenceCount: number;
  publishedReferenceCount: number;
  posts: { id: string; body: string; status: 'published' | 'pending' | 'hidden' }[];
  updatedAt: string;
};
export type MyMediaPage = { items: MyMediaAsset[]; total: number };
export type ImageUpload = {
  clientId: string;
  file: File;
  preview: string;
  status: 'queued' | 'uploading' | 'ready' | 'failed' | 'removing' | 'remove-failed';
  image?: UploadedImage;
  error: string;
};

export function imageFileError(file: File) {
  if (!['image/jpeg', 'image/png'].includes(file.type)) return '请选择 JPEG 或 PNG 图片';
  if (!file.size) return '图片文件为空，请重新选择';
  if (file.size > MAX_IMAGE_BYTES) return '每张图片不能超过 8 MiB';
  return '';
}

export function validUploadedImage(value: UploadedImage) {
  return (
    value &&
    hostedImageId(value.url) === value.id &&
    !!value.id &&
    ['image/jpeg', 'image/png'].includes(value.contentType) &&
    Number.isInteger(value.bytes) &&
    value.bytes > 0 &&
    value.bytes <= MAX_IMAGE_BYTES &&
    Number.isInteger(value.width) &&
    value.width > 0 &&
    value.width <= 8192 &&
    Number.isInteger(value.height) &&
    value.height > 0 &&
    value.height <= 8192 &&
    value.width * value.height <= 16_000_000
  );
}
