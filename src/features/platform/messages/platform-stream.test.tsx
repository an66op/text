import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePlatformStream } from './usePlatformStream';

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeSocket.instances = [];
});

describe('authenticated notification stream', () => {
  it('pulls authoritative state after reconnect and resumes only the current account event cursor', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    const callback = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ account }) => usePlatformStream(account, callback),
      { initialProps: { account: 'alice' } },
    );
    const first = FakeSocket.instances[0];
    expect(new URL(first.url).pathname).toBe('/api/v1/stream');
    expect(new URL(first.url).searchParams.get('account')).toBe('alice');
    act(() => {
      first.open();
      first.message({ type: 'ready', eventId: '42' });
      first.message({
        type: 'message.created',
        conversationId: 'private-one',
        eventId: '43',
        body: '<untrusted-not-a-message>',
      });
    });
    expect(result.current).toBe('live');
    expect(callback).toHaveBeenLastCalledWith({
      type: 'message.created',
      conversationId: 'private-one',
      eventId: '43',
    });
    act(() => first.close());
    expect(result.current).toBe('reconnecting');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    const reconnected = FakeSocket.instances[1];
    expect(new URL(reconnected.url).searchParams.get('after')).toBe('43');
    const calls = callback.mock.calls.length;
    act(() => first.message({ type: 'message.created', conversationId: 'stale', eventId: '44' }));
    expect(callback).toHaveBeenCalledTimes(calls);
    rerender({ account: 'bob' });
    const nextAccount = FakeSocket.instances[2];
    expect(new URL(nextAccount.url).searchParams.has('after')).toBe(false);
    expect(new URL(nextAccount.url).searchParams.get('account')).toBe('bob');
    act(() => reconnected.open());
    expect(result.current).toBe('connecting');
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100000);
    });
    expect(FakeSocket.instances).toHaveLength(3);
  });

  it('exposes fallback polling and offline state without faking a real-time connection', () => {
    vi.stubGlobal('WebSocket', undefined);
    const { result } = renderHook(() => usePlatformStream('alice', vi.fn()));
    expect(result.current).toBe('polling');
    act(() => window.dispatchEvent(new Event('offline')));
    expect(result.current).toBe('offline');
  });
});
