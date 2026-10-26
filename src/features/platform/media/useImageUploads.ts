import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiErrorMessage, isAbort } from '@/shared/api/client';
import { mediaApi } from './media-api';
import {
  imageFileError,
  MAX_POST_IMAGES,
  validUploadedImage,
  type ImageUpload,
} from './media-model';

export function useImageUploads(
  userId: string,
  circleId?: string,
  onDenied?: (message: string) => void,
) {
  const [items, setItems] = useState<ImageUpload[]>([]);
  const [error, setError] = useState('');
  const entries = useRef<ImageUpload[]>([]);
  const current = useRef({ active: false, userId, circleId, generation: 0 });
  const controllers = useRef(new Map<string, AbortController>());
  const waiting = useRef<string[]>([]);
  const uploading = useRef<string | null>(null);
  const denied = useRef(onDenied);
  denied.current = onDenied;
  useEffect(() => {
    const requests = controllers.current;
    current.current = {
      active: true,
      userId,
      circleId,
      generation: current.current.generation + 1,
    };
    entries.current = [];
    setItems([]);
    setError('');
    return () => {
      current.current.active = false;
      current.current.generation += 1;
      for (const controller of requests.values()) controller.abort();
      requests.clear();
      waiting.current = [];
      uploading.current = null;
      for (const item of entries.current) URL.revokeObjectURL(item.preview);
      entries.current = [];
    };
  }, [userId, circleId]);
  const owned = useCallback(
    () =>
      current.current.active &&
      current.current.userId === userId &&
      current.current.circleId === circleId,
    [userId, circleId],
  );
  const update = useCallback((change: (previous: ImageUpload[]) => ImageUpload[]) => {
    entries.current = change(entries.current);
    setItems(entries.current);
  }, []);
  const upload = useCallback(
    (requestedId: string) => {
      if (!owned() || controllers.current.has(requestedId) || waiting.current.includes(requestedId))
        return;
      const candidate = entries.current.find((entry) => entry.clientId === requestedId);
      if (!candidate || candidate.image) return;
      waiting.current.push(requestedId);
      update((previous) =>
        previous.map((entry) =>
          entry.clientId === requestedId ? { ...entry, status: 'queued', error: '' } : entry,
        ),
      );
      const drain = async () => {
        if (uploading.current) return;
        const queueGeneration = current.current.generation;
        while (
          owned() &&
          current.current.generation === queueGeneration &&
          waiting.current.length
        ) {
          const clientId = waiting.current.shift()!;
          const item = entries.current.find((entry) => entry.clientId === clientId);
          if (!item || item.image) continue;
          uploading.current = clientId;
          const controller = new AbortController();
          controllers.current.set(clientId, controller);
          const generation = current.current.generation;
          const valid = () =>
            owned() &&
            !controller.signal.aborted &&
            current.current.generation === generation &&
            controllers.current.get(clientId) === controller;
          update((previous) =>
            previous.map((entry) =>
              entry.clientId === clientId ? { ...entry, status: 'uploading', error: '' } : entry,
            ),
          );
          try {
            const image = circleId
              ? await mediaApi.upload(item.file, clientId, controller.signal, circleId)
              : await mediaApi.upload(item.file, clientId, controller.signal);
            if (!valid()) continue;
            if (!validUploadedImage(image, circleId))
              throw new Error('图片上传结果不完整，请使用同一请求重试');
            update((previous) =>
              previous.map((entry) =>
                entry.clientId === clientId
                  ? { ...entry, status: 'ready', image, error: '' }
                  : entry,
              ),
            );
          } catch (caught) {
            if (valid() && !isAbort(caught)) {
              update((previous) =>
                previous.map((entry) =>
                  entry.clientId === clientId
                    ? { ...entry, status: 'failed', error: apiErrorMessage(caught) }
                    : entry,
                ),
              );
              if (
                circleId &&
                denied.current &&
                caught instanceof ApiError &&
                [403, 404].includes(caught.status)
              ) {
                current.current.active = false;
                current.current.generation += 1;
                waiting.current = [];
                for (const request of controllers.current.values()) request.abort();
                denied.current(apiErrorMessage(caught));
              }
            }
          } finally {
            if (controllers.current.get(clientId) === controller)
              controllers.current.delete(clientId);
            if (uploading.current === clientId) uploading.current = null;
          }
        }
      };
      void drain();
    },
    [owned, update, circleId],
  );
  const add = useCallback(
    (files: File[]) => {
      if (!owned() || !files.length) return;
      if (entries.current.length + files.length > MAX_POST_IMAGES) {
        setError('每条帖子最多 9 张图片，请减少选择数量');
        return;
      }
      const accepted: ImageUpload[] = [];
      const rejected: string[] = [];
      for (const file of files) {
        const problem = imageFileError(file);
        if (problem) {
          rejected.push(`${file.name}：${problem}`);
          continue;
        }
        try {
          accepted.push({
            clientId: crypto.randomUUID(),
            file,
            preview: URL.createObjectURL(file),
            status: 'queued',
            error: '',
          });
        } catch {
          rejected.push(`${file.name}：无法创建图片预览，请重新选择`);
        }
      }
      setError(rejected.join('；'));
      update((previous) => [...previous, ...accepted]);
      for (const item of accepted) void upload(item.clientId);
    },
    [owned, update, upload],
  );
  const remove = useCallback(
    async (clientId: string) => {
      if (!owned()) return;
      const item = entries.current.find((entry) => entry.clientId === clientId);
      if (!item || item.status === 'removing') return;
      const drop = () => {
        URL.revokeObjectURL(item.preview);
        update((previous) => previous.filter((entry) => entry.clientId !== clientId));
      };
      if (!item.image) {
        waiting.current = waiting.current.filter((id) => id !== clientId);
        controllers.current.get(clientId)?.abort();
        controllers.current.delete(clientId);
        drop();
        return;
      }
      const controller = new AbortController();
      controllers.current.set(clientId, controller);
      const generation = current.current.generation;
      const valid = () =>
        owned() &&
        !controller.signal.aborted &&
        current.current.generation === generation &&
        controllers.current.get(clientId) === controller;
      update((previous) =>
        previous.map((entry) =>
          entry.clientId === clientId ? { ...entry, status: 'removing', error: '' } : entry,
        ),
      );
      try {
        const result = await mediaApi.remove(item.image.id, controller.signal);
        if (!valid()) return;
        if (result.ok !== true) throw new Error('服务尚未确认图片已移除，请重试');
        drop();
      } catch (caught) {
        if (valid() && !isAbort(caught))
          update((previous) =>
            previous.map((entry) =>
              entry.clientId === clientId
                ? { ...entry, status: 'remove-failed', error: apiErrorMessage(caught) }
                : entry,
            ),
          );
      } finally {
        if (controllers.current.get(clientId) === controller) controllers.current.delete(clientId);
      }
    },
    [owned, update],
  );
  return {
    items,
    error,
    add,
    retry: upload,
    remove,
    ready: items.every((item) => item.status === 'ready'),
    urls: items.flatMap((item) => (item.image ? [item.image.url] : [])),
  };
}

export type ImageUploadsState = ReturnType<typeof useImageUploads>;
