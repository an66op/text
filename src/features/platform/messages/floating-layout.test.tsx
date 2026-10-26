import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { platformApi } from '@/shared/api/platformApi';
import type { Conversation, MessagePage, PlatformMessage } from '@/shared/api/types';
import { AuthContext } from '../auth-context';
import { member, otherMember, signedIn } from '../platform-test-fixtures';
import MessageThread from './MessageThread';
import { conversationApi } from '../conversations/conversation-api';

class LayoutObserver {
  static instances: LayoutObserver[] = [];
  constructor(public callback: () => void) {
    LayoutObserver.instances.push(this);
  }
  observe() {}
  disconnect() {}
}
const rect = (top: number, bottom: number) => ({
  top,
  bottom,
  height: bottom - top,
  width: 390,
  left: 0,
  right: 390,
  x: 0,
  y: top,
  toJSON: () => ({}),
});
const conversation: Conversation = {
  id: 'conversation-layout',
  title: '布局对话',
  kind: 'direct',
  members: [member.id, otherMember.id],
  ownerId: member.id,
  canSend: true,
  createdAt: '2026-10-27T08:00:00Z',
};
const message = (seq: number): PlatformMessage => ({
  id: `message-${seq}`,
  seq,
  conversationId: conversation.id,
  sender: otherMember,
  body: `消息 ${seq}`,
  createdAt: '2026-10-27T08:00:00Z',
});
const view = () =>
  render(
    <MemoryRouter>
      <AuthContext.Provider value={signedIn()}>
        <MessageThread
          conversation={conversation}
          onBack={vi.fn()}
          onSent={vi.fn()}
          onRead={vi.fn()}
          updateVersion={0}
          streamStatus="polling"
        />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
beforeEach(() => {
  vi.spyOn(conversationApi, 'details').mockResolvedValue({
    conversation,
    memberProfiles: [member, otherMember],
  });
  localStorage.clear();
  vi.stubGlobal('ResizeObserver', LayoutObserver);
  vi.spyOn(platformApi, 'messages').mockResolvedValue({
    items: [message(3), message(4)],
    total: 4,
    hasMore: true,
  });
  vi.spyOn(platformApi, 'markConversationRead').mockResolvedValue({
    conversationId: conversation.id,
    readSeq: 4,
    lastReadMessageId: 'message-4',
    unreadCount: 0,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  LayoutObserver.instances = [];
});

describe('floating message chrome measurements', () => {
  it('reserves the actual tall error footer and keeps following the latest content within the scroller', async () => {
    view();
    await screen.findByText('消息 4');
    const thread = document.querySelector<HTMLElement>('.platform-thread')!;
    const scroll = document.querySelector<HTMLElement>('.platform-thread-messages')!;
    const footer = document.querySelector<HTMLElement>('.platform-thread-footer')!;
    const header = document.querySelector<HTMLElement>('.platform-thread-header')!;
    const status = document.querySelector<HTMLElement>('.platform-thread-status')!;
    let footerHeight = 70;
    header.getBoundingClientRect = () => rect(0, 52);
    status.getBoundingClientRect = () => rect(52, 72);
    footer.getBoundingClientRect = () => rect(844 - footerHeight, 844);
    Object.defineProperty(scroll, 'scrollHeight', {
      configurable: true,
      get: () => 1000 + footerHeight,
    });
    act(() => LayoutObserver.instances.forEach((observer) => observer.callback()));
    expect(thread.style.getPropertyValue('--thread-footer-height')).toBe('70px');
    expect(scroll.scrollTop).toBe(1070);
    footerHeight = 294;
    act(() => LayoutObserver.instances.forEach((observer) => observer.callback()));
    expect(thread.style.getPropertyValue('--thread-footer-height')).toBe('294px');
    expect(thread.style.getPropertyValue('--thread-header-height')).toBe('52px');
    expect(thread.style.getPropertyValue('--thread-status-height')).toBe('20px');
    expect(scroll.scrollTop).toBe(1294);
    expect(screen.getByRole('textbox', { name: '服务器消息内容' }).tagName).toBe('INPUT');
  });

  it('keeps the same visible history anchor when earlier messages arrive while the floating footer changes height', async () => {
    view();
    await screen.findByText('消息 4');
    const scroll = document.querySelector<HTMLElement>('.platform-thread-messages')!;
    const footer = document.querySelector<HTMLElement>('.platform-thread-footer')!;
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 1200 });
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 600 });
    scroll.scrollTop = 200;
    scroll.getBoundingClientRect = () => rect(0, 600);
    let olderAdded = false;
    const anchor = document.querySelector<HTMLElement>('[data-message-id="message-3"]')!;
    anchor.getBoundingClientRect = () =>
      rect(
        (olderAdded ? 200 : 50) - (scroll.scrollTop - 200),
        (olderAdded ? 260 : 110) - (scroll.scrollTop - 200),
      );
    fireEvent.scroll(scroll);
    let finish!: (value: MessagePage) => void;
    vi.mocked(platformApi.messages).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: '加载更早消息' }));
    footer.getBoundingClientRect = () => rect(400, 600);
    act(() => LayoutObserver.instances.forEach((observer) => observer.callback()));
    expect(scroll.scrollTop).toBe(200);
    await act(async () => {
      olderAdded = true;
      finish({ items: [message(1), message(2)], total: 4, hasMore: false });
    });
    expect(scroll.scrollTop).toBe(350);
    expect(anchor.getBoundingClientRect().top).toBe(50);
  });
});
