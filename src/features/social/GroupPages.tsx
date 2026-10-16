import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Bell, ChevronRight, MessageCircle, Plus, Search, Users } from 'lucide-react';
import { paths } from '@/shared/config/paths';
import { useToast } from '@/shared/ui/useToast';
import { useProfile } from '@/features/profile/useProfile';
import { ConversationAvatar } from './Avatars';
import { socialPaths } from './routes';
import { ContactSelection, SocialMissing, SocialPageFrame, SocialSearch } from './SocialPageParts';
import { useSocialActions } from './useSocialActions';

export function GroupsPage() {
  const { conversations } = useSocialActions();
  const [query, setQuery] = useState('');
  const groups = conversations.filter(
    (conversation) => conversation.kind === 'group' && conversation.name.includes(query),
  );
  return (
    <SocialPageFrame
      title="群聊"
      backTo={paths.contacts}
      action={
        <Link to={socialPaths.groupCreate} aria-label="发起群聊">
          <Plus size={23} />
        </Link>
      }
    >
      <SocialSearch query={query} setQuery={setQuery} label="搜索群聊" />
      <p className="im-page-caption">{groups.length} 个群聊 · 和一群人分享同一种热爱</p>
      <div className="im-page-list">
        {groups.map((group) => (
          <Link className="im-page-person" key={group.id} to={paths.chat(group.id)}>
            <ConversationAvatar conversation={group} />
            <span>
              <strong>{group.name}</strong>
              <small>
                {(group.members?.length || 0) + 1} 位成员 · {group.preview}
              </small>
            </span>
            <ChevronRight size={18} />
          </Link>
        ))}
      </div>
      {!groups.length && (
        <div className="im-page-empty">
          <Users size={35} />
          <h2>{query ? '没有找到这个群聊' : '还没有群聊'}</h2>
          <Link className="im-primary" to={socialPaths.groupCreate}>
            创建第一个群聊
          </Link>
        </div>
      )}
    </SocialPageFrame>
  );
}

export function GroupCreatePage() {
  const { friends, setConversations, setMessages } = useSocialActions();
  const { profile } = useProfile();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const notify = useToast();
  function create() {
    if (!name.trim()) {
      notify('请填写群聊名称');
      return;
    }
    if (selected.length < 2) {
      notify('请选择至少 2 位好友');
      return;
    }
    const id = `group-${crypto.randomUUID()}`;
    setConversations((current) => [
      {
        id,
        name: name.trim(),
        kind: 'group',
        preview: `${profile.name}创建了群聊`,
        time: '刚刚',
        unread: 0,
        members: selected,
        owner: 'me',
        notice: '欢迎加入，一起分享有趣的生活。',
      },
      ...current,
    ]);
    setMessages((current) => ({
      ...current,
      [id]: [
        {
          id: crypto.randomUUID(),
          mine: false,
          text: `欢迎加入「${name.trim()}」！${profile.name}邀请了 ${selected.length} 位好友。`,
          time: '刚刚',
        },
      ],
    }));
    navigate(paths.chat(id), { replace: true });
    notify('群聊已创建');
  }
  return (
    <SocialPageFrame title="发起群聊" backTo={socialPaths.groups}>
      <div className="im-page-form">
        <label>
          群聊名称
          <input
            aria-label="群聊名称"
            placeholder="给你们的群起个名字"
            value={name}
            maxLength={32}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      </div>
      <SocialSearch query={query} setQuery={setQuery} label="搜索可邀请好友" />
      <p className="im-page-caption">选择好友 · 已选 {selected.length} 人</p>
      <ContactSelection
        contacts={friends.filter((friend) => `${friend.name} ${friend.note}`.includes(query))}
        selected={selected}
        onChange={setSelected}
      />
      <div className="im-page-actions">
        <button className="im-primary im-wide" onClick={create}>
          创建群聊（{selected.length + 1} 人）
        </button>
      </div>
    </SocialPageFrame>
  );
}

