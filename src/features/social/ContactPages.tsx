import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { MessageCircle, UserPlus } from 'lucide-react';
import { useBlockedContacts } from '@/features/profile/useAccountSettings';
import { useToast } from '@/shared/ui/useToast';
import { PersonAvatar } from './Avatars';
import { contacts } from './fixtures';
import { socialPaths } from './routes';
import { SocialMissing, SocialPageFrame } from './SocialPageParts';
import { findContact, useSocialActions } from './useSocialActions';

export function ContactPage() {
  const { contactId } = useParams();
  const { accepted, notes, tags, startChat } = useSocialActions();
  const { blocked, update: updateBlocked } = useBlockedContacts();
  const notify = useToast();
  const contact = findContact(contactId);
  if (!contact) return <SocialMissing title="联系人不存在" />;
  const friend = contacts.some((item) => item.id === contact.id) || accepted.includes(contact.id);
  const assigned = tags.filter((tag) => tag.contactIds.includes(contact.id));
  return (
    <SocialPageFrame
      title="联系人资料"
      action={
        friend ? (
          <Link to={socialPaths.contactEdit(contact.id)} className="im-text-link">
            编辑
          </Link>
        ) : undefined
      }
    >
      <div className="im-profile-top">
        <PersonAvatar avatar={contact.avatar} name={contact.name} />
        <div>
          <h2>{notes[contact.id]?.alias || contact.name}</h2>
          {notes[contact.id]?.alias && <p>昵称：{contact.name}</p>}
          <p>社交号：{contact.id}</p>
        </div>
      </div>
      <p className="im-profile-note">{contact.note}</p>
      <div className="im-page-list im-details">
        <div>
          <span>地区</span>
          <strong>中国 · {contact.region || '上海'}</strong>
        </div>
        <div>
          <span>状态</span>
          <strong>{contact.status}</strong>
        </div>
        <div>
          <span>备注描述</span>
          <strong>{notes[contact.id]?.description || '暂未添加'}</strong>
        </div>
        <div>
          <span>标签</span>
          <strong>
            {assigned.length
              ? assigned.map((tag) => (
                  <Link key={tag.id} to={socialPaths.tagDetail(tag.id)}>
                    {tag.name}
                  </Link>
                ))
              : '暂无标签'}
          </strong>
        </div>
      </div>
      <div className="im-page-actions">
        {friend ? (
          <>
            <button className="im-primary im-wide" onClick={() => startChat(contact)}>
              <MessageCircle size={18} />
              发消息
            </button>
            <Link className="im-secondary im-wide" to={socialPaths.contactEdit(contact.id)}>
              设置备注和标签
            </Link>
            <button
              className={
                blocked.includes(contact.id) ? 'im-secondary im-wide' : 'im-danger im-wide'
              }
              onClick={() => {
                const saved = updateBlocked(
                  blocked.includes(contact.id)
                    ? blocked.filter((id) => id !== contact.id)
                    : [...blocked, contact.id],
                );
                if (!saved) return;
                notify(blocked.includes(contact.id) ? '已解除拉黑' : '已加入黑名单');
              }}
            >
              {blocked.includes(contact.id) ? '解除拉黑' : '加入黑名单'}
            </button>
          </>
        ) : (
          <Link className="im-primary im-wide" to={socialPaths.friendApply(contact.id)}>
            <UserPlus size={18} />
            添加为朋友
          </Link>
        )}
      </div>
    </SocialPageFrame>
  );
}

export function ContactEditPage() {
  const { contactId } = useParams();
  const { notes, setNotes, tags, setTags, setConversations } = useSocialActions();
  const contact = findContact(contactId);
  const [alias, setAlias] = useState(notes[contactId || '']?.alias || '');
  const [description, setDescription] = useState(notes[contactId || '']?.description || '');
  const [selected, setSelected] = useState(
    tags.filter((tag) => tag.contactIds.includes(contactId || '')).map((tag) => tag.id),
  );
  const navigate = useNavigate();
  const notify = useToast();
  if (!contact) return <SocialMissing title="联系人不存在" />;
  function save() {
    if (!contact) return;
    setNotes((current) => ({
      ...current,
      [contact.id]: { alias: alias.trim(), description: description.trim() },
    }));
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === contact.id
          ? { ...conversation, name: alias.trim() || contact.name }
          : conversation,
      ),
    );
    setTags((current) =>
      current.map((tag) => ({
        ...tag,
        contactIds: selected.includes(tag.id)
          ? [...new Set([...tag.contactIds, contact.id])]
          : tag.contactIds.filter((id) => id !== contact.id),
      })),
    );
    notify('备注和标签已保存');
    navigate(socialPaths.contact(contact.id), { replace: true });
  }
  return (
    <SocialPageFrame title="备注和标签" backTo={socialPaths.contact(contact.id)}>
      <form
        className="im-page-form"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label>
          备注名
          <input
            aria-label="备注名"
            placeholder={contact.name}
            value={alias}
            maxLength={24}
            onChange={(event) => setAlias(event.target.value)}
          />
        </label>
        <label>
          描述
          <textarea
            aria-label="备注描述"
            rows={3}
            placeholder="记录你们的相识或共同兴趣"
            value={description}
            maxLength={160}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <fieldset>
          <legend>好友标签</legend>
          {tags.map((tag) => (
            <label className="im-checkbox-row" key={tag.id}>
              <span>{tag.name}</span>
              <input
                type="checkbox"
                checked={selected.includes(tag.id)}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? [...selected, tag.id]
                      : selected.filter((id) => id !== tag.id),
                  )
                }
              />
            </label>
          ))}
        </fieldset>
        <Link className="im-text-link" to={socialPaths.tagCreate}>
          新建标签
        </Link>
        <button className="im-primary im-wide" type="submit">
          保存
        </button>
      </form>
    </SocialPageFrame>
  );
}
