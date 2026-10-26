import { useState, type FormEvent } from 'react';
import { imageUrl } from '../platform-format';
import { PlatformError } from '../PlatformUi';
import type { CircleInput } from './types';
const defaultCircle: CircleInput = {
  name: '',
  description: '',
  category: '',
  cover: '',
  icon: '✦',
  visibility: 'public',
  joinPolicy: 'open',
};
export default function CircleForm({
  initial = defaultCircle,
  busy,
  error,
  label,
  submit,
}: {
  initial?: CircleInput;
  busy: boolean;
  error: string;
  label: string;
  submit: (input: CircleInput) => Promise<void>;
}) {
  const [value, setValue] = useState<CircleInput>(() => ({
      name: initial.name,
      description: initial.description,
      category: initial.category,
      cover: initial.cover,
      icon: initial.icon,
      visibility: initial.visibility,
      joinPolicy: initial.joinPolicy,
    })),
    [validation, setValidation] = useState('');
  const change = (key: keyof CircleInput, text: string) =>
    setValue((previous) => ({ ...previous, [key]: text }));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (
      value.cover.trim() &&
      (!/^https?:\/\//i.test(value.cover.trim()) || !imageUrl(value.cover.trim()))
    ) {
      setValidation('封面请使用有效的外站 http 或 https 图片链接');
      return;
    }
    setValidation('');
    await submit({
      ...value,
      name: value.name.trim(),
      description: value.description.trim(),
      category: value.category.trim(),
      icon: value.icon.trim(),
      cover: value.cover.trim(),
    });
  };
  return (
    <form className="sc-form" onSubmit={(event) => void save(event)}>
      <label>
        圈子名称
        <input
          required
          maxLength={40}
          value={value.name}
          disabled={busy}
          onChange={(event) => change('name', event.target.value)}
        />
      </label>
      <label>
        圈子简介
        <textarea
          maxLength={600}
          rows={4}
          value={value.description}
          disabled={busy}
          onChange={(event) => change('description', event.target.value)}
        />
      </label>
      <div className="sc-form-pair">
        <label>
          圈子图标
          <input
            maxLength={16}
            value={value.icon}
            disabled={busy}
            onChange={(event) => change('icon', event.target.value)}
          />
        </label>
        <label>
          兴趣分类
          <input
            maxLength={30}
            value={value.category}
            disabled={busy}
            onChange={(event) => change('category', event.target.value)}
          />
        </label>
      </div>
      <label>
        封面链接
        <input
          type="url"
          value={value.cover}
          disabled={busy}
          onChange={(event) => change('cover', event.target.value)}
          placeholder="可选：外站 https 图片地址"
        />
      </label>
      <div className="sc-form-pair">
        <label>
          圈子可见性
          <select
            value={value.visibility}
            disabled={busy}
            onChange={(event) => change('visibility', event.target.value)}
          >
            <option value="public">公开介绍</option>
            <option value="private">私密邀请</option>
          </select>
        </label>
        <label>
          加入方式
          <select
            value={value.joinPolicy}
            disabled={busy}
            onChange={(event) => change('joinPolicy', event.target.value)}
          >
            <option value="open">直接加入</option>
            <option value="approval">申请审核</option>
          </select>
        </label>
      </div>
      <p className="sc-muted">公开圈也只向成员展示圈内正文；私密圈需要有效邀请。</p>
      <PlatformError message={validation || error} />
      <button type="submit" className="sc-primary" disabled={busy || !value.name.trim()}>
        {busy ? '正在提交…' : label}
      </button>
    </form>
  );
}
