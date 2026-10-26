import { useEffect, useState } from 'react';
import { useAuth } from '../useAuth';
import { mediaApi } from '../media/media-api';
import type { UploadedImage } from '../media/media-model';
import { PlatformError } from '../PlatformUi';
import { apiErrorMessage } from '@/shared/api/client';
import { validChatImage } from './useConversationUploads';
export default function ChatUploadPicker({
  conversationId,
  onSelect,
  onClose,
}: {
  conversationId: string;
  onSelect: (image: UploadedImage) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [items, setItems] = useState<UploadedImage[]>([]),
    [error, setError] = useState(''),
    [page, setPage] = useState(0),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void mediaApi
      .mine(
        { scope: 'conversation', conversationId, status: 'ready', limit: 12, offset: page * 12 },
        controller.signal,
      )
      .then((result) => {
        if (controller.signal.aborted) return;
        setItems(
          result.items.flatMap((item) =>
            item.owner?.id === user?.id &&
            item.previewAvailable &&
            typeof item.url === 'string' &&
            validChatImage({ ...item, url: item.url }, conversationId)
              ? [{ ...item, url: item.url }]
              : [],
          ),
        );
        setTotal(result.total);
        setError('');
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(apiErrorMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [conversationId, page, user?.id]);
  return (
    <section className="chat-upload-picker" aria-label="恢复本人聊天上传">
      <div>
        <strong>本会话的本人上传</strong>
        <button type="button" onClick={onClose}>
          关闭
        </button>
      </div>
      <PlatformError message={error} />
      {loading ? (
        <p role="status">正在读取…</p>
      ) : (
        <div className="chat-upload-grid">
          {items.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-label={`选用图片 ${item.id.slice(-8)}`}
              onClick={() => {
                onSelect(item);
                onClose();
              }}
            >
              <img src={item.url} alt="本人上传" />
            </button>
          ))}
        </div>
      )}
      {!loading && !items.length && !error && <p>这一页没有可恢复图片</p>}
      <nav>
        <button type="button" disabled={!page || loading} onClick={() => setPage((v) => v - 1)}>
          上一页
        </button>
        <button
          type="button"
          disabled={(page + 1) * 12 >= total || loading}
          onClick={() => setPage((v) => v + 1)}
        >
          下一页
        </button>
      </nav>
    </section>
  );
}
