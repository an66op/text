import { useId, useRef, useState, type FormEvent } from 'react';
import { Camera } from 'lucide-react';
import { useNavigate } from 'react-router';
import { paths } from '@/shared/config/paths';
import { avatar } from '@/shared/lib/media';
import { writeStorage } from '@/shared/lib/storage';
import PageHeader from '@/shared/ui/PageHeader';
import { useToast } from '@/shared/ui/useToast';
import { profileImage } from './profile-media';
import type { Profile } from './profile-context';
import { useProfile } from './useProfile';
import './profile.css';

export default function EditProfilePage() {
  const { profile, setProfile } = useProfile();
  const [name, setName] = useState(profile.name);
  const [bio, setBio] = useState(profile.bio);
  const [location, setLocation] = useState(profile.location || '杭州');
  const [handle, setHandle] = useState(profile.handle || 'orange_soda');
  const [gender, setGender] = useState<NonNullable<Profile['gender']>>(profile.gender || '不公开');
  const [picture, setPicture] = useState(profile.avatar || '');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const notify = useToast();
  const fieldId = useId();
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || processing) return;
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(handle.trim())) {
      setError('共鸣号需要 3–24 位字母、数字或下划线');
      return;
    }
    const next: Profile = {
      ...profile,
      name: name.trim(),
      bio: bio.trim(),
      location: location.trim(),
      handle: handle.trim(),
      gender,
      ...(picture ? { avatar: picture } : {}),
    };
    if (!picture) delete next.avatar;
    if (!writeStorage('profile', next)) {
      setError('本地资料未能保存，请清理浏览器空间后重试');
      return;
    }
    setProfile(next);
    notify('个人资料已保存');
    navigate(paths.me);
  };
  const chooseImage = async (file: File) => {
    setProcessing(true);
    setError('');
    try {
      setPicture(await profileImage(file));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '头像处理失败');
    } finally {
      setProcessing(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };
  return (
    <div className="profile-edit-page">
      <PageHeader title="编辑资料" backTo={paths.me} />
      <form className="profile-edit-form" onSubmit={save}>
        <div className="profile-edit-avatar">
          <button
            type="button"
            aria-label="更换头像"
            onClick={() => fileInput.current?.click()}
            disabled={processing}
          >
            <img src={picture || avatar(49)} alt="我的头像" />
            <span>
              <Camera size={14} />
            </span>
          </button>
          <input
            className="profile-file-input"
            ref={fileInput}
            type="file"
            accept="image/*"
            aria-label="上传头像"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void chooseImage(file);
            }}
          />
          <p>{processing ? '正在处理头像…' : '点击更换头像'}</p>
          {picture && (
            <button
              type="button"
              className="profile-reset-avatar"
              disabled={processing}
              onClick={() => setPicture('')}
            >
              恢复默认头像
            </button>
          )}
        </div>
        <div className="profile-edit-fields">
          <div className="profile-edit-field">
            <div className="profile-field-heading">
              <label htmlFor={`${fieldId}-name`}>昵称</label>
              <small>{name.length}/24</small>
            </div>
            <input
              id={`${fieldId}-name`}
              className="field"
              aria-label="昵称"
              value={name}
              maxLength={24}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div className="profile-edit-field">
            <div className="profile-field-heading">
              <label htmlFor={`${fieldId}-handle`}>共鸣号</label>
              <small>3–24 位</small>
            </div>
            <input
              id={`${fieldId}-handle`}
              className="field"
              aria-label="共鸣号"
              value={handle}
              maxLength={24}
              onChange={(event) => setHandle(event.target.value)}
              placeholder="字母、数字或下划线"
              required
            />
            <p className="profile-field-hint">朋友可以通过共鸣号找到你</p>
          </div>
          <div className="profile-edit-field">
            <div className="profile-field-heading">
              <label htmlFor={`${fieldId}-bio`}>个人简介</label>
              <small>{bio.length}/160</small>
            </div>
            <textarea
              id={`${fieldId}-bio`}
              className="field"
              aria-label="个人简介"
              value={bio}
              maxLength={160}
              placeholder="介绍一下你的兴趣与生活…"
              onChange={(event) => setBio(event.target.value)}
            />
          </div>
          <div className="profile-edit-field">
            <div className="profile-field-heading">
              <label htmlFor={`${fieldId}-location`}>地区</label>
              <small>可选</small>
            </div>
            <input
              id={`${fieldId}-location`}
              className="field"
              aria-label="地区"
              value={location}
              maxLength={30}
              placeholder="你的城市或地区"
              onChange={(event) => setLocation(event.target.value)}
            />
          </div>
          <div className="profile-edit-field">
            <div className="profile-field-heading">
              <label htmlFor={`${fieldId}-gender`}>性别</label>
            </div>
            <select
              id={`${fieldId}-gender`}
              className="field"
              aria-label="性别"
              value={gender}
              onChange={(event) => setGender(event.target.value as NonNullable<Profile['gender']>)}
            >
              <option>不公开</option>
              <option>女</option>
              <option>男</option>
            </select>
          </div>
        </div>
        {error && (
          <p className="profile-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary profile-save" disabled={!name.trim() || processing}>
          保存资料
        </button>
        <p className="settings-hint profile-local-hint">资料保存在本机，头像上传不会发送到服务器</p>
      </form>
    </div>
  );
}
