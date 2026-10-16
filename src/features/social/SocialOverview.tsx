import { useState } from 'react';
import { Plus, Radio, Search, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import ConversationList from './ConversationList';
import ContactsPanel from './ContactsPanel';
import { useSocialActions } from './useSocialActions';
import SocialChannelList from './SocialChannelList';
import { socialPaths } from './routes';
import type { Conversation, SocialAction, View } from './types';

type Props = {
  view: View;
  unread: number;
  conversations: Conversation[];
  selectedId: string;
  selectedChannelId?: string;
  accepted: string[];
  onAction: (action: SocialAction) => void;
  onOpenModule: (name: string) => void;
  onOpenConversation: (id: string) => void;
  onOpenProfile: (id: string) => void;
  onMarkRead: () => void;
};

export default function SocialOverview({
  view,
  unread,
  conversations,
  selectedId,
  selectedChannelId,
  accepted,
  onAction,
  onOpenModule,
  onOpenConversation,
  onOpenProfile,
  onMarkRead,
}: Props) {
  const { friends } = useSocialActions();
  const [query, setQuery] = useState('');
  const [plusOpen, setPlusOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const selectedType = searchParams.get('type');
  const filter = selectedChannelId
    ? 'channels'
    : selectedType === 'private' || selectedType === 'groups' || selectedType === 'channels'
      ? selectedType
      : 'all';
  const filtered = conversations
    .filter((conversation) =>
      filter === 'private'
        ? conversation.kind === 'person' || conversation.kind === 'file'
        : filter === 'groups'
          ? conversation.kind === 'group'
          : true,
    )
    .filter((conversation) =>
      `${conversation.name} ${conversation.preview}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  const openAction = (action: SocialAction) => {
    onAction(action);
    setPlusOpen(false);
  };
  return (
    <div className="im-overview">
      <header className="im-topbar">
        <div className="im-title-block">
          <h1 className="im-title">
            {view}
            <span>{view === '消息' ? (unread > 0 ? unread : '') : `${friends.length}`}</span>
          </h1>
        </div>
        <div className="im-top-actions">
          <div className="im-plus-wrap">
            <button
              aria-label="添加好友或群聊"
              aria-expanded={plusOpen}
              onClick={() => setPlusOpen(!plusOpen)}
            >
              <Plus size={24} />
            </button>
            {plusOpen && (
              <>
                <button
                  className="im-menu-dismiss"
                  aria-label="关闭添加菜单"
                  onClick={() => setPlusOpen(false)}
                />
                <div className="im-plus-menu">
                  <button onClick={() => openAction('group')}>
                    <Users size={18} />
                    发起群聊
                  </button>
                  <button onClick={() => openAction('friend')}>
                    <UserPlus size={18} />
                    添加朋友
                  </button>
                  <Link to={socialPaths.channelCreate} onClick={() => setPlusOpen(false)}>
                    <Radio size={18} />
                    创建频道
                  </Link>
                  <button
                    onClick={() => {
                      onOpenModule('圈子');
                      setPlusOpen(false);
                    }}
                  >
                    <ShieldCheck size={18} />
                    我的圈子
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>
      <div className="im-search-wrap">
        <Search size={16} />
        <input
          aria-label={
            view === '消息' ? (filter === 'channels' ? '搜索频道' : '搜索会话') : '搜索联系人'
          }
          placeholder={
            view === '消息'
              ? filter === 'channels'
                ? '搜索频道名称和介绍'
                : '搜索朋友、群组和消息'
              : '搜索姓名或备注'
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button aria-label="清除搜索" onClick={() => setQuery('')}>
            <X size={14} />
          </button>
        )}
      </div>
      {view === '消息' && (
        <div className="social-message-tabs" role="tablist" aria-label="消息分类">
          {(
            [
              { id: 'all', label: '全部' },
              { id: 'private', label: '私聊' },
              { id: 'groups', label: '群组' },
              { id: 'channels', label: '频道' },
            ] as const
          ).map((tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={filter === tab.id}
              key={tab.id}
              onClick={() => {
                setQuery('');
                const next = new URLSearchParams(searchParams);
                next.set('type', tab.id);
                navigate(`/social?${next.toString()}`, { replace: true });
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      {view === '消息' && filter === 'channels' && (
        <SocialChannelList query={query} selectedId={selectedChannelId} />
      )}
      {view === '消息' && filter !== 'channels' && (
        <ConversationList
          label={filter === 'private' ? '私聊' : filter === 'groups' ? '群组' : '全部消息'}
          conversations={filtered}
          selectedId={selectedId}
          onOpenConversation={onOpenConversation}
          onMarkRead={onMarkRead}
        />
      )}
      {view === '通讯录' && (
        <ContactsPanel
          query={query}
          accepted={accepted}
          onAction={onAction}
          onOpenProfile={onOpenProfile}
          onOpenModule={onOpenModule}
        />
      )}
    </div>
  );
}
