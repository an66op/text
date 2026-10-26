import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNotificationResource } from './useNotificationResource';

type Snapshot = { body: string | null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function serialLoader() {
  const requests: (ReturnType<typeof deferred<Snapshot>> & { signal: AbortSignal })[] = [];
  let active = 0;
  let peak = 0;
  const load = vi.fn((signal: AbortSignal) => {
    const request = { ...deferred<Snapshot>(), signal };
    requests.push(request);
    active += 1;
    peak = Math.max(peak, active);
    return request.promise.finally(() => {
      active -= 1;
    });
  });
  return { load, requests, peak: () => peak };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('notification resource scheduling and ownership', () => {
  it('accepts slow reads during continuous soft invalidations and queues just one following read', async () => {
    const service = serialLoader();
    const view = renderHook(() => useNotificationResource('inbox', true, service.load));
    act(() => {
      for (let index = 0; index < 20; index += 1) view.result.current.refresh(false, false);
    });
    expect(service.load).toHaveBeenCalledTimes(1);
    expect(service.requests[0].signal.aborted).toBe(false);

    await act(async () => service.requests[0].resolve({ body: 'first snapshot' }));
    expect(view.result.current.data).toEqual({ body: 'first snapshot' });
    expect(view.result.current.loading).toBe(false);
    expect(service.load).toHaveBeenCalledTimes(2);

    act(() => {
      for (let index = 0; index < 20; index += 1) view.result.current.refresh(false, false);
    });
    expect(service.load).toHaveBeenCalledTimes(2);
    await act(async () => service.requests[1].resolve({ body: 'second snapshot' }));
    expect(view.result.current.data).toEqual({ body: 'second snapshot' });
    expect(service.load).toHaveBeenCalledTimes(3);
    await act(async () => service.requests[2].resolve({ body: 'latest snapshot' }));
    expect(view.result.current.data).toEqual({ body: 'latest snapshot' });
    expect(service.load).toHaveBeenCalledTimes(3);
    expect(service.peak()).toBe(1);
    view.unmount();
  });

  it('hard-clears private content and rejects an older successful read before fetching again', async () => {
    const service = serialLoader();
    const view = renderHook(() => useNotificationResource('private-inbox', true, service.load));
    await act(async () => service.requests[0].resolve({ body: 'private context' }));
    act(() => view.result.current.refresh(false, false));
    expect(service.load).toHaveBeenCalledTimes(2);

    act(() => view.result.current.refresh(true));
    expect(view.result.current.data).toBeNull();
    expect(view.result.current.loading).toBe(true);
    expect(service.load).toHaveBeenCalledTimes(2);
    await act(async () => service.requests[1].resolve({ body: 'late private context' }));
    expect(view.result.current.data).toBeNull();
    expect(service.load).toHaveBeenCalledTimes(3);
    await act(async () => service.requests[2].resolve({ body: null }));
    expect(view.result.current.data).toEqual({ body: null });
    expect(service.peak()).toBe(1);
    view.unmount();
  });

  it('rejects an old read and retained commits or refreshes after its account key changes', async () => {
    const first = deferred<Snapshot>();
    const second = deferred<Snapshot>();
    const signals: AbortSignal[] = [];
    const load = vi.fn((key: string, signal: AbortSignal) => {
      signals.push(signal);
      return key === 'account-A' ? first.promise : second.promise;
    });
    const view = renderHook(
      ({ account }) => useNotificationResource(account, true, (signal) => load(account, signal)),
      { initialProps: { account: 'account-A' } },
    );
    const oldCommit = view.result.current.commit;
    const oldRefresh = view.result.current.refresh;
    view.rerender({ account: 'account-B' });
    expect(signals[0].aborted).toBe(true);
    expect(view.result.current.data).toBeNull();
    const oldUpdate = vi.fn(() => ({ body: 'account-A write receipt' }));
    act(() => {
      oldCommit(oldUpdate);
      oldRefresh(true);
    });
    expect(oldUpdate).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => first.resolve({ body: 'account-A late private read' }));
    expect(view.result.current.data).toBeNull();
    await act(async () => second.resolve({ body: 'account-B snapshot' }));
    expect(view.result.current.data).toEqual({ body: 'account-B snapshot' });
    view.unmount();
  });

  it('aborts on unmount and ignores late success plus retained controls', async () => {
    vi.useFakeTimers();
    const service = serialLoader();
    const view = renderHook(() => useNotificationResource('unmounted', true, service.load));
    const { commit, refresh } = view.result.current;
    view.unmount();
    expect(service.requests[0].signal.aborted).toBe(true);
    const update = vi.fn(() => ({ body: 'late write receipt' }));
    act(() => {
      commit(update);
      refresh(true);
    });
    await act(async () => service.requests[0].resolve({ body: 'late private read' }));
    await act(async () => vi.advanceTimersByTime(60000));
    expect(update).not.toHaveBeenCalled();
    expect(service.load).toHaveBeenCalledTimes(1);
    expect(view.result.current.data).toBeNull();
  });

  it('polls visible data only after each request completes and never overlaps slow polls', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const service = serialLoader();
    const view = renderHook(() =>
      useNotificationResource('visible-inbox', true, service.load, { pollMs: 1000 }),
    );
    await act(async () => service.requests[0].resolve({ body: 'initial snapshot' }));
    await act(async () => vi.advanceTimersByTime(999));
    expect(service.load).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(service.load).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTime(5000));
    expect(service.load).toHaveBeenCalledTimes(2);
    await act(async () => service.requests[1].resolve({ body: 'incoming snapshot' }));
    expect(view.result.current.data).toEqual({ body: 'incoming snapshot' });
    await act(async () => vi.advanceTimersByTime(999));
    expect(service.load).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTime(1));
    expect(service.load).toHaveBeenCalledTimes(3);
    await act(async () => service.requests[2].resolve({ body: 'latest snapshot' }));
    expect(service.peak()).toBe(1);
    view.unmount();
  });

  it('pauses hidden polls, resumes on visibility and treats focus as a hard privacy refresh', async () => {
    vi.useFakeTimers();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const service = serialLoader();
    const view = renderHook(() =>
      useNotificationResource('focus-inbox', true, service.load, { pollMs: 1000 }),
    );
    await act(async () => service.requests[0].resolve({ body: 'private snapshot' }));
    await act(async () => vi.advanceTimersByTime(6000));
    act(() => window.dispatchEvent(new Event('focus')));
    expect(service.load).toHaveBeenCalledTimes(1);
    expect(view.result.current.data).toEqual({ body: 'private snapshot' });

    hidden.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(view.result.current.data).toBeNull();
    expect(service.load).toHaveBeenCalledTimes(2);
    act(() => window.dispatchEvent(new Event('focus')));
    expect(service.load).toHaveBeenCalledTimes(2);
    await act(async () => service.requests[1].resolve({ body: 'stale pre-focus private content' }));
    expect(view.result.current.data).toBeNull();
    expect(service.load).toHaveBeenCalledTimes(3);
    await act(async () => service.requests[2].resolve({ body: null }));
    expect(view.result.current.data).toEqual({ body: null });
    expect(service.peak()).toBe(1);
    view.unmount();
  });

  it.each([true, false])(
    'clears failed sensitive reads while retaining nonsensitive counts (sensitive=%s)',
    async (sensitive) => {
      const load = vi
        .fn()
        .mockResolvedValueOnce({ body: 'last confirmed snapshot' })
        .mockRejectedValueOnce(new Error('read failed'));
      const view = renderHook(() =>
        useNotificationResource('read-error', true, load, { sensitive }),
      );
      await act(async () => {});
      act(() => view.result.current.refresh(false, false));
      await act(async () => {});
      expect(view.result.current.data).toEqual(
        sensitive ? null : { body: 'last confirmed snapshot' },
      );
      expect(view.result.current.error).toBe('read failed');
      view.unmount();
    },
  );
});
