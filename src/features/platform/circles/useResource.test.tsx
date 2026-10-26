import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred } from './test-fixtures';
import { useResource } from './useResource';

afterEach(() => vi.useRealTimers());
describe('circle resource scheduling', () => {
  it('serially polls a visible request list and shows incoming results without requiring a focus change', async () => {
    vi.useFakeTimers();
    const slow = deferred<{ items: string[] }>();
    const load = vi
      .fn()
      .mockResolvedValueOnce({ items: [] })
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValue({ items: ['next-request'] });
    const view = renderHook(() => useResource('pending-requests', load));
    await act(async () => {});
    expect(view.result.current.data).toEqual({ items: [] });
    await act(async () => vi.advanceTimersByTime(20000));
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTime(60000));
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => slow.resolve({ items: ['incoming-request'] }));
    expect(view.result.current.data).toEqual({ items: ['incoming-request'] });
    await act(async () => vi.advanceTimersByTime(20000));
    expect(view.result.current.data).toEqual({ items: ['next-request'] });
    view.unmount();
    await act(async () => vi.advanceTimersByTime(60000));
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('does not let a retained replacement from a previous channel modify the current channel', async () => {
    const load = vi.fn().mockResolvedValue({ title: '频道读取' });
    const view = renderHook(({ channelId }) => useResource(channelId, load), {
      initialProps: { channelId: 'A' },
    });
    await act(async () => {});
    const old = view.result.current.replace;
    view.rerender({ channelId: 'B' });
    await act(async () => {});
    act(() => old({ title: '旧频道回执' }));
    expect(view.result.current.data).toEqual({ title: '频道读取' });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
