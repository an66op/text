import { useEffect, useRef, useState } from 'react';
import { ImageOff, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { hostedImageId } from '@/shared/api/media-url';
import type { PlatformMessage, MessageImage } from '@/shared/api/types';
function usableImage(image: MessageImage) {
  return image.available && typeof image.url === 'string' && hostedImageId(image.url) === image.id;
}
export function MessageImages({
  images,
  onOpen,
}: {
  images: MessageImage[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className={`chat-images ${images.length === 1 ? 'single' : ''}`}>
      {images.map((image) =>
        usableImage(image) ? (
          <button
            type="button"
            key={image.id}
            onClick={() => onOpen(image.id)}
            aria-label="查看消息图片"
            style={{ aspectRatio: `${image.width}/${image.height}` }}
          >
            <img
              src={image.url!}
              alt="消息图片"
              loading="lazy"
              onError={(event) => {
                event.currentTarget.style.visibility = 'hidden';
              }}
            />
          </button>
        ) : (
          <span key={image.id} className="chat-image-unavailable">
            <ImageOff size={21} />
            图片暂不可用
          </span>
        ),
      )}
    </div>
  );
}
export default function MessageViewer({
  messages,
  target,
  onClose,
}: {
  messages: PlatformMessage[];
  target: { messageId: string; imageId: string };
  onClose: () => void;
}) {
  const message = messages.find((item) => item.id === target.messageId),
    images = message?.status === 'retracted' ? [] : (message?.images?.filter(usableImage) ?? []);
  const [id, setId] = useState(target.imageId),
    [failed, setFailed] = useState('');
  const image = images.find((item) => item.id === id),
    index = images.findIndex((item) => item.id === id),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!image) onClose();
  }, [image, onClose]);
  useEffect(() => {
    const node = dialog.current,
      old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (typeof node?.showModal === 'function') node.showModal();
    else node?.setAttribute('open', '');
    return () => {
      document.body.style.overflow = old;
      node?.close?.();
    };
  }, []);
  if (!image) return null;
  return (
    <dialog
      ref={dialog}
      className="chat-image-viewer"
      aria-label="图片全屏查看"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <span>
          {index + 1} / {images.length}
        </span>
        <button type="button" aria-label="关闭图片查看" onClick={onClose}>
          <X size={25} />
        </button>
      </header>
      {failed === id ? (
        <p>图片暂不可用，请关闭后刷新消息</p>
      ) : (
        <img
          key={id}
          src={image.url!}
          alt="消息原图"
          onError={() => {
            setFailed(id);
            onClose();
          }}
        />
      )}
      <footer>
        <button
          type="button"
          aria-label="上一张图片"
          disabled={index <= 0}
          onClick={() => setId(images[index - 1].id)}
        >
          <ChevronLeft />
        </button>
        <button
          type="button"
          aria-label="下一张图片"
          disabled={index >= images.length - 1}
          onClick={() => setId(images[index + 1].id)}
        >
          <ChevronRight />
        </button>
      </footer>
    </dialog>
  );
}
