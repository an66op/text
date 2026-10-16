import { useId, useState, type FormEvent } from 'react';
import { Check, ChevronRight, Image, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { useToast } from '@/shared/ui/useToast';
import { circlePaths } from './routes';
import { canManage, useCircles } from './useCircles';
import type { Circle, CircleInput } from './types';
import { CircleManageUnavailable } from './CircleManageUnavailable';

export { CircleMembersPage } from './MembersPage';
export { CircleInvitePage, CircleJoinPage } from './InvitePage';
export { CircleChannelEditPage } from './ChannelEditPage';

const covers = [
  {
    name: '山野',
    url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1000&q=80',
  },
  {
    name: '海边',
    url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1000&q=80',
  },
  {
    name: '城市',
    url: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=1000&q=80',
  },
  {
    name: '森林',
    url: 'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1000&q=80',
  },
];
const icons = ['📷', '🌿', '🎨', '🎧', '📚', '☕', '🚲', '✨'];
const categories = ['生活方式', '摄影', '艺术设计', '音乐', '阅读', '户外运动', '科技', '其他'];

export function CircleCreatePage() {
  return <CircleDetailsForm />;
}

export function CircleSettingsPage() {
  const { circleId = '' } = useParams();
  const { getCircle } = useCircles();
  const circle = getCircle(circleId);
  if (!circle) return <CircleManageUnavailable title="圈子设置" />;
  if (!circle.joined || !canManage(circle))
    return (
      <CircleManageUnavailable
        title="圈子设置"
        circleId={circleId}
        message="只有圈主和管理员可以管理圈子。"
      />
    );
  return <CircleDetailsForm key={circleId} circle={circle} />;
}

function CircleDetailsForm({ circle }: { circle?: Circle }) {
  const { createCircle, updateCircle, deleteCircle } = useCircles();
  const navigate = useNavigate();
  const notify = useToast();
  const fieldId = useId();
  const [name, setName] = useState(circle?.name || '');
  const [description, setDescription] = useState(circle?.description || '');
  const [icon, setIcon] = useState(circle?.icon || '✨');
  const [category, setCategory] = useState(circle?.category || '生活方式');
  const [visibility, setVisibility] = useState<CircleInput['visibility']>(
    circle?.visibility || 'public',
  );
  const [cover, setCover] = useState(circle?.cover || covers[0].url);
  const [error, setError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const title = circle ? '圈子设置' : '创建圈子';
  const backTo = circle ? circlePaths.home(circle.id) : circlePaths.list;
  const coverChoices =
    circle?.cover && !covers.some((item) => item.url === circle.cover)
      ? [{ name: '当前封面', url: circle.cover }, ...covers]
      : covers;
  const categoryChoices = categories.includes(category) ? categories : [category, ...categories];

  const save = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (name.trim().length < 2 || name.trim().length > 40) {
      setError('圈子名称需要 2–40 个字。');
      return;
    }
    if (!icon.trim()) {
      setError('请选择或填写圈子图标。');
      return;
    }
    if (!category.trim()) {
      setError('请选择圈子分类。');
      return;
    }
    const input: CircleInput = {
      name: name.trim(),
      description: description.trim(),
      icon: icon.trim(),
      category: category.trim(),
      visibility,
      cover,
    };
    setSaving(true);
    try {
      const id = circle ? (updateCircle(circle.id, input), circle.id) : createCircle(input);
      notify(circle ? '圈子设置已保存' : '圈子已创建');
      navigate(circlePaths.home(id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败，请重试。');
      setSaving(false);
    }
  };
  const remove = () => {
    if (!circle || circle.role !== 'owner' || confirmation !== circle.name) return;
    setDeleteError('');
    try {
      deleteCircle(circle.id);
      notify('圈子已解散');
      navigate(circlePaths.list, { replace: true });
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : '解散失败，请重试。');
    }
  };

  return (
    <div className="circle-page circle-manage-page">
      <PageHeader title={title} backTo={backTo} />
      <div className="circle-page-body">
        <form className="circle-manage-form" onSubmit={save}>
          <div className="circle-manage-cover" style={{ backgroundImage: `url(${cover})` }}>
            <span>{icon || '✨'}</span>
            <div>
              <strong>{name.trim() || '圈子名称'}</strong>
              <small>{category}</small>
            </div>
          </div>
          <section className="circle-manage-card">
            <h2>
              <Image size={18} />
              封面与图标
            </h2>
            <div className="circle-cover-options" aria-label="选择圈子封面">
              {coverChoices.map((item) => (
                <button
                  type="button"
                  key={item.url}
                  style={{ backgroundImage: `url(${item.url})` }}
                  aria-label={`${item.name}封面`}
                  aria-pressed={cover === item.url}
                  onClick={() => setCover(item.url)}
                >
                  <span>{item.name}</span>
                  {cover === item.url && (
                    <i>
                      <Check size={13} />
                    </i>
                  )}
                </button>
              ))}
            </div>
            <label className="circle-manage-label" htmlFor={`${fieldId}-icon`}>
              圈子图标
            </label>
            <div className="circle-icon-options" aria-label="选择圈子图标">
              {icons.map((item) => (
                <button
                  type="button"
                  key={item}
                  aria-label={`图标 ${item}`}
                  aria-pressed={icon === item}
                  onClick={() => setIcon(item)}
                >
                  {item}
                </button>
              ))}
              <input
                id={`${fieldId}-icon`}
                value={icon}
                maxLength={8}
                aria-label="自定义圈子图标"
                onChange={(event) => setIcon(event.target.value)}
              />
            </div>
          </section>
          <section className="circle-manage-card circle-form-fields">
            <h2>基本资料</h2>
            <div>
              <div className="circle-manage-field-title">
                <label htmlFor={`${fieldId}-name`}>圈子名称</label>
                <small>{name.length}/40</small>
              </div>
              <input
                id={`${fieldId}-name`}
                className="field"
                value={name}
                maxLength={40}
                placeholder="给圈子起个名字"
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div>
              <div className="circle-manage-field-title">
                <label htmlFor={`${fieldId}-description`}>圈子简介</label>
                <small>{description.length}/240</small>
              </div>
              <textarea
                id={`${fieldId}-description`}
                className="field"
                value={description}
                maxLength={240}
                placeholder="介绍圈子的主题和日常"
                rows={3}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div>
              <label className="circle-manage-label" htmlFor={`${fieldId}-category`}>
                分类
              </label>
              <select
                id={`${fieldId}-category`}
                className="field"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                {categoryChoices.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </div>
          </section>
          <section className="circle-manage-card">
            <h2>加入方式</h2>
            <fieldset className="circle-choice-group">
              <legend className="sr-only">圈子可见性</legend>
              <label className={visibility === 'public' ? 'selected' : ''}>
                <input
                  type="radio"
                  name={`${fieldId}-visibility`}
                  value="public"
                  checked={visibility === 'public'}
                  onChange={() => setVisibility('public')}
                />
                <span>
                  <strong>公开圈子</strong>
                  <small>任何人都可以查看并加入</small>
                </span>
                <span className="circle-choice-dot" />
              </label>
              <label className={visibility === 'invite' ? 'selected' : ''}>
                <input
                  type="radio"
                  name={`${fieldId}-visibility`}
                  value="invite"
                  checked={visibility === 'invite'}
                  onChange={() => setVisibility('invite')}
                />
                <span>
                  <strong>邀请加入</strong>
                  <small>需要有效的邀请码才能加入</small>
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
            disabled={saving || name.trim().length < 2 || !icon.trim()}
          >
            {saving ? '正在保存…' : circle ? '保存设置' : '创建圈子'}
          </button>
        </form>
        {circle && (
          <section className="circle-manage-card circle-management-links" aria-label="圈子管理">
            <Link to={circlePaths.members(circle.id)}>
              <Users size={20} />
              <span>成员与角色</span>
              <ChevronRight size={17} />
            </Link>
            <Link to={circlePaths.invite(circle.id)}>
              <UserPlus size={20} />
              <span>邀请成员</span>
              <ChevronRight size={17} />
            </Link>
            <Link to={circlePaths.createChannel(circle.id)}>
              <Plus size={20} />
              <span>创建频道</span>
              <ChevronRight size={17} />
            </Link>
          </section>
        )}
        {circle?.role === 'owner' && (
          <section className="circle-manage-card circle-danger-zone">
            <h2>解散圈子</h2>
            <p>解散后，圈子及其中的频道、内容将被删除，无法恢复。</p>
            {deleteError && (
              <p className="circle-manage-error" role="alert">
                {deleteError}
              </p>
            )}
            {deleting ? (
              <div className="circle-inline-confirm">
                <label htmlFor={`${fieldId}-delete`}>输入「{circle.name}」以确认解散</label>
                <input
                  id={`${fieldId}-delete`}
                  className="field"
                  autoComplete="off"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
                <div>
                  <button
                    className="secondary"
                    onClick={() => {
                      setDeleting(false);
                      setConfirmation('');
                    }}
                  >
                    取消
                  </button>
                  <button
                    className="circle-danger-button"
                    disabled={confirmation !== circle.name}
                    onClick={remove}
                  >
                    确认解散
                  </button>
                </div>
              </div>
            ) : (
              <button className="circle-danger-button" onClick={() => setDeleting(true)}>
                <Trash2 size={17} />
                解散圈子
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
