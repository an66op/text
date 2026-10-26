import { useEffect, useRef, useState } from 'react';
import { messagesChanged } from './message-drafts';

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'polling' | 'offline';
export type StreamEvent = {
  type: string;
  conversationId?: string;
  messageId?: string;
  eventId?: string;
};

export function usePlatformStream(userId: string, onEvent: (event: StreamEvent) => void) {
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const callback = useRef(onEvent);
  callback.current = onEvent;
  useEffect(() => {
    let active = true;
    let online = navigator.onLine;
    let socket: WebSocket | null = null;
    let timer = 0;
    let openingTimer = 0;
    let attempt = 0;
    let cursor = '';
    let notificationTimer = 0;
    const notify = (event: StreamEvent) => {
      callback.current(event);
      window.clearTimeout(notificationTimer);
      notificationTimer = window.setTimeout(messagesChanged, 60);
    };
    const connect = () => {
      if (!active || !online) {
        if (active) setStatus('offline');
        return;
      }
      if (typeof WebSocket !== 'function') {
        setStatus('polling');
        return;
      }
      setStatus(attempt ? 'reconnecting' : 'connecting');
      const url = new URL('/api/v1/stream', window.location.href);
      url.searchParams.set('account', userId);
      url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      if (cursor) url.searchParams.set('after', cursor);
      try {
        socket = new WebSocket(url.href);
      } catch {
        setStatus('polling');
        timer = window.setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)));
        return;
      }
      const current = socket;
      openingTimer = window.setTimeout(() => {
        if (active && socket === current && current.readyState !== WebSocket.OPEN) {
          setStatus('reconnecting');
          current.close();
        }
      }, 10000);
      current.onopen = () => {
        if (!active || socket !== current) return;
        window.clearTimeout(openingTimer);
        attempt = 0;
        setStatus('live');
        notify({ type: 'resync' });
      };
      current.onmessage = (message) => {
        if (!active || socket !== current || typeof message.data !== 'string') return;
        try {
          const data: unknown = JSON.parse(message.data);
          if (
            !data ||
            typeof data !== 'object' ||
            !('type' in data) ||
            typeof data.type !== 'string'
          )
            return;
          const event: StreamEvent = { type: data.type };
          if (
            'eventId' in data &&
            (typeof data.eventId === 'string' || typeof data.eventId === 'number')
          ) {
            const nextCursor = String(data.eventId);
            if (/^[A-Za-z0-9_-]{1,100}$/.test(nextCursor)) {
              cursor = nextCursor;
              event.eventId = cursor;
            }
          }
          if (
            'conversationId' in data &&
            typeof data.conversationId === 'string' &&
            data.conversationId.length <= 200
          )
            event.conversationId = data.conversationId;
          if (
            'messageId' in data &&
            typeof data.messageId === 'string' &&
            data.messageId.length <= 200
          )
            event.messageId = data.messageId;
          notify(event);
        } catch {
          /* Malformed notifications never become message content. */
        }
      };
      current.onerror = () => {
        if (active && socket === current) setStatus(online ? 'reconnecting' : 'offline');
      };
      current.onclose = () => {
        if (!active || socket !== current) return;
        window.clearTimeout(openingTimer);
        socket = null;
        setStatus(online ? 'reconnecting' : 'offline');
        if (online)
          timer = window.setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)));
      };
    };
    const offline = () => {
      online = false;
      setStatus('offline');
      window.clearTimeout(timer);
      window.clearTimeout(openingTimer);
      socket?.close();
    };
    const reconnect = () => {
      online = true;
      window.clearTimeout(timer);
      if (
        socket &&
        (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
      )
        return;
      connect();
      notify({ type: 'resync' });
    };
    window.addEventListener('offline', offline);
    window.addEventListener('online', reconnect);
    connect();
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.clearTimeout(openingTimer);
      window.clearTimeout(notificationTimer);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', reconnect);
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
    };
  }, [userId]);
  return status;
}
