import { BellOff, Check, Search, ShieldCheck } from 'lucide-react';
import { useAccountSettings } from '@/features/profile/useAccountSettings';
import { ConversationAvatar } from './Avatars';
import type { Conversation } from './types';
type Props = {
  conversations: Conversation[];
  selectedId: string;
  onOpenConversation: (id: string) => void;
  onMarkRead: () => void;
  label?: string;
};
export default function ConversationList({
  conversations,
  selectedId,
  onOpenConversation,
  onMarkRead,
  label = '全部消息',
}: Props) {
  const { settings } = useAccountSettings();
  return (
    <div className="im-conversations">
      <div className="im-list-caption">
        <span>{label}</span>
        <button onClick={onMarkRead} aria-label="全部标为已读">
          <Check size={14} />
          全部已读
        </button>
      </div>
      {conversations.map((conversation) => (
        <button
          key={conversation.id}
          className={`im-conversation ${conversation.id === selectedId ? 'im-conversation-active' : ''} ${conversation.pinned ? 'im-conversation-pinned' : ''}`}
          onClick={() => onOpenConversation(conversation.id)}
        >
          <span className="im-avatar-wrap">
            <ConversationAvatar conversation={conversation} />
            {conversation.unread > 0 && (
              <span className={`im-unread ${conversation.muted ? 'im-unread-muted' : ''}`}>
                {conversation.muted ? '' : conversation.unread > 99 ? '99+' : conversation.unread}
              </span>
            )}
          </span>
          <span className="im-conversation-text">
            <span className="im-conversation-name">
              {conversation.name}
              {conversation.kind === 'group' && (
                <span className="im-group-count">({(conversation.members?.length || 3) + 1})</span>
              )}
            </span>
            <span className="im-preview">
              {settings.notifications.showPreview ? conversation.preview : '消息内容已隐藏'}
            </span>
          </span>
          <span className="im-conversation-meta">
            <time>{conversation.time}</time>
            {conversation.muted ? (
              <BellOff size={13} />
            ) : conversation.pinned ? (
              <span className="im-pin-dot" />
            ) : null}
          </span>
        </button>
      ))}
      {!conversations.length && (
        <div className="im-empty">
          <Search size={30} />
          <p>没有找到相关会话</p>
          <span>试试搜索朋友的名字</span>
        </div>
      )}
      <div className="im-list-end">
        <ShieldCheck size={12} /> 消息仅保存在本机
      </div>
    </div>
  );
}
