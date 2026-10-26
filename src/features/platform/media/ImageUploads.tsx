import { LoaderCircle, RotateCcw, Trash2, X } from 'lucide-react';
import type { ImageUploadsState } from './useImageUploads';

export default function ImageUploads({
  uploads,
  disabled,
}: {
  uploads: ImageUploadsState;
  disabled: boolean;
}) {
  if (!uploads.items.length) return null;
  return (
    <div className="world-image-uploads" aria-label="帖子上传图片">
      {uploads.items.map((item, index) => (
        <article
          key={item.clientId}
          className={`world-image-upload is-${item.status}`}
          aria-label={`图片 ${index + 1}`}
        >
          <div className="world-image-preview">
            <img src={item.preview} alt={`选中的图片 ${index + 1}：${item.file.name}`} />
            <button
              type="button"
              aria-label={`${['uploading', 'queued'].includes(item.status) ? '取消上传' : '移除'}图片 ${index + 1}`}
              disabled={disabled || item.status === 'removing'}
              onClick={() => void uploads.remove(item.clientId)}
            >
              <X size={15} />
            </button>
          </div>
          <div className="world-image-state">
            {item.status === 'uploading' || item.status === 'removing' ? (
              <LoaderCircle size={12} className="world-upload-spinner" />
            ) : null}
            <span>
              {item.status === 'queued'
                ? '等待上传'
                : item.status === 'uploading'
                  ? '上传中…'
                  : item.status === 'ready'
                    ? '已上传'
                    : item.status === 'removing'
                      ? '移除中…'
                      : item.status === 'remove-failed'
                        ? '移除未完成'
                        : '上传未完成'}
            </span>
            {item.status === 'failed' && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => void uploads.retry(item.clientId)}
                aria-label={`重试上传图片 ${index + 1}`}
              >
                <RotateCcw size={12} />
                重试
              </button>
            )}
            {item.status === 'remove-failed' && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => void uploads.remove(item.clientId)}
                aria-label={`重试移除图片 ${index + 1}`}
              >
                <Trash2 size={12} />
                重试
              </button>
            )}
          </div>
          {item.error && (
            <small role="alert" className="world-image-error">
              {item.error}
            </small>
          )}
        </article>
      ))}
    </div>
  );
}
