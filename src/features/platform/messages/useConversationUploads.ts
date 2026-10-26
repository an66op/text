import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiErrorMessage } from '@/shared/api/client';
import { accountEpoch } from '@/shared/api/account-guard';
import { hostedImageId } from '@/shared/api/media-url';
import { mediaApi } from '../media/media-api';
import { imageFileError, type UploadedImage } from '../media/media-model';
export type ChatUpload = {
  clientId: string;
  file?: File;
  preview: string;
  status: 'queued' | 'uploading' | 'ready' | 'failed' | 'uncertain' | 'checking';
  image?: UploadedImage;
  error: string;
  retryAllowed: boolean;
  cancelled?: boolean;
  fileKey?: string;
};
export function validChatImage(image: UploadedImage, id: string) {
  return (
    image.scope === 'conversation' &&
    image.conversationId === id &&
    !image.circleId &&
    hostedImageId(image.url) === image.id &&
    !!image.id &&
    ['image/jpeg', 'image/png'].includes(image.contentType) &&
    Number.isInteger(image.width) &&
    image.width > 0 &&
    image.width <= 8192 &&
    Number.isInteger(image.height) &&
    image.height > 0 &&
    image.height <= 8192 &&
    image.width * image.height <= 16_000_000 &&
    image.bytes > 0 &&
    image.bytes <= 8 * 1024 * 1024
  );
}
export const uncertainWrite = (error: unknown) =>
  !(error instanceof ApiError) ||
  error.status === 0 ||
  error.status >= 500 ||
  (error.status >= 200 && error.status < 300);
