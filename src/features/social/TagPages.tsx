import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ChevronRight, Plus, Tag } from 'lucide-react';
import { paths } from '@/shared/config/paths';
import { useToast } from '@/shared/ui/useToast';
import { socialPaths } from './routes';
import { ContactSelection, SocialMissing, SocialPageFrame, SocialSearch } from './SocialPageParts';
import { useSocialActions } from './useSocialActions';

export function TagsPage() {
  const { tags } = useSocialActions();
  return (
    <SocialPageFrame
      title="好友标签"
      backTo={paths.contacts}
      action={
        <Link to={socialPaths.tagCreate} aria-label="新建标签">
          <Plus size={23} />
        </Link>
      }
    >
      <p className="im-page-caption">按共同兴趣，找到熟悉的朋友。</p>
      <div className="im-page-list">
        {tags.map((tag) => (
          <Link className="im-page-row" key={tag.id} to={socialPaths.tagDetail(tag.id)}>
            <Tag size={20} />
            <span>{tag.name}</span>
            <small>{tag.contactIds.length} 人</small>
            <ChevronRight size={18} />
          </Link>
        ))}
      </div>
      {!tags.length && (
        <div className="im-page-empty">
          <Tag size={32} />
          <h2>还没有标签</h2>
          <p>建立标签，将朋友按你熟悉的方式分类。</p>
        </div>
      )}
      <Link className="im-primary im-wide" to={socialPaths.tagCreate}>
        <Plus size={18} />
        新建标签
      </Link>
    </SocialPageFrame>
  );
}

export function TagEditorPage({ creating = false }: { creating?: boolean }) {
  const { tagId } = useParams();
  const { tags, setTags, friends } = useSocialActions();
  const tag = tags.find((item) => item.id === tagId);
  const [name, setName] = useState(tag?.name || '');
  const [selected, setSelected] = useState<string[]>(tag?.contactIds || []);
  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const notify = useToast();
  const navigate = useNavigate();
  if (!creating && !tag) return <SocialMissing title="标签不存在" backTo={socialPaths.tags} />;
  function save() {
    if (!name.trim()) {
      notify('请填写标签名称');
      return;
    }
    if (tags.some((item) => item.id !== tag?.id && item.name === name.trim())) {
      notify('已有同名标签，请换个名字');
      return;
    }
    const next = { id: tag?.id || crypto.randomUUID(), name: name.trim(), contactIds: selected };
    setTags((current) =>
      creating ? [...current, next] : current.map((item) => (item.id === next.id ? next : item)),
    );
    notify('标签已保存');
    navigate(socialPaths.tags, { replace: true });
  }
  return (
    <SocialPageFrame title={creating ? '新建标签' : '标签详情'} backTo={socialPaths.tags}>
      <div className="im-page-form">
        <label>
          标签名称
          <input
            aria-label="标签名称"
            value={name}
            maxLength={24}
            placeholder="例如：摄影搭子"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      </div>
      <SocialSearch query={query} setQuery={setQuery} label="搜索标签成员" />
      <p className="im-page-caption">标签成员 · 已选 {selected.length} 位好友</p>
      <ContactSelection
        contacts={friends.filter((friend) => `${friend.name} ${friend.note}`.includes(query))}
        selected={selected}
        onChange={setSelected}
      />
      <div className="im-page-actions">
        <button className="im-primary im-wide" onClick={save}>
          保存标签
        </button>
        {!creating && (
          <button className="im-danger im-wide" onClick={() => setConfirmDelete(true)}>
            删除标签
          </button>
        )}
      </div>
      {confirmDelete && (
        <div className="im-page-confirm">
          <strong>删除「{tag?.name}」？</strong>
          <p>只删除标签，不会删除好友。</p>
          <div className="im-inline-actions">
            <button className="im-secondary" onClick={() => setConfirmDelete(false)}>
              取消
            </button>
            <button
              className="im-danger"
              onClick={() => {
                setTags((current) => current.filter((item) => item.id !== tagId));
                navigate(socialPaths.tags, { replace: true });
                notify('标签已删除');
              }}
            >
              确认删除
            </button>
          </div>
        </div>
      )}
    </SocialPageFrame>
  );
}
