import { useId, useState, type FormEvent } from 'react';
import { LockKeyhole, Trash2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { useToast } from '@/shared/ui/useToast';
import { circlePaths } from './routes';
import { canManage, useCircles } from './useCircles';
import { CircleManageUnavailable } from './CircleManageUnavailable';
import { ChannelIcon } from './CircleIcons';
import type { ChannelInput, Circle, CircleChannel } from './types';

const channelTypes: { type: CircleChannel['type']; name: string; description: string }[] = [
  { type: 'text', name: '聊天', description: '即时消息与日常交流' },
  { type: 'forum', name: '讨论', description: '围绕主题发帖和回复' },
  { type: 'voice', name: '语音', description: '语音房间与在线交流' },
  { type: 'announcement', name: '公告', description: '由管理员发布圈子通知' },
  { type: 'events', name: '活动', description: '发布和参与圈子活动' },
  { type: 'resources', name: '资源', description: '整理与分享有用的资料' },
];

export function CircleChannelEditPage({ creating = false }: { creating?: boolean }) {
  const { circleId = '', channelId = '' } = useParams();
  const { getCircle, getChannels } = useCircles();
  const circle = getCircle(circleId);
  const title = creating ? '创建频道' : '频道设置';
  if (!circle) return <CircleManageUnavailable title={title} />;
  if (!circle.joined || !canManage(circle))
    return (
      <CircleManageUnavailable
        title={title}
        circleId={circleId}
        message="只有圈主和管理员可以管理频道。"
      />
    );
  const channels = getChannels(circleId);
  const channel = channels.find((item) => item.id === channelId);
  if (!creating && !channel)
    return (
      <CircleManageUnavailable
        title={title}
        circleId={circleId}
        message="这个频道不存在，或已经被删除。"
      />
    );
  return (
    <ChannelForm
      key={creating ? `${circleId}:new` : `${circleId}:${channelId}`}
      circle={circle}
      channel={creating ? undefined : channel}
      categories={[...new Set(channels.map((item) => item.category))]}
    />
  );
}

function ChannelForm({
  circle,
  channel,
  categories,
}: {
  circle: Circle;
  channel?: CircleChannel;
  categories: string[];
}) {
  const { createChannel, updateChannel, deleteChannel, getChannels } = useCircles();
  const navigate = useNavigate();
  const notify = useToast();
  const fieldId = useId();
  const [name, setName] = useState(channel?.name || '');
  const [description, setDescription] = useState(channel?.description || '');
  const [type, setType] = useState<CircleChannel['type']>(channel?.type || 'text');
  const [category, setCategory] = useState(channel?.category || categories[0] || '日常交流');
  const [access, setAccess] = useState<CircleChannel['access']>(channel?.access || 'members');
  const [error, setError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const backTo = channel ? circlePaths.channel(circle.id, channel.id) : circlePaths.home(circle.id);
  const save = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (name.trim().length < 1 || name.trim().length > 32) {
      setError('频道名称需要 1–32 个字。');
      return;
    }
    if (!category.trim()) {
      setError('请输入频道分组。');
      return;
    }
    if (
      getChannels(circle.id).some(
        (item) =>
          item.id !== channel?.id && item.name.trim().toLowerCase() === name.trim().toLowerCase(),
      )
    ) {
      setError('这个圈子已有同名频道，请换一个名称。');
      return;
    }
    const input: ChannelInput = {
      name: name.trim(),
      description: description.trim(),
      category: category.trim(),
      type,
      access,
    };
    setSaving(true);
    try {
      const id = channel
        ? (updateChannel(circle.id, channel.id, input), channel.id)
        : createChannel(circle.id, input);
      notify(channel ? '频道设置已保存' : '频道已创建');
      navigate(circlePaths.channel(circle.id, id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败，请重试。');
      setSaving(false);
    }
  };
  const remove = () => {
    if (!channel) return;
    setDeleteError('');
    try {
      deleteChannel(circle.id, channel.id);
      notify('频道已删除');
      navigate(circlePaths.home(circle.id), { replace: true });
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : '删除失败，请重试。');
    }
  };
  return (
    <div className="circle-page circle-manage-page">
      <PageHeader title={channel ? '频道设置' : '创建频道'} backTo={backTo} />
      <div className="circle-page-body">
        <form className="circle-manage-form" onSubmit={save}>
          <section className="circle-manage-card">
            <h2>频道类型</h2>
            <div className="circle-channel-type-options">
              {channelTypes.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  className={type === item.type ? 'selected' : ''}
                  aria-pressed={type === item.type}
                  onClick={() => setType(item.type)}
                >
                  <span>
                    <ChannelIcon type={item.type} size={22} />
                  </span>
                  <div>
                    <strong>{item.name}</strong>
                    <small>{item.description}</small>
                  </div>
                  <i />
                </button>
              ))}
            </div>
          </section>
          <section className="circle-manage-card circle-form-fields">
            <h2>频道资料</h2>
            <div>
              <div className="circle-manage-field-title">
                <label htmlFor={`${fieldId}-name`}>频道名称</label>
                <small>{name.length}/32</small>
              </div>
              <input
                id={`${fieldId}-name`}
                className="field"
                value={name}
                maxLength={32}
                placeholder="例如：日常聊天"
                required
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div>
              <div className="circle-manage-field-title">
                <label htmlFor={`${fieldId}-description`}>频道简介</label>
                <small>{description.length}/160</small>
              </div>
              <textarea
                id={`${fieldId}-description`}
                className="field"
                value={description}
                maxLength={160}
                rows={3}
                placeholder="说明这个频道用来聊什么"
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div>
              <label className="circle-manage-label" htmlFor={`${fieldId}-category`}>
                频道分组
              </label>
              <input
                id={`${fieldId}-category`}
                className="field"
                list={`${fieldId}-groups`}
                value={category}
                maxLength={24}
                placeholder="选择已有分组或输入新分组"
                onChange={(event) => setCategory(event.target.value)}
                required
              />
              <datalist id={`${fieldId}-groups`}>
                {categories.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </div>
          </section>
          <section className="circle-manage-card">
            <h2>
              <LockKeyhole size={17} />
              访问权限
            </h2>
            <fieldset className="circle-choice-group">
              <legend className="sr-only">频道访问权限</legend>
              <label className={access === 'members' ? 'selected' : ''}>
                <input
                  type="radio"
                  name={`${fieldId}-access`}
                  checked={access === 'members'}
                  onChange={() => setAccess('members')}
                />
                <span>
                  <strong>所有成员</strong>
                  <small>加入圈子的成员均可访问</small>
                </span>
                <span className="circle-choice-dot" />
              </label>
              <label className={access === 'staff' ? 'selected' : ''}>
                <input
                  type="radio"
                  name={`${fieldId}-access`}
                  checked={access === 'staff'}
                  onChange={() => setAccess('staff')}
                />
                <span>
                  <strong>仅圈主与管理员</strong>
                  <small>用于管理和内部沟通</small>
                </span>
                <span className="circle-choice-dot" />
              </label>
            </fieldset>
          </section>
          {error && (
            <p className="circle-manage-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary circle-manage-submit"
            disabled={saving || !name.trim() || !category.trim()}
          >
            {saving ? '正在保存…' : channel ? '保存设置' : '创建频道'}
          </button>
        </form>
        {channel && (
          <section className="circle-manage-card circle-danger-zone">
            <h2>删除频道</h2>
            <p>频道及其中的消息和内容将被永久删除。</p>
            {deleteError && (
              <p className="circle-manage-error" role="alert">
                {deleteError}
              </p>
            )}
            {deleting ? (
              <div className="circle-inline-confirm">
                <strong>确认删除「{channel.name}」？</strong>
                <div>
                  <button className="secondary" onClick={() => setDeleting(false)}>
                    取消
                  </button>
                  <button className="circle-danger-button" onClick={remove}>
                    确认删除
                  </button>
                </div>
              </div>
            ) : (
              <button className="circle-danger-button" onClick={() => setDeleting(true)}>
                <Trash2 size={17} />
                删除频道
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
