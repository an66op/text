import { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { platformApi } from '@/shared/api/platformApi';
import type { ReadMark } from '@/shared/api/types';
import { useVisibleReadMark, visibleMessageWatermark } from './useVisibleReadMark';

const rect = (top: number, bottom: number) => ({
  top,
  bottom,
  height: bottom - top,
  width: 300,
  left: 0,
  right: 300,
  x: 0,
  y: top,
  toJSON: () => ({}),
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('visible message read watermarks', () => {
  it('excludes messages covered by floating headers, connection status, and a dynamically taller footer', () => {
    const thread = document.createElement('div');
    thread.className = 'platform-thread';
    const header = document.createElement('header');
    header.className = 'platform-thread-header';
    const status = document.createElement('div');
    status.className = 'platform-thread-status';
    const root = document.createElement('div');
    const footer = document.createElement('div');
    footer.className = 'platform-thread-footer';
    thread.append(header, status, root, footer);
    document.body.append(thread);
    header.getBoundingClientRect = () => rect(0, 52);
    status.getBoundingClientRect = () => rect(52, 74);
    root.getBoundingClientRect = () => rect(0, 600);
    footer.getBoundingClientRect = () => rect(520, 600);
    for (const [seq, top, bottom] of [
      [1, 30, 70],
      [2, 74, 115],
      [3, 510, 550],
      [4, 550, 590],
    ]) {
      const node = document.createElement('article');
      node.dataset.messageId = `message-${seq}`;
      node.dataset.messageSeq = String(seq);
      node.getBoundingClientRect = () => rect(top, bottom);
      root.append(node);
    }
    expect(visibleMessageWatermark(root, 800)).toEqual({ messageId: 'message-2', seq: 2 });
    footer.getBoundingClientRect = () => rect(90, 600);
    expect(visibleMessageWatermark(root, 800)).toBeNull();
    // Flow headers outside a desktop scroll pane do not reduce its readable area.
    root.getBoundingClientRect = () => rect(80, 600);
    footer.getBoundingClientRect = () => rect(610, 680);
    expect(visibleMessageWatermark(root, 800)).toEqual({ messageId: 'message-4', seq: 4 });
    thread.remove();
  });
  it('uses the latest sufficiently visible message, rather than the latest fetched message', () => {
    const root = document.createElement('div');
    document.body.append(root);
    root.getBoundingClientRect = () => rect(100, 400);
    for (const [seq, top, bottom] of [
      [1, 50, 120],
      [2, 120, 180],
      [3, 390, 450],
      [4, 460, 520],
    ]) {
      const element = document.createElement('article');
      element.dataset.messageId = `message-${seq}`;
      element.dataset.messageSeq = String(seq);
      element.getBoundingClientRect = () => rect(top, bottom);
      root.append(element);
    }
    expect(visibleMessageWatermark(root, 800)).toEqual({ messageId: 'message-2', seq: 2 });
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.append(dialog);
    expect(visibleMessageWatermark(root, 800)).toBeNull();
    dialog.remove();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    expect(visibleMessageWatermark(root, 800)).toBeNull();
    root.remove();
  });

  it('does not mark loaded but invisible messages, serializes visible progress, and ignores unmounted responses', async () => {
    vi.useFakeTimers();
    let finish!: (value: ReadMark) => void;
    const mark = vi.spyOn(platformApi, 'markConversationRead').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const onRead = vi.fn();
    function Probe() {
      const root = useRef<HTMLDivElement>(null);
      useVisibleReadMark({
        userId: 'account-a',
        conversationId: 'conversation-one',
        root,
        messages: [],
        readSeq: 0,
        onRead,
        updateVersion: 0,
      });
      return (
        <div ref={root} data-testid="viewport">
          <article data-message-id="message-one" data-message-seq="1" />
          <article data-message-id="message-two" data-message-seq="2" />
        </div>
      );
    }
    const view = render(<Probe />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(mark).not.toHaveBeenCalled();
    const root = screen.getByTestId('viewport');
    const nodes = root.querySelectorAll('article');
    root.getBoundingClientRect = () => rect(100, 400);
    nodes[0].getBoundingClientRect = () => rect(120, 180);
    nodes[1].getBoundingClientRect = () => rect(450, 500);
    fireEvent.scroll(root);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(mark).toHaveBeenCalledExactlyOnceWith('conversation-one', 'message-one');
    nodes[1].getBoundingClientRect = () => rect(250, 300);
    fireEvent.scroll(root);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(mark).toHaveBeenCalledOnce();
    await act(async () => {
      finish({
        conversationId: 'conversation-one',
        lastReadMessageId: 'message-one',
        readSeq: 1,
        unreadCount: 1,
      });
    });
    expect(mark).toHaveBeenLastCalledWith('conversation-one', 'message-two');
    expect(mark).toHaveBeenCalledTimes(2);
    expect(onRead).toHaveBeenCalledOnce();
    view.unmount();
    await act(async () => {
      finish({
        conversationId: 'conversation-one',
        lastReadMessageId: 'message-two',
        readSeq: 2,
        unreadCount: 0,
      });
    });
    expect(onRead).toHaveBeenCalledOnce();
  });
});
