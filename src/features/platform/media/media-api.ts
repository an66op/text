import { apiQuery, apiRequest } from '@/shared/api/client';
import type { MyMediaAsset, MyMediaPage, UploadedImage } from './media-model';

export const mediaApi = {
  mine: (
    query: { status?: MyMediaAsset['status']; q?: string; limit?: number; offset?: number } = {},
    signal?: AbortSignal,
  ) => apiRequest<MyMediaPage>(`/me/media${apiQuery(query)}`, { signal }),
  upload: (file: File, clientId: string, signal?: AbortSignal) => {
    const body = new FormData();
    body.set('file', file);
    body.set('clientId', clientId);
    return apiRequest<UploadedImage>('/media/images', { method: 'POST', body, signal });
  },
  remove: (id: string, signal?: AbortSignal) =>
    apiRequest<{ ok: true }>(`/media/images/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      signal,
    }),
};
