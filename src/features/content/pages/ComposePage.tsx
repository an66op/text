import { useRef, useState } from 'react';
import { Camera, MapPin, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { useLocalStorage } from '@/shared/hooks/useLocalStorage';
import { useProfile } from '@/features/profile/useProfile';
import { loadSettings } from '@/features/profile/settings-model';
import { useToast } from '@/shared/ui/useToast';
import PageHeader from '@/shared/ui/PageHeader';
import { paths } from '@/shared/config/paths';
import { avatar } from '@/shared/lib/media';
import { useContent } from '../useContent';

export default function ComposePage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const notify = useToast();
  const { profile } = useProfile();
  const { addPost } = useContent();
  const [draft, setDraft] = useLocalStorage(
    'content-publish-draft',
    '',
    (value): value is string => typeof value === 'string',
  );
  const [target, setTarget] = useState<'activity' | 'world'>(
    search.get('target') === 'world' ? 'world' : 'activity',
  );
  const [images, setImages] = useState<string[]>([]);
  const [location, setLocation] = useState('');
  const [audience, setAudience] = useState<'public' | 'friends' | 'self'>(() => {
    const visibility = loadSettings().privacy.visibility;
    return visibility === '仅自己'
      ? 'self'
      : visibility === '仅好友' && search.get('target') !== 'world'
        ? 'friends'
        : 'public';
  });
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  async function attach(files: FileList | null) {
    if (!files) return;
    const selected = [...files].slice(0, 9 - images.length);
    if ([...files].length + images.length > 9) notify('每条动态最多添加 9 张图片');
    setBusy(true);
    try {
      const encoded: string[] = [];
      for (const file of selected) {
        if (!file.type.startsWith('image/')) {
          notify('请选择图片文件');
          continue;
        }
        if (file.size > 10_000_000) {
          notify('请选择小于 10 MB 的图片');
          continue;
        }
        const bitmap = await createImageBitmap(file);
        const ratio = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * ratio);
        canvas.height = Math.round(bitmap.height * ratio);
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        encoded.push(canvas.toDataURL('image/jpeg', 0.75));
        bitmap.close();
      }
      setImages((previous) => [...previous, ...encoded].slice(0, 9));
    } catch {
      notify('图片读取失败，请重新选择');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }
  function publish() {
    if ((!draft.trim() && images.length === 0) || busy) return;
    addPost({
      name: profile.name,
      tag: `${target === 'world' ? '世界' : '动态'} · 刚刚`,
      text: draft.trim(),
      image: images[0],
      images,
      kind: target === 'world' ? '世界' : '图文',
      target,
      owner: true,
      audience,
      location: location.trim() || undefined,
      createdAt: Date.now(),
    });
    setDraft('');
    notify('发布成功');
    navigate(target === 'world' ? paths.world : paths.moments, { replace: true });
  }
  return (
    <>
      <PageHeader
        title="发布动态"
        backTo={paths.moments}
        action={
          <button
            className="text-primary"
            disabled={(!draft.trim() && images.length === 0) || busy}
            onClick={publish}
          >
            发布
          </button>
        }
      />
      <div className="content-page compose-page">
        <div className="composer-user">
          <img src={profile.avatar || avatar(49)} alt="我的头像" />
          <div>
            <strong>{profile.name}</strong>
            <small>记录此刻，也分享给同频的人</small>
          </div>
        </div>
        <textarea
          aria-label="动态内容"
          placeholder="这一刻，想说些什么…"
          maxLength={2000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <small className="compose-count">{draft.length} / 2000 · 文字草稿自动保存</small>
        <div className="compose-image-grid">
          {images.map((image, index) => (
            <div key={image}>
              <img src={image} alt={`发布图片 ${index + 1}`} />
              <button
                aria-label={`移除图片 ${index + 1}`}
                onClick={() =>
                  setImages((previous) => previous.filter((_, position) => position !== index))
                }
              >
                <X size={16} />
              </button>
            </div>
          ))}
          {images.length < 9 && (
            <button
              className="compose-add-image"
              aria-label="添加图片"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <Camera size={25} />
              <span>{busy ? '读取中…' : '照片 / 图片'}</span>
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          hidden
          type="file"
          accept="image/*"
          multiple
          onChange={(event) => void attach(event.target.files)}
        />
        <label className="content-form-row">
          <span>发布到</span>
          <select
            aria-label="发布板块"
            value={target}
            onChange={(event) => {
              const value = event.target.value as 'activity' | 'world';
              setTarget(value);
              if (value === 'world' && audience === 'friends') setAudience('public');
            }}
          >
            <option value="activity">动态</option>
            <option value="world">世界</option>
          </select>
        </label>
        <label className="content-form-row">
          <span>谁可以看</span>
          <select
            aria-label="动态可见范围"
            value={audience}
            onChange={(event) => setAudience(event.target.value as typeof audience)}
          >
            <option value="public">公开</option>
            {target === 'activity' && <option value="friends">仅好友</option>}
            <option value="self">仅自己</option>
          </select>
        </label>
        <label className="content-form-row">
          <span>
            <MapPin size={17} />
            所在位置
          </span>
          <input
            aria-label="所在位置"
            placeholder="不显示位置"
            maxLength={60}
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />
        </label>
        <p className="content-note">发布后可以在详情页面管理自己的动态。</p>
      </div>
    </>
  );
}