export function ChatInfoPage() {
  const { conversationId } = useParams();
  const { conversations, setConversations, setMessages } = useSocialActions();
  const selected = conversations.find((conversation) => conversation.id === conversationId);
  const [rename, setRename] = useState(selected?.name || '');
  const [confirmation, setConfirmation] = useState<'clear' | 'leave' | null>(null);
  const navigate = useNavigate();
  const notify = useToast();
  if (!selected) return <SocialMissing title="会话不存在" backTo={paths.social} />;
  function toggle(flag: 'muted' | 'pinned') {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, [flag]: !conversation[flag] }
          : conversation,
      ),
    );
  }
  function confirm() {
    if (!selected) return;
    if (confirmation === 'clear') {
      setMessages((current) => ({ ...current, [selected.id]: [] }));
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === selected.id
            ? { ...conversation, preview: '聊天记录已清空', unread: 0 }
            : conversation,
        ),
      );
      notify('当前设备上的聊天记录已清空');
      setConfirmation(null);
    } else {
      setConversations((current) =>
        current.filter((conversation) => conversation.id !== selected.id),
      );
      setMessages((current) =>
        Object.fromEntries(Object.entries(current).filter(([id]) => id !== selected.id)),
      );
      navigate(socialPaths.groups, { replace: true });
      notify('已退出群聊');
    }
  }
  return (
    <SocialPageFrame
      title={selected.kind === 'group' ? '群聊资料' : '聊天资料'}
      backTo={paths.chat(selected.id)}
    >
      <div className="im-profile-top">
        <ConversationAvatar conversation={selected} />
        <div>
          <h2>{selected.name}</h2>
          <p>
            {selected.kind === 'group'
              ? `${(selected.members?.length || 0) + 1} 位群成员 · 你是群主`
              : selected.kind === 'file'
                ? '你的随身文件夹'
                : '朋友 · 保持连接'}
          </p>
        </div>
      </div>
      {selected.kind === 'group' && (
        <>
          <div className="im-page-form">
            <label>
              群聊名称
              <input
                aria-label="修改群聊名称"
                value={rename}
                maxLength={32}
                onChange={(event) => setRename(event.target.value)}
              />
            </label>
            <button
              className="im-text-link"
              onClick={() => {
                if (!rename.trim()) {
                  notify('群聊名称不能为空');
                  return;
                }
                setConversations((current) =>
                  current.map((conversation) =>
                    conversation.id === selected.id
                      ? { ...conversation, name: rename.trim() }
                      : conversation,
                  ),
                );
                notify('群聊名称已保存');
              }}
            >
              保存名称
            </button>
          </div>
          <div className="im-page-list im-settings-list">
            <Link to={socialPaths.groupMembers(selected.id)}>
              <Users size={18} />
              <span>群成员</span>
              <small>{(selected.members?.length || 0) + 1} 人</small>
              <ChevronRight size={17} />
            </Link>
            <Link to={socialPaths.groupInvite(selected.id)}>
              <Plus size={18} />
              <span>邀请好友</span>
              <ChevronRight size={17} />
            </Link>
            <Link to={socialPaths.groupNotice(selected.id)}>
              <Bell size={18} />
              <span>群公告</span>
              <small>{selected.notice ? '已设置' : '未设置'}</small>
              <ChevronRight size={17} />
            </Link>
          </div>
        </>
      )}
      {selected.kind === 'person' && (
        <Link className="im-page-row" to={socialPaths.contact(selected.id)}>
          查看联系人资料
          <ChevronRight size={17} />
        </Link>
      )}
      <div className="im-page-list im-settings-list">
        {(['pinned', 'muted'] as const).map((flag) => (
          <button
            key={flag}
            role="switch"
            aria-checked={!!selected[flag]}
            aria-label={flag === 'pinned' ? '置顶聊天' : '消息免打扰'}
            onClick={() => toggle(flag)}
          >
            <span>{flag === 'pinned' ? '置顶聊天' : '消息免打扰'}</span>
            <span className={`im-switch ${selected[flag] ? 'im-switch-on' : ''}`} />
          </button>
        ))}
        <Link to={socialPaths.chatSearch(selected.id)}>
          <Search size={18} />
          <span>查找聊天内容</span>
          <ChevronRight size={17} />
        </Link>
        <button onClick={() => setConfirmation('clear')}>
          <span>清空聊天记录</span>
          <ChevronRight size={17} />
        </button>
      </div>
      {selected.kind === 'group' && (
        <button className="im-danger im-wide" onClick={() => setConfirmation('leave')}>
          退出群聊
        </button>
      )}
      {confirmation && (
        <div
          className="im-page-confirm"
          role="group"
          aria-label={confirmation === 'clear' ? '确认清空记录' : '确认退出群聊'}
        >
          <strong>
            {confirmation === 'clear'
              ? '清空此会话在当前设备的全部记录？'
              : '退出后，此群会从你的群聊列表移除。'}
          </strong>
          <div className="im-inline-actions">
            <button className="im-secondary" onClick={() => setConfirmation(null)}>
              取消
            </button>
            <button className="im-danger" onClick={confirm}>
              {confirmation === 'clear' ? '确认清空' : '确认退出'}
            </button>
          </div>
        </div>
      )}
      <Link className="im-primary im-wide" to={paths.chat(selected.id)}>
        <MessageCircle size={18} />
        返回聊天
      </Link>
    </SocialPageFrame>
  );
}
