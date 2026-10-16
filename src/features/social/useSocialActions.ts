import { useNavigate } from 'react-router';
import { paths } from '@/shared/config/paths';
import { contacts, suggestedContacts } from './fixtures';
import { useSocialStore } from './useSocialStore';
import type { Contact, ChatMessage } from './types';

export const allContacts = [...contacts, ...suggestedContacts];
export const findContact = (id?: string) => allContacts.find((contact) => contact.id === id);
export const messageTime = () =>
  new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
export function useSocialActions() {
  const store = useSocialStore();
  const navigate = useNavigate();
  const friends = allContacts
    .filter(
      (contact) =>
        contacts.some((friend) => friend.id === contact.id) || store.accepted.includes(contact.id),
    )
    .sort((a, b) => a.letter.localeCompare(b.letter));
  function ensureConversation(contact: Contact) {
    store.setConversations((current) =>
      current.some((conversation) => conversation.id === contact.id)
        ? current
        : [
            ...current,
            {
              id: contact.id,
              name: store.notes[contact.id]?.alias || contact.name,
              avatar: contact.avatar,
              kind: 'person',
              preview: '我们已经是好友啦，开始聊天吧。',
              time: '刚刚',
              unread: 0,
            },
          ],
    );
  }
  function startChat(contact: Contact) {
    ensureConversation(contact);
    navigate(paths.chat(contact.id));
  }
  function appendMessage(conversationId: string, text: string, extra: Partial<ChatMessage> = {}) {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      mine: true,
      text,
      time: messageTime(),
      ...extra,
    };
    store.setMessages((current) => ({
      ...current,
      [conversationId]: [...(current[conversationId] || []), message],
    }));
    store.setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              preview: extra.image ? '[图片]' : extra.file ? `[文件] ${extra.file.name}` : text,
              time: message.time,
            }
          : conversation,
      ),
    );
  }
  return { ...store, friends, ensureConversation, startChat, appendMessage };
}
