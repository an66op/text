import { useEffect, useLayoutEffect, useRef } from 'react';
import { FileText, Search } from 'lucide-react';
import { findContact } from './useSocialActions';
import { PersonAvatar, ConversationAvatar } from './Avatars';
import type { ChatMessage, Conversation } from './types';

type Props = {
  selected: Conversation;
  messages: ChatMessage[];
  historyQuery: string;
  profileName: string;
  profileAvatar?: string;
  onOpenProfile: (id: string) => void;
  onOpenMessage: (id: string) => void;
};
export default function MessageList({
  selected,
  messages,
  historyQuery,
  profileName,
  profileAvatar,
  onOpenProfile,
  onOpenMessage,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followsBottom = useRef(true);
  const measuredHeight = useRef(0);
  const previousConversation = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    const list = scrollRef.current;
    if (!list) return;
    if (
      previousConversation.current !== selected.id ||
      followsBottom.current ||
      messages.at(-1)?.mine
    ) {
      list.scrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
      followsBottom.current = true;
    }
    previousConversation.current = selected.id;
    measuredHeight.current = list.clientHeight;
  }, [selected.id, messages]);

  useEffect(() => {
    const list = scrollRef.current;
    if (!list) return;
    const rememberPosition = () => {
      // A composer resize can emit a scroll event before ResizeObserver runs.
      if (list.clientHeight !== measuredHeight.current) return;
      followsBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight <= 64;
    };
    list.addEventListener('scroll', rememberPosition, { passive: true });
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => {
            if (followsBottom.current) {
              list.scrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
            }
            measuredHeight.current = list.clientHeight;
          });
    observer?.observe(list);
    return () => {
      list.removeEventListener('scroll', rememberPosition);
      observer?.disconnect();
    };
  }, []);
  return (
    <div className="im-message-list" ref={scrollRef}>
      <div className="im-day-label">今天</div>
      {messages
        .filter((message) => !historyQuery || message.text?.includes(historyQuery))
        .map((message, index) => (
          <div key={message.id} className={`im-message ${message.mine ? 'im-message-mine' : ''}`}>
            {message.mine ? (
              <PersonAvatar avatar={49} image={profileAvatar} name={profileName} />
            ) : (
              <button
                className="im-message-avatar-button"
                aria-label={`查看${findContact(message.senderId)?.name || selected.name}资料`}
                onClick={() => onOpenProfile(message.senderId || selected.id)}
              >
                {selected.kind === 'group' && message.senderId ? (
                  <PersonAvatar
                    avatar={findContact(message.senderId)?.avatar}
                    name={findContact(message.senderId)?.name || '朋友'}
                  />
                ) : (
                  <ConversationAvatar conversation={selected} />
                )}
              </button>
            )}
            <div className="im-message-main">
              {selected.kind === 'group' && !message.mine && (
                <span className="im-message-sender">
                  {findContact(message.senderId)?.name || (index === 0 ? '群助手' : '朋友')}
                </span>
              )}
              {message.image ? (
                <button
                  className="im-message-image"
                  onClick={() => onOpenMessage(message.id)}
                  aria-label="查看完整图片"
                >
                  <img src={message.image} alt="聊天分享的图片" />
                </button>
              ) : message.file ? (
                <button
                  className="im-bubble im-file-bubble"
                  onClick={() => onOpenMessage(message.id)}
                  aria-label={`查看文件${message.file.name}`}
                >
                  <FileText size={30} />
                  <span>
                    <strong>{message.file.name}</strong>
                    <small>
                      {message.file.size < 1024
                        ? `${message.file.size} B`
                        : `${(message.file.size / 1024).toFixed(1)} KB`}
                    </small>
                  </span>
                </button>
              ) : (
                <button
                  className="im-bubble"
                  onClick={() => onOpenMessage(message.id)}
                  aria-label={`查看消息：${message.text || '空消息'}`}
                >
                  {message.text}
                </button>
              )}
              <time>{message.time}</time>
            </div>
          </div>
        ))}
      {historyQuery && !messages.some((message) => message.text?.includes(historyQuery)) && (
        <div className="im-empty">
          <Search size={25} />
          <p>没有找到相关消息</p>
        </div>
      )}
    </div>
  );
}
