import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { member } from '../platform-test-fixtures';
import { sessionApi } from './session-api';
import type { SessionDevices } from './session-types';
import { useSessionDevices } from './useSessionDevices';

class DeviceChannel {
  static instances: DeviceChannel[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();
  constructor(public name: string) {
    DeviceChannel.instances.push(this);
  }
  message(userId: string) {
    this.onmessage?.({ data: { type: 'devices.changed', userId } } as MessageEvent<unknown>);
  }
}
const deferred = () => {
  let resolve!: (value: SessionDevices) => void;
  const promise = new Promise<SessionDevices>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  DeviceChannel.instances = [];
});
describe('login device reconciliation', () => {
  it('serializes focus, same-account cross-window updates and visible polling without discarding completed reads', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('BroadcastChannel', DeviceChannel);
    const first = deferred();
    const second = deferred();
    const third = deferred();
    const list = vi
      .spyOn(sessionApi, 'list')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    const { result, unmount } = renderHook(() => useSessionDevices(member.id, vi.fn()));
    const channel = DeviceChannel.instances[0];
    act(() => {
      window.dispatchEvent(new Event('focus'));
      channel.message(member.id);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(list).toHaveBeenCalledOnce();
    await act(async () => first.resolve({ items: [], total: 0 }));
    expect(result.current.loading).toBe(false);
    expect(list).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve({ items: [], total: 0 }));
    act(() => channel.message('different-account'));
    expect(list).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(list).toHaveBeenCalledTimes(3);
    const signal = list.mock.calls[2][0]!;
    unmount();
    expect(signal.aborted).toBe(true);
    expect(channel.close).toHaveBeenCalledOnce();
  });

  it('suspends polling while hidden and rechecks when the page becomes visible', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('BroadcastChannel', undefined);
    const list = vi.spyOn(sessionApi, 'list').mockResolvedValue({ items: [], total: 0 });
    renderHook(() => useSessionDevices(member.id, vi.fn()));
    await act(async () => {});
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(list).toHaveBeenCalledOnce();
    hidden.mockReturnValue(false);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(list).toHaveBeenCalledTimes(2);
  });
});
