import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Plus, Users } from 'lucide-react';
import { useProfile } from '@/features/profile/useProfile';
import { useToast } from '@/shared/ui/useToast';
import { PersonAvatar } from './Avatars';
import { socialPaths } from './routes';
import { ContactSelection, SocialMissing, SocialPageFrame, SocialSearch } from './SocialPageParts';
import { allContacts, useSocialActions } from './useSocialActions';

export function GroupMembersPage() {
  const { conversationId } = useParams();
  const { conversations, setConversations } = useSocialActions();
  const { profile } = useProfile();
  const group = conversations.find(
    (conversation) => conversation.id === conversationId && conversation.kind === 'group',
  );
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const notify = useToast();
  if (!group) return <SocialMissing title="群聊不存在" backTo={socialPaths.groups} />;
  const members = allContacts.filter(
    (contact) =>
      group.members?.includes(contact.id) && `${contact.name} ${contact.note}`.includes(query),
  );
  return (
    <SocialPageFrame
      title={`群成员（${(group.members?.length || 0) + 1}）`}
      backTo={socialPaths.chatInfo(group.id)}
      action={
        <button
          className="im-text-link"
          onClick={() => {
            setEditing(!editing);
            setRemoveId(null);
          }}
        >
          {editing ? '完成' : '管理'}
        </button>
      }
    >
      <SocialSearch query={query} setQuery={setQuery} label="搜索群成员" />
      <div className="im-page-list">
        <div className="im-page-person">
          <PersonAvatar name={profile.name} avatar={49} image={profile.avatar} />
          <span>
            <strong>{profile.name}（我）</strong>
            <small>群主</small>
          </span>
          <span className="im-badge">群主</span>
        </div>
        {members.map((member) => (
          <div className="im-page-person" key={member.id}>
            <Link className="im-person-link" to={socialPaths.contact(member.id)}>
              <PersonAvatar name={member.name} avatar={member.avatar} />
              <span>
                <strong>{member.name}</strong>
                <small>{member.note}</small>
              </span>
            </Link>
            {editing ? (
              <button
                className="im-danger-text"
                aria-label={`移除${member.name}`}
                onClick={() => setRemoveId(member.id)}
              >
                移除
              </button>
            ) : (
              <small>{member.status}</small>
            )}
          </div>
        ))}
      </div>
      {!members.length && <p className="im-page-caption">没有找到匹配的群成员。</p>}
      {removeId && (
        <div className="im-page-confirm">
          <strong>
            将 {allContacts.find((contact) => contact.id === removeId)?.name} 移出群聊？
          </strong>
          <p>这只改变当前前端的群成员列表。</p>
          <div className="im-inline-actions">
            <button className="im-secondary" onClick={() => setRemoveId(null)}>
              取消
            </button>
            <button
              className="im-danger"
              onClick={() => {
                setConversations((current) =>
                  current.map((conversation) =>
                    conversation.id === group.id
                      ? {
                          ...conversation,
                          members: conversation.members?.filter((id) => id !== removeId),
                        }
                      : conversation,
                  ),
                );
                setRemoveId(null);
                notify('成员已移出群聊');
              }}
            >
              确认移除
            </button>
          </div>
        </div>
      )}
      <Link className="im-primary im-wide" to={socialPaths.groupInvite(group.id)}>
        <Plus size={18} />
        邀请朋友
      </Link>
    </SocialPageFrame>
  );
}

export function GroupInvitePage() {
  const { conversationId } = useParams();
  const { conversations, setConversations, friends, appendMessage } = useSocialActions();
  const group = conversations.find(
    (conversation) => conversation.id === conversationId && conversation.kind === 'group',
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const notify = useToast();
  if (!group) return <SocialMissing title="群聊不存在" backTo={socialPaths.groups} />;
  const available = friends.filter(
    (friend) =>
      !group.members?.includes(friend.id) && `${friend.name} ${friend.note}`.includes(query),
  );
  function invite() {
    if (!group || !selected.length) {
      notify('请先选择好友');
      return;
    }
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === group.id
          ? {
              ...conversation,
              members: [...new Set([...(conversation.members || []), ...selected])],
            }
          : conversation,
      ),
    );
    appendMessage(
      group.id,
      `你邀请了 ${selected.map((id) => allContacts.find((contact) => contact.id === id)?.name || id).join('、')} 加入群聊。`,
      { mine: false },
    );
    notify(`已邀请 ${selected.length} 位好友`);
    navigate(socialPaths.groupMembers(group.id), { replace: true });
  }
  return (
    <SocialPageFrame title="邀请好友" backTo={socialPaths.groupMembers(group.id)}>
      <SocialSearch query={query} setQuery={setQuery} label="搜索邀请好友" />
      <p className="im-page-caption">
        邀请至「{group.name}」 · 已选 {selected.length} 人
      </p>
      <ContactSelection contacts={available} selected={selected} onChange={setSelected} />
      {!available.length && (
        <div className="im-page-empty">
          <Users size={30} />
          <p>{query ? '没有匹配的好友' : '所有好友都已经在群里了'}</p>
        </div>
      )}
      <div className="im-page-actions">
        <button className="im-primary im-wide" onClick={invite} disabled={!selected.length}>
          确认邀请（{selected.length}）
        </button>
      </div>
    </SocialPageFrame>
  );
}

export function GroupNoticePage() {
  const { conversationId } = useParams();
  const { conversations, setConversations, appendMessage } = useSocialActions();
  const group = conversations.find(
    (conversation) => conversation.id === conversationId && conversation.kind === 'group',
  );
  const [notice, setNotice] = useState(group?.notice || '');
  const notify = useToast();
  const navigate = useNavigate();
  if (!group) return <SocialMissing title="群聊不存在" backTo={socialPaths.groups} />;
  function save() {
    if (!group || !notice.trim()) {
      notify('请填写公告内容');
      return;
    }
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === group.id ? { ...conversation, notice: notice.trim() } : conversation,
      ),
    );
    appendMessage(group.id, `群公告已更新：${notice.trim()}`, { mine: false });
    notify('群公告已发布');
    navigate(socialPaths.chatInfo(group.id), { replace: true });
  }
  return (
    <SocialPageFrame title="群公告" backTo={socialPaths.chatInfo(group.id)}>
      <div className="im-page-form">
        <p className="im-page-caption">{group.name} · 作为群主，你可以编辑公告。</p>
        <label>
          公告内容
          <textarea
            aria-label="群公告内容"
            rows={8}
            maxLength={500}
            placeholder="告诉大家最新的群安排"
            value={notice}
            onChange={(event) => setNotice(event.target.value)}
          />
        </label>
        <small>{notice.length} / 500</small>
        <button className="im-primary im-wide" onClick={save}>
          发布公告
        </button>
      </div>
    </SocialPageFrame>
  );
}