export function useConversationUploads(
  userId: string,
  conversationId: string,
  onDenied: (message: string) => void,
) {
  const [items, setItems] = useState<ChatUpload[]>([]),
    [error, setError] = useState('');
  const scope = useRef({ userId, conversationId }),
    generation = useRef(0);
  const entries = useRef<ChatUpload[]>([]),
    active = useRef(false),
    epoch = useRef(accountEpoch()),
    requests = useRef(new Map<string, AbortController>()),
    running = useRef(false),
    queue = useRef<string[]>([]),
    denied = useRef(onDenied);
  denied.current = onDenied;
  const update = useCallback((change: (items: ChatUpload[]) => ChatUpload[]) => {
    entries.current = change(entries.current);
    setItems(entries.current);
  }, []);
  const owned = useCallback(
    () =>
      active.current &&
      scope.current.userId === userId &&
      scope.current.conversationId === conversationId &&
      epoch.current === accountEpoch(),
    [userId, conversationId],
  );
  const dispose = useCallback(() => {
    active.current = false;
    generation.current++;
    requests.current.forEach((c) => c.abort());
    requests.current.clear();
    queue.current = [];
    entries.current.forEach((item) => {
      if (item.preview.startsWith('blob:')) URL.revokeObjectURL(item.preview);
    });
    entries.current = [];
  }, []);
  useEffect(() => {
    active.current = true;
    generation.current++;
    scope.current = { userId, conversationId };
    running.current = false;
    epoch.current = accountEpoch();
    entries.current = [];
    setItems([]);
    return dispose;
  }, [userId, conversationId, dispose]);

  const upload = useCallback(
    (id: string) => {
      const candidate = entries.current.find((item) => item.clientId === id);
      if (
        !owned() ||
        !candidate?.file ||
        !candidate.retryAllowed ||
        requests.current.has(id) ||
        queue.current.includes(id)
      )
        return;
      queue.current.push(id);
      update((items) =>
        items.map((item) =>
          item.clientId === id ? { ...item, status: 'queued', error: '' } : item,
        ),
      );
      const drain = async () => {
        if (running.current) return;
        running.current = true;
        const version = generation.current;
        try {
          while (owned() && version === generation.current && queue.current.length) {
            const clientId = queue.current.shift()!,
              item = entries.current.find((item) => item.clientId === clientId);
            if (!item?.file) continue;
            const controller = new AbortController();
            requests.current.set(clientId, controller);
            const valid = () =>
              owned() &&
              version === generation.current &&
              !controller.signal.aborted &&
              requests.current.get(clientId) === controller;
            update((items) =>
              items.map((item) =>
                item.clientId === clientId ? { ...item, status: 'uploading' } : item,
              ),
            );
            try {
              const image = await mediaApi.uploadToConversation(
                item.file,
                clientId,
                conversationId,
                controller.signal,
              );
              if (!valid()) continue;
              if (!validChatImage(image, conversationId))
                throw new ApiError('上传回执无法确认，请查询本人上传', 'INVALID_RESPONSE', 200);
              update((items) =>
                items.map((item) =>
                  item.clientId === clientId
                    ? { ...item, status: 'ready', image, error: '', retryAllowed: false }
                    : item,
                ),
              );
            } catch (caught) {
              if (valid()) {
                update((items) =>
                  items.map((item) =>
                    item.clientId === clientId
                      ? {
                          ...item,
                          status: uncertainWrite(caught) ? 'uncertain' : 'failed',
                          error: apiErrorMessage(caught),
                          retryAllowed: !uncertainWrite(caught),
                        }
                      : item,
                  ),
                );
                if (caught instanceof ApiError && caught.status === 404)
                  denied.current('当前无法访问这个会话');
              }
            } finally {
              if (requests.current.get(clientId) === controller) requests.current.delete(clientId);
            }
          }
        } finally {
          if (version === generation.current) running.current = false;
        }
      };
      void drain();
    },
    [conversationId, owned, update],
  );
  const add = useCallback(
    (files: File[]) => {
      if (!owned()) return;
      if (entries.current.filter((item) => !item.cancelled).length + files.length > 9) {
        setError('每条消息最多9张图片');
        return;
      }
      const accepted: ChatUpload[] = [],
        errors: string[] = [];
      for (const file of files) {
        const problem = imageFileError(file);
        if (problem) {
          errors.push(problem);
          continue;
        }
        const fileKey = JSON.stringify([file.name, file.size, file.lastModified, file.type]);
        const cancelled = entries.current.find(
          (item) => item.cancelled && item.fileKey === fileKey,
        );
        if (cancelled && (cancelled.status !== 'failed' || !cancelled.retryAllowed)) {
          errors.push('请先查询已取消的上传；已保存图片可直接加入草稿');
          continue;
        }
        try {
          accepted.push({
            clientId: cancelled?.clientId ?? crypto.randomUUID(),
            fileKey,
            file,
            preview: URL.createObjectURL(file),
            status: 'queued',
            error: '',
            retryAllowed: true,
          });
        } catch {
          errors.push('无法创建图片预览');
        }
      }
      setError(errors.join('；'));
      update((items) => [
        ...items.filter((item) => !accepted.some((next) => next.clientId === item.clientId)),
        ...accepted,
      ]);
      accepted.forEach((item) => upload(item.clientId));
    },
    [owned, update, upload],
  );
  const detach = useCallback(
    (id?: string) => {
      if (!owned()) return;
      const removed = entries.current.filter((item) =>
        id ? item.clientId === id : !item.cancelled,
      );
      const cancelled: ChatUpload[] = [];
      for (const item of removed) {
        requests.current.get(item.clientId)?.abort();
        requests.current.delete(item.clientId);
        if (item.preview.startsWith('blob:')) URL.revokeObjectURL(item.preview);
        if (!item.cancelled && ['uploading', 'uncertain', 'checking'].includes(item.status)) {
          setError('上传可能已经保存，可在我的上传中查询恢复');
          cancelled.push({
            ...item,
            file: undefined,
            preview: '',
            status: 'uncertain',
            retryAllowed: false,
            cancelled: true,
          });
        }
      }
      queue.current = queue.current.filter(
        (value) => !removed.some((item) => item.clientId === value),
      );
      update((items) => [...items.filter((item) => !removed.includes(item)), ...cancelled]);
    },
    [owned, update],
  );
  const recover = useCallback(
    async (id: string) => {
      const item = entries.current.find((item) => item.clientId === id);
      if (!owned() || !item || requests.current.has(id)) return;
      const controller = new AbortController();
      requests.current.set(id, controller);
      update((items) =>
        items.map((item) => (item.clientId === id ? { ...item, status: 'checking' } : item)),
      );
      try {
        const result = await mediaApi.mine(
          { clientId: id, scope: 'conversation', conversationId, limit: 2 },
          controller.signal,
        );
        if (!owned() || controller.signal.aborted) return;
        const found = result.items[0];
        setError('');
        if (
          found &&
          result.items.length === 1 &&
          found.owner?.id === userId &&
          found.previewAvailable &&
          found.status === 'ready' &&
          typeof found.url === 'string' &&
          validChatImage({ ...found, url: found.url }, conversationId)
        ) {
          update((items) =>
            items.map((item) =>
              item.clientId === id
                ? {
                    ...item,
                    status: 'ready',
                    image: { ...found, url: found.url! },
                    retryAllowed: false,
                    error: '',
                  }
                : item,
            ),
          );
        } else
          update((items) =>
            items.map((item) =>
              item.clientId === id
                ? {
                    ...item,
                    status: found ? 'uncertain' : 'failed',
                    retryAllowed: !found,
                    error: found
                      ? '此图片暂不可用于当前会话，请前往我的上传查看'
                      : '未查询到已保存图片，可手动使用同一请求重试',
                  }
                : item,
            ),
          );
      } catch (caught) {
        if (owned() && !controller.signal.aborted)
          update((items) =>
            items.map((item) =>
              item.clientId === id
                ? {
                    ...item,
                    status: 'uncertain',
                    retryAllowed: false,
                    error: apiErrorMessage(caught),
                  }
                : item,
            ),
          );
      } finally {
        if (requests.current.get(id) === controller) requests.current.delete(id);
      }
    },
    [owned, conversationId, userId, update],
  );
  const restore = useCallback(
    (image: UploadedImage) => {
      if (
        !owned() ||
        !validChatImage(image, conversationId) ||
        entries.current.filter((item) => !item.cancelled).length >= 9 ||
        entries.current.some((item) => !item.cancelled && item.image?.id === image.id)
      )
        return false;
      update((items) => [
        ...items,
        {
          clientId: crypto.randomUUID(),
          preview: image.url,
          image,
          status: 'ready',
          error: '',
          retryAllowed: false,
        },
      ]);
      return true;
    },
    [owned, conversationId, update],
  );
  const clear = useCallback(() => {
    generation.current++;
    requests.current.forEach((request) => request.abort());
    requests.current.clear();
    queue.current = [];
    running.current = false;
    entries.current.forEach((item) => {
      if (item.preview.startsWith('blob:')) URL.revokeObjectURL(item.preview);
    });
    update(() => []);
    setError('');
  }, [update]);
  return {
    items,
    cancelled: items.filter((item) => item.cancelled),
    error,
    add,
    detach,
    recover,
    retry: upload,
    restore,
    clear,
    ready: items.filter((item) => !item.cancelled).every((item) => item.status === 'ready'),
    images: items.flatMap((item) => (!item.cancelled && item.image ? [item.image] : [])),
  };
}
