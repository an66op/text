import { apiQuery, apiRequest } from '@/shared/api/client';
import type { MyMediaAsset, MyMediaPage, UploadedImage } from './media-model';

export const mediaApi = {
  mine: (
    query: {
      status?: MyMediaAsset['status'];
      q?: string;
      limit?: number;
      offset?: number;
      clientId?: string;
      scope?: UploadedImage['scope'];
      conversationId?: string;
    } = {},
    signal?: AbortSignal,
  ) => apiRequest<MyMediaPage>(`/me/media${apiQuery(query)}`, { signal }),
  upload: (file: File, clientId: string, signal?: AbortSignal, circleId?: string) => {
    const body = new FormData();
    body.set('file', file);
    body.set('clientId', clientId);
    const path = circleId
      ? `/circles/${encodeURIComponent(circleId)}/media/images`
      : '/media/images';
    return apiRequest<UploadedImage>(path, { method: 'POST', body, signal });
  },
  uploadToConversation: (
    file: File,
    clientId: string,
    conversationId: string,
    signal?: AbortSignal,
  ) => {
    const body = new FormData();
    body.set('file', file);
    body.set('clientId', clientId);
    return apiRequest<UploadedImage>(
      `/conversations/${encodeURIComponent(conversationId)}/media/images`,
      { method: 'POST', body, signal },
    );
  },
  retractMessage: (id: string, signal?: AbortSignal) =>
    apiRequest<{ ok: true; messageId: string }>(`/me/messages/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      signal,
    }),
  remove: (id: string, signal?: AbortSignal) =>
    apiRequest<{ ok: true }>(`/media/images/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      signal,
    }),
};
