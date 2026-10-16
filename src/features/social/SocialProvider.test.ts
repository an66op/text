import { beforeEach, describe, expect, it } from 'vitest';
import { initialConversations, initialMessages } from './fixtures';
import {
  isConversations,
  isMessages,
  loadMessages,
  isSocialTags,
  isFriendRequests,
  isContactNotes,
} from './social-model';

describe('social persistence and legacy migration', () => {
  beforeEach(() => localStorage.clear());

  it('keeps already persisted messages instead of importing legacy messages twice', () => {
    const stored = { lin: [{ id: 'saved', mine: true, text: '已保存', time: '12:00' }] };
    localStorage.setItem('social-messages', JSON.stringify(stored));
    localStorage.setItem('messages', JSON.stringify({ 林间晚风: ['旧消息'] }));
    expect(loadMessages()).toEqual(stored);
  });

  it('imports valid legacy text using stable contact IDs and drops invalid entries', () => {
    localStorage.setItem(
      'messages',
      JSON.stringify({ 林间晚风: ['旧消息', null, 42], Mia: ['咖啡见'] }),
    );
    const messages = loadMessages();
    expect(messages.lin.at(-1)).toMatchObject({ id: 'imported-lin-0', mine: true, text: '旧消息' });
    expect(messages.lin).toHaveLength(initialMessages.lin.length + 1);
    expect(messages.mia.at(-1)?.text).toBe('咖啡见');
  });

  it('recovers mock conversations/messages after damaged or wrongly shaped storage', () => {
    localStorage.setItem('social-messages', JSON.stringify({ lin: 'invalid' }));
    localStorage.setItem('messages', 'broken json');
    expect(loadMessages()).toEqual(initialMessages);
    expect(isConversations(initialConversations)).toBe(true);
    expect(isConversations([{ ...initialConversations[0], unread: '2' }])).toBe(false);
    expect(isMessages({ lin: [{ id: 'x', mine: 'yes', time: '12:00' }] })).toBe(false);
  });
  it('validates routed workflow records and rejects malformed contacts, tags and attachment payloads', () => {
    expect(isSocialTags([{ id: 'a', name: '摄影', contactIds: ['lin'] }])).toBe(true);
    expect(isSocialTags([{ id: 'a', name: '摄影', contactIds: [42] }])).toBe(false);
    expect(isContactNotes({ lin: { alias: '朋友', description: '备注' } })).toBe(true);
    expect(isContactNotes({ lin: { alias: false, description: '备注' } })).toBe(false);
    expect(
      isFriendRequests([
        {
          id: 'a',
          contactId: 'lin',
          direction: 'incoming',
          greeting: '你好',
          status: 'pending',
          date: '今天',
        },
      ]),
    ).toBe(true);
    expect(
      isFriendRequests([
        {
          id: 'a',
          contactId: 'lin',
          direction: 'incoming',
          greeting: '你好',
          status: 'done',
          date: '今天',
        },
      ]),
    ).toBe(false);
    expect(
      isMessages({
        lin: [
          {
            id: 'a',
            mine: true,
            time: '现在',
            file: { name: 'a.txt', type: 'text/plain', content: '你好', size: -1 },
          },
        ],
      }),
    ).toBe(false);
  });
});
