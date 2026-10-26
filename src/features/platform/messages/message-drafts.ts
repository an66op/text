import { MessageCache } from './message-cache';
import type { PlatformMessage } from '@/shared/api/types';

export type PendingMessage = { clientId: string; body: string; createdAt: string; error: string };
export type MessageDraft = { version: 1; draft: string; pending: PendingMessage[] };
export const emptyMessageDraft = (): MessageDraft => ({ version: 1, draft: '', pending: [] });
export const messageDraftKey = (userId: string, conversationId: string) =>
  `gongming-message-draft-v1:${encodeURIComponent(userId)}:${encodeURIComponent(conversationId)}`;

export function readMessageDraft(key: string): MessageDraft {
  const raw = localStorage.getItem(key);
  if (!raw) return emptyMessageDraft();
  if (raw.length > 160000) throw new Error('本机会话草稿过大，请检查本机存储');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('本机会话草稿格式损坏，原始数据已保留');
  }
  if (!validMessageDraft(value)) throw new Error('本机会话草稿格式不兼容，原始数据已保留');
  return value;
}

export function validMessageDraft(value: unknown): value is MessageDraft {
  if (
    !value ||
    typeof value !== 'object' ||
    !('version' in value) ||
    value.version !== 1 ||
    !('draft' in value) ||
    typeof value.draft !== 'string' ||
    value.draft.length > 5000 ||
    !('pending' in value) ||
    !Array.isArray(value.pending) ||
    value.pending.length > 20
  )
    return false;
  const ids = new Set<string>();
  return value.pending.every((entry: unknown) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !('clientId' in entry) ||
      typeof entry.clientId !== 'string' ||
      !/^[A-Za-z0-9_-]{8,100}$/.test(entry.clientId) ||
      ids.has(entry.clientId) ||
      !('body' in entry) ||
      typeof entry.body !== 'string' ||
      !entry.body.trim() ||
      entry.body.length > 5000 ||
      !('createdAt' in entry) ||
      typeof entry.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(entry.createdAt)) ||
      !('error' in entry) ||
      typeof entry.error !== 'string' ||
      entry.error.length > 2000
    )
      return false;
    ids.add(entry.clientId);
    return true;
  });
}

export function saveMessageDraft(key: string, value: MessageDraft) {
  if (!validMessageDraft(value)) throw new Error('草稿无法保存，请缩短消息或先处理待发消息');
  localStorage.setItem(key, JSON.stringify(value));
}

export function mergeMessages(previous: PlatformMessage[], incoming: PlatformMessage[]) {
  const cache = new MessageCache();
  cache.accept(previous);
  cache.accept(incoming);
  return cache.snapshot();
}

export function messagesChanged(detail?: {
  conversationId: string;
  retractedId?: string;
  mutationVersion?: number;
}) {
  window.dispatchEvent(new CustomEvent('gongming:conversations-changed', { detail }));
}
