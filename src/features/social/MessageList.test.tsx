import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import MessageList from './MessageList';
import type { ChatMessage, Conversation } from './types';

const conversation: Conversation = {
  id: 'lin',
  name: '林间晚风',
  kind: 'person',
  preview: '周末一起去看海吧',
  time: '09:42',
  unread: 0,
};
const messages: ChatMessage[] = [
  { id: 'one', text: '第一条消息', mine: false, time: '09:35' },
  { id: 'two', text: '最后一条消息', mine: false, time: '09:42' },
];

function listPage(items = messages) {
  return (
    <MessageList
      selected={conversation}
      messages={items}
      historyQuery=""
      profileName="我"
      onOpenProfile={() => {}}
      onOpenMessage={() => {}}
    />
  );
}

describe('chat scroll anchoring', () => {
  let height = 600;
  let contentHeight = 1200;
  let resize: () => void;

  beforeEach(() => {
    height = 600;
    contentHeight = 1200;
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => contentHeight);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('opens at the latest message and keeps it visible as the composer expands or closes', () => {
    const { container } = render(listPage());
    const list = container.querySelector<HTMLDivElement>('.im-message-list')!;
    expect(list.scrollTop).toBe(600);

    height = 400;
    fireEvent.scroll(list);
    act(() => resize());
    expect(list.scrollTop).toBe(800);

    height = 600;
    act(() => resize());
    expect(list.scrollTop).toBe(600);
  });

  it('preserves the reading position when browsing history during a resize or incoming message', () => {
    const view = render(listPage());
    const list = view.container.querySelector<HTMLDivElement>('.im-message-list')!;
    list.scrollTop = 150;
    fireEvent.scroll(list);
    height = 400;
    act(() => resize());
    expect(list.scrollTop).toBe(150);

    contentHeight = 1350;
    view.rerender(
      listPage([...messages, { id: 'three', mine: false, text: '新消息', time: '09:43' }]),
    );
    expect(list.scrollTop).toBe(150);
  });

  it('returns to the bottom after sending a message from a historical position', () => {
    const view = render(listPage());
    const list = view.container.querySelector<HTMLDivElement>('.im-message-list')!;
    list.scrollTop = 150;
    fireEvent.scroll(list);
    contentHeight = 1300;
    view.rerender(
      listPage([...messages, { id: 'three', mine: true, text: '我发出的消息', time: '09:43' }]),
    );
    expect(list.scrollTop).toBe(700);
  });
});
