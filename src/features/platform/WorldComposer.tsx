import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ImagePlus, Link2, Send, X } from 'lucide-react';
import { Link } from 'react-router';
import { apiErrorMessage } from '@/shared/api/client';
import { platformApi } from '@/shared/api/platformApi';
import type { PlatformPost } from '@/shared/api/types';
import { LoginNotice, PlatformError } from './PlatformUi';
import { useAuth } from './useAuth';
import { imageUrl } from './platform-format';
import { serviceTopics, worldTopics } from './world-topics';
import { MAX_POST_IMAGES } from './media/media-model';
import { useImageUploads } from './media/useImageUploads';
import ImageUploads from './media/ImageUploads';
import './media/media.css';

type ComposerProps = { onClose: () => void; onPublished: (post: PlatformPost) => void };
export default function WorldComposer(props: ComposerProps) {
  const auth = useAuth();
  if (!auth.user) return <LoginNotice returnTo="/world" text="登录后，分享自己的声音" />;
  return <Composer key={`${auth.user.id}:${auth.expiresAt}`} userId={auth.user.id} {...props} />;
}

function Composer({ userId, onClose, onPublished }: ComposerProps & { userId: string }) {
  const [text, setText] = useState('');
  const [topic, setTopic] = useState('生活');
  const [image, setImage] = useState('');
  const [showImage, setShowImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const uploads = useImageUploads(userId);
  const fileInput = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  const publishing = useRef(false);
  const topicId = useId();
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const external = image.trim();
  const totalImages = uploads.items.length + (external ? 1 : 0);
  const tooMany = totalImages > MAX_POST_IMAGES;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!active.current || publishing.current || !text.trim() || !uploads.ready || tooMany) return;
    const externalUrl = external && /^https?:\/\//i.test(external) ? imageUrl(external) : '';
    if (external && !externalUrl) {
      setError('请输入有效的 http 或 https 图片链接');
      return;
    }
    publishing.current = true;
    setBusy(true);
    setError('');
    try {
      const post = await platformApi.publishPost({
        body: text.trim(),
        topic: serviceTopics[topic] ?? topic,
        images: [...uploads.urls, ...(externalUrl ? [externalUrl] : [])],
      });
      if (!active.current) return;
      if (!post.id || post.author.id !== userId)
        throw new Error('帖子返回的账号信息不一致，请刷新后确认');
      onPublished(post);
    } catch (caught) {
      if (active.current) setError(apiErrorMessage(caught));
    } finally {
      publishing.current = false;
      if (active.current) setBusy(false);
    }
  };
  return (
    <form className="platform-world-compose" onSubmit={(event) => void submit(event)}>
      <div className="platform-compose-title">
        <strong>分享此刻</strong>
        <button type="button" aria-label="关闭发布" onClick={onClose} disabled={busy}>
          <X size={18} />
        </button>
      </div>
      <textarea
        aria-label="世界帖子内容"
        required
        rows={4}
        maxLength={5000}
        value={text}
        disabled={busy}
        onChange={(event) => setText(event.target.value)}
        placeholder="一个想法，一次发现，一段日常…"
        autoFocus
      />
      <ImageUploads uploads={uploads} disabled={busy} />
      {showImage && (
        <input
          className="platform-image-input"
          aria-label="帖子图片链接"
          type="url"
          maxLength={1000}
          value={image}
          disabled={busy}
          onChange={(event) => setImage(event.target.value)}
          placeholder="可选：已有的 https 图片链接"
        />
      )}
      <input
        ref={fileInput}
        className="sr-only"
        type="file"
        multiple
        accept="image/jpeg,image/png"
        aria-label="选择帖子图片"
        disabled={busy || totalImages >= MAX_POST_IMAGES}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (totalImages + files.length > MAX_POST_IMAGES) {
            setError('每条帖子最多 9 张图片，请减少选择数量');
            return;
          }
          setError('');
          uploads.add(files);
        }}
      />
      <p className="world-upload-hint">
        JPEG / PNG · 单张最多 8 MiB · 最多 9 张
        {uploads.items.length ? ` · 已选 ${uploads.items.length} 张` : ''}
      </p>
      <div className="platform-compose-tools">
        <button
          type="button"
          aria-label="添加图片"
          disabled={busy || totalImages >= MAX_POST_IMAGES}
          onClick={() => fileInput.current?.click()}
        >
          <ImagePlus size={20} />
        </button>
        <button
          type="button"
          aria-label="添加图片链接"
          disabled={busy}
          onClick={() => setShowImage((value) => !value)}
        >
          <Link2 size={17} />
        </button>
        <label className="sr-only" htmlFor={topicId}>
          帖子话题
        </label>
        <select
          id={topicId}
          value={topic}
          disabled={busy}
          onChange={(event) => setTopic(event.target.value)}
        >
          {worldTopics.slice(1).map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <small>{text.length}/5000</small>
        <button
          className="platform-primary"
          type="submit"
          disabled={busy || !text.trim() || !uploads.ready || tooMany}
        >
          {busy ? '提交中…' : '发布'}
          <Send size={15} />
        </button>
      </div>
      {!uploads.ready && (
        <p className="world-upload-hint" role="status">
          图片处理完成后才能发布；上传不会自动发布帖子。
        </p>
      )}
      <p className="world-upload-hint">
        上传图片的新帖会先提交审核。<Link to="/account/uploads">管理我的上传</Link>
      </p>
      <PlatformError
        message={tooMany ? '每条帖子最多 9 张图片，请移除多余图片' : error || uploads.error}
      />
    </form>
  );
}
