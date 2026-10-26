import { useEffect, useRef, useState, type RefObject } from 'react';
import { apiErrorMessage } from '@/shared/api/client';
import { platformApi } from '@/shared/api/platformApi';
import type { PlatformMessage, ReadMark } from '@/shared/api/types';
import { messagesChanged } from './message-drafts';

export function visibleMessageWatermark(root: HTMLElement, viewportHeight: number) {
  if (document.hidden || viewportHeight <= 0 || document.querySelector('[aria-modal="true"]'))
    return null;
  const area = root.getBoundingClientRect();
  let top = Math.max(0, area.top);
  let bottom = Math.min(viewportHeight, area.bottom);
  const thread = root.closest('.platform-thread');
  for (const selector of [
    '.platform-thread-header',
    '.platform-thread-status',
    '.platform-thread-footer',
  ]) {
    const overlay = thread?.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
    if (
      !overlay ||
      overlay.height <= 0 ||
      overlay.width <= 0 ||
      overlay.right <= area.left ||
      overlay.left >= area.right
    )
      continue;
    if (overlay.bottom <= top || overlay.top >= bottom) continue;
    if (selector === '.platform-thread-footer') bottom = Math.min(bottom, overlay.top);
    else top = Math.max(top, overlay.bottom);
  }
  if (bottom <= top) return null;
  let latest: { messageId: string; seq: number } | null = null;
  for (const node of root.querySelectorAll<HTMLElement>('[data-message-id][data-message-seq]')) {
    const seq = Number(node.dataset.messageSeq);
    const rect = node.getBoundingClientRect();
    if (!Number.isSafeInteger(seq) || seq <= 0 || rect.height <= 0) continue;
    const visible = Math.min(bottom, rect.bottom) - Math.max(top, rect.top);
    if (visible >= Math.min(24, rect.height / 2) && (!latest || seq > latest.seq))
      latest = { messageId: node.dataset.messageId!, seq };
  }
  return latest;
}

export function useVisibleReadMark({
  userId,
  conversationId,
  root,
  messages,
  readSeq,
  onRead,
  updateVersion,
}: {
  userId: string;
  conversationId: string;
  root: RefObject<HTMLDivElement | null>;
  messages: PlatformMessage[];
  readSeq: number;
  onRead: (mark: ReadMark) => void;
  updateVersion: number;
}) {
  const [error, setError] = useState('');
  const acknowledged = useRef(readSeq);
  const callback = useRef(onRead);
  callback.current = onRead;
  acknowledged.current = Math.max(acknowledged.current, readSeq);
  const scanRef = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true;
    let inFlight = false;
    let pending: { messageId: string; seq: number } | null = null;
    let debounce = 0;
    let retry = 0;
    const flush = async () => {
      if (!active || inFlight || document.hidden || !pending || pending.seq <= acknowledged.current)
        return;
      inFlight = true;
      const next = pending;
      try {
        const mark = await platformApi.markConversationRead(conversationId, next.messageId);
        if (!active) return;
        acknowledged.current = Math.max(acknowledged.current, mark.readSeq);
        callback.current(mark);
        setError('');
        messagesChanged();
      } catch (caught) {
        if (active) {
          setError(`已读状态尚未同步：${apiErrorMessage(caught)}`);
          retry = window.setTimeout(() => void flush(), 5000);
        }
      } finally {
        inFlight = false;
        if (active && pending && pending.seq > next.seq) void flush();
      }
    };
    const scan = () => {
      if (!active || !root.current || document.hidden) return;
      const next = visibleMessageWatermark(
        root.current,
        window.visualViewport?.height ?? window.innerHeight,
      );
      if (next && (!pending || next.seq > pending.seq)) pending = next;
      void flush();
    };
    const schedule = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(scan, 120);
    };
    const area = root.current;
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    if (area) {
      resize?.observe(area);
      const thread = area.closest('.platform-thread');
      for (const selector of [
        '.platform-thread-header',
        '.platform-thread-status',
        '.platform-thread-footer',
      ]) {
        const overlay = thread?.querySelector<HTMLElement>(selector);
        if (overlay) resize?.observe(overlay);
      }
    }
    area?.addEventListener('scroll', schedule, { passive: true });
    document.addEventListener('visibilitychange', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('focus', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    scanRef.current = schedule;
    schedule();
    return () => {
      active = false;
      resize?.disconnect();
      window.clearTimeout(debounce);
      window.clearTimeout(retry);
      area?.removeEventListener('scroll', schedule);
      document.removeEventListener('visibilitychange', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('focus', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      scanRef.current = () => {};
    };
  }, [userId, conversationId, root]);
  useEffect(() => {
    scanRef.current();
  }, [messages, updateVersion]);
  return error;
}
