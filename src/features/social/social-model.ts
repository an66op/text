import { isStringArray, readStorage } from '@/shared/lib/storage';
import { contacts, initialMessages } from './fixtures';
import type { ChatMessage, Conversation, ContactNote, FriendRequest, SocialTag } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMessage(value: unknown): value is ChatMessage {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.mine === 'boolean' &&
    typeof value.time === 'string' &&
    (value.senderId === undefined || typeof value.senderId === 'string') &&
    (value.text === undefined || typeof value.text === 'string') &&
    (value.image === undefined || typeof value.image === 'string') &&
    (value.file === undefined ||
      (isRecord(value.file) &&
        typeof value.file.name === 'string' &&
        typeof value.file.content === 'string' &&
        typeof value.file.type === 'string' &&
        typeof value.file.size === 'number' &&
        Number.isFinite(value.file.size) &&
        value.file.size >= 0))
  );
}

export function isMessages(value: unknown): value is Record<string, ChatMessage[]> {
  return (
    isRecord(value) &&
    Object.values(value).every((messages) => Array.isArray(messages) && messages.every(isMessage))
  );
}

export function isConversations(value: unknown): value is Conversation[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        ['person', 'group', 'file'].includes(String(item.kind)) &&
        typeof item.preview === 'string' &&
        typeof item.time === 'string' &&
        typeof item.unread === 'number' &&
        Number.isFinite(item.unread) &&
        item.unread >= 0 &&
        (item.avatar === undefined || typeof item.avatar === 'number') &&
        (item.pinned === undefined || typeof item.pinned === 'boolean') &&
        (item.muted === undefined || typeof item.muted === 'boolean') &&
        (item.members === undefined || isStringArray(item.members)) &&
        (item.notice === undefined || typeof item.notice === 'string') &&
        (item.owner === undefined || typeof item.owner === 'string'),
    )
  );
}

export function loadMessages(): Record<string, ChatMessage[]> {
  const persisted = readStorage<Record<string, ChatMessage[]> | null>(
    'social-messages',
    null,
    (value): value is Record<string, ChatMessage[]> | null => value === null || isMessages(value),
  );
  if (persisted) return persisted;
  const legacy = readStorage<Record<string, unknown>>('messages', {}, isRecord);
  const migrated = { ...initialMessages };
  for (const contact of contacts) {
    const previous = legacy[contact.name];
    if (Array.isArray(previous)) {
      migrated[contact.id] = [
        ...(migrated[contact.id] || []),
        ...previous
          .filter((message): message is string => typeof message === 'string')
          .map((text, index) => ({
            id: `imported-${contact.id}-${index}`,
            mine: true,
            text,
            time: '此前',
          })),
      ];
    }
  }
  return migrated;
}

export function isContactNotes(value: unknown): value is Record<string, ContactNote> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (note) =>
        isRecord(note) && typeof note.alias === 'string' && typeof note.description === 'string',
    )
  );
}
export function isFriendRequests(value: unknown): value is FriendRequest[] {
  return (
    Array.isArray(value) &&
    value.every(
      (request) =>
        isRecord(request) &&
        typeof request.id === 'string' &&
        typeof request.contactId === 'string' &&
        ['incoming', 'outgoing'].includes(String(request.direction)) &&
        ['pending', 'accepted', 'rejected', 'cancelled'].includes(String(request.status)) &&
        typeof request.greeting === 'string' &&
        typeof request.date === 'string',
    )
  );
}
export function isSocialTags(value: unknown): value is SocialTag[] {
  return (
    Array.isArray(value) &&
    value.every(
      (tag) =>
        isRecord(tag) &&
        typeof tag.id === 'string' &&
        typeof tag.name === 'string' &&
        isStringArray(tag.contactIds),
    )
  );
}
