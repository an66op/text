import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import { paths } from '@/shared/config/paths';
import { readStorage, isStringArray } from '@/shared/lib/storage';
import { useToast } from '@/shared/ui/useToast';
import { socialPaths } from './routes';
import { useSocialStore } from './useSocialStore';
import SocialOverview from './SocialOverview';
import ChatPanel from './ChatPanel';
import ContactWelcome from './ContactWelcome';
import { SocialChannelWelcome } from './SocialChannelList';
import ChannelTimeline from './ChannelTimeline';
import type { ChatMessage, MessageFile, Props, SocialAction } from './types';

export default function SocialHub(props: Props) {
  const { conversationId, channelId } = useParams();
  return (
    <SocialScreen
      key={JSON.stringify([props.initialView, conversationId, channelId])}
      {...props}
      conversationId={conversationId}
      channelId={channelId}
    />
  );
}
function SocialScreen({
  initialView = '消息',
  onOpenModule,
  profileName,
  profileAvatar,
  conversationId,
  channelId,
}: Props & { conversationId?: string; channelId?: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const messageType = new URLSearchParams(location.search).get('type');
  const showChannels = !!channelId || (!conversationId && messageType === 'channels');
  const notify = useToast();
  const { conversations, setConversations, messages, setMessages, accepted, unread } =
    useSocialStore();
  const [reply, setReply] = useState(
    () => (location.state as { replyText?: string } | null)?.replyText || '',
  );
  const selected = conversationId
    ? conversations.find((conversation) => conversation.id === conversationId)
    : messageType === 'groups'
      ? conversations.find((conversation) => conversation.kind === 'group')
      : conversations.find((conversation) => conversation.id === 'lin') || conversations[0];
  const activeMessages: ChatMessage[] = selected
    ? messages[selected.id] || [
        {
          id: 'welcome',
          mine: false,
          text:
            selected.kind === 'group'
              ? '欢迎加入群聊，和大家打个招呼吧！'
              : '我们已经是好友啦，开始聊天吧。',
          time: selected.time || '09:00',
        },
      ]
    : [];
  useEffect(() => {
    if (conversationId)
      setConversations((current) =>
        current.some(
          (conversation) => conversation.id === conversationId && conversation.unread > 0,
        )
          ? current.map((conversation) =>
              conversation.id === conversationId ? { ...conversation, unread: 0 } : conversation,
            )
          : current,
      );
  }, [conversationId, setConversations]);
  useEffect(() => {
    if (!conversationId || !selected) return;
    const id = selected.id;
    setMessages((current) =>
      current[id]
        ? current
        : {
            ...current,
            [id]: [
              {
                id: 'welcome',
                mine: false,
                text:
                  selected.kind === 'group'
                    ? '欢迎加入群聊，和大家打个招呼吧！'
                    : '我们已经是好友啦，开始聊天吧。',
                time: selected.time || '09:00',
              },
            ],
          },
    );
  }, [conversationId, selected, setMessages]);
  function openAction(action: SocialAction) {
    const routes = {
      group: socialPaths.groupCreate,
      friend: socialPaths.friendSearch,
      newFriends: socialPaths.friendRequests,
      groups: socialPaths.groups,
      tags: socialPaths.tags,
    };
    navigate(routes[action]);
  }
  function openProfile(id: string) {
    const conversation = conversations.find((item) => item.id === id);
    navigate(
      conversation && conversation.kind !== 'person'
        ? socialPaths.chatInfo(id)
        : socialPaths.contact(id),
    );
  }
  function send(text: string, image?: string, file?: MessageFile) {
    if ((!text.trim() && !image && !file) || !selected) return false;
    if (readStorage('profile-blocked-contacts', [], isStringArray).includes(selected.id)) {
      notify('该联系人在黑名单中，请先解除拉黑');
      return false;
    }
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const content = reply ? `「引用：${reply}」\n${text.trim()}` : text.trim();
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      mine: true,
      ...(content ? { text: content } : {}),
      ...(image ? { image } : {}),
      ...(file ? { file } : {}),
      time,
    };
    setMessages((current) => ({
      ...current,
      [selected.id]: [...(current[selected.id] || activeMessages), message],
    }));
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === selected.id
          ? {
              ...conversation,
              preview: image ? '[图片]' : file ? `[文件] ${file.name}` : text.trim(),
              time,
              unread: 0,
            }
          : conversation,
      ),
    );
    setReply('');
    if (location.state) navigate(location.pathname, { replace: true, state: null });
    return true;
  }
  if (conversationId && !selected)
    return (
      <section className="im-root">
        <div className="im-empty">
          <MessageCircle size={36} />
          <h2>会话不存在</h2>
          <p>这段会话可能已删除，或尚未保存到当前设备。</p>
          <button className="im-primary" onClick={() => navigate(paths.social)}>
            <ArrowLeft size={18} />
            返回会话列表
          </button>
        </div>
      </section>
    );
  return (
    <section
      className={`im-root ${(conversationId || channelId) && initialView === '消息' ? 'im-chat-open' : ''} ${channelId ? 'tg-channel-open' : ''}`}
    >
      <SocialOverview
        view={initialView}
        unread={unread}
        conversations={conversations}
        selectedId={selected?.id || ''}
        selectedChannelId={channelId}
        accepted={accepted}
        onAction={openAction}
        onOpenModule={onOpenModule}
        onOpenConversation={(id) => navigate(paths.chat(id))}
        onOpenProfile={openProfile}
        onMarkRead={() => {
          setConversations((current) =>
            current.map((conversation) => ({ ...conversation, unread: 0 })),
          );
          notify('所有消息已标为已读');
        }}
      />
      {initialView === '消息' &&
        showChannels &&
        (channelId ? (
          <ChannelTimeline channelId={channelId} profileName={profileName} />
        ) : (
          <SocialChannelWelcome />
        ))}
      {initialView === '消息' && selected && !showChannels && (
        <ChatPanel
          key={selected.id}
          selected={selected}
          messages={activeMessages}
          profileName={profileName}
          profileAvatar={profileAvatar}
          onBack={() => navigate(paths.social)}
          onOpenProfile={openProfile}
          onOpenInfo={() => navigate(socialPaths.chatInfo(selected.id))}
          onOpenNotice={() => navigate(socialPaths.groupNotice(selected.id))}
          onOpenMessage={(id) => navigate(socialPaths.message(selected.id, id))}
          onSearch={() => navigate(socialPaths.chatSearch(selected.id))}
          onCall={(type) =>
            navigate(socialPaths.call(selected.id, type === '语音' ? 'voice' : 'video'))
          }
          onSend={send}
          reply={reply}
          onCancelReply={() => setReply('')}
        />
      )}
      {initialView === '通讯录' && (
        <ContactWelcome
          groups={conversations.filter((conversation) => conversation.kind === 'group').length}
          onAddFriend={() => navigate(socialPaths.friendSearch)}
        />
      )}
    </section>
  );
}
