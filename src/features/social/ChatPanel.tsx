import { Bell, ChevronLeft, ChevronRight, MoreHorizontal, Phone, Video } from 'lucide-react';
import { ConversationAvatar } from './Avatars';
import ChatComposer from './ChatComposer';
import MessageList from './MessageList';
import type { ChatMessage, Conversation, MessageFile } from './types';
type Props = {
  selected: Conversation;
  messages: ChatMessage[];
  profileName: string;
  profileAvatar?: string;
  onBack: () => void;
  onOpenProfile: (id: string) => void;
  onOpenInfo: () => void;
  onOpenNotice: () => void;
  onOpenMessage: (id: string) => void;
  onSearch: () => void;
  onCall: (type: '语音' | '视频') => void;
  onSend: (text: string, image?: string, file?: MessageFile) => boolean | void;
  reply?: string;
  onCancelReply: () => void;
};
export default function ChatPanel({
  selected,
  messages,
  profileName,
  profileAvatar,
  onBack,
  onOpenProfile,
  onOpenInfo,
  onOpenNotice,
  onOpenMessage,
  onSearch,
  onCall,
  onSend,
  reply,
  onCancelReply,
}: Props) {
  return (
    <div className="im-chat">
      <div className="im-chat-header">
        <button className="im-mobile-back" aria-label="返回会话列表" onClick={onBack}>
          <ChevronLeft size={25} />
        </button>
        <button
          className="im-chat-person"
          aria-label={`查看${selected.name}资料`}
          onClick={() => onOpenProfile(selected.id)}
        >
          <ConversationAvatar conversation={selected} />
        </button>
        <div className="im-chat-heading">
          <strong>
            {selected.name}
            {selected.kind === 'group' && <span>({(selected.members?.length || 0) + 1})</span>}
          </strong>
          <span>
            {selected.kind === 'group' ? (
              '群聊 · 让每一次交流都更近一点'
            ) : selected.kind === 'file' ? (
              '随手保存，随时找回'
            ) : (
              <>
                <i />
                在线 · 朋友
              </>
            )}
          </span>
        </div>
        <div className="im-chat-actions">
          {selected.kind !== 'file' && (
            <>
              <button aria-label="语音通话" onClick={() => onCall('语音')}>
                <Phone size={19} />
              </button>
              <button aria-label="视频通话" onClick={() => onCall('视频')}>
                <Video size={21} />
              </button>
            </>
          )}
          <button aria-label="聊天资料" onClick={onOpenInfo}>
            <MoreHorizontal size={24} />
          </button>
        </div>
      </div>
      {selected.kind === 'group' && (
        <button className="im-group-notice" onClick={onOpenNotice}>
          <Bell size={13} />
          <span>群公告：{selected.notice || '欢迎加入群聊，一起分享美好的生活。'}</span>
          <ChevronRight size={14} />
        </button>
      )}
      <MessageList
        selected={selected}
        messages={messages}
        historyQuery=""
        profileName={profileName}
        profileAvatar={profileAvatar}
        onOpenProfile={onOpenProfile}
        onOpenMessage={onOpenMessage}
      />
      <ChatComposer
        draftKey={selected.id}
        onSend={onSend}
        onCall={selected.kind === 'file' ? undefined : onCall}
        onToggleSearch={onSearch}
        reply={reply}
        onCancelReply={onCancelReply}
      />
    </div>
  );
}
