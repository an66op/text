import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, onUnauthorized } from './client';
import { API_TIMEOUT_MS } from './request-deadline';
import { setExpectedAccount } from './account-guard';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setExpectedAccount('');
});

describe('bounded API requests', () => {
  it('times out a stalled transport once and ignores a late 401 without expiring a session', async () => {
    vi.useFakeTimers();
    let finish!: (value: Response) => void;
    let signal!: AbortSignal;
    const fetch = vi.fn((_path: string, options: RequestInit) => {
      signal = options.signal!;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    });
    vi.stubGlobal('fetch', fetch);
    const expired = vi.fn();
    const off = onUnauthorized(expired);
    setExpectedAccount('member-A');
    const result = apiRequest('/me/sessions').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
    expect(await result).toMatchObject({ code: 'TIMEOUT', status: 0 });
    expect(signal.aborted).toBe(true);
    finish(
      new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'late' } }), {
        status: 401,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(expired).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    off();
  });

  it('keeps the deadline running while a successful response body stalls', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 200, ok: true, json: () => new Promise(() => {}) }),
    );
    const result = apiRequest('/documents').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
    expect(await result).toMatchObject({ code: 'TIMEOUT' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels body decoding immediately instead of converting cancellation into an invalid response', async () => {
    let finish!: (value: unknown) => void;
    const parent = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      }),
    );
    const result = apiRequest('/documents', { signal: parent.signal }).catch(
      (error: unknown) => error,
    );
    await Promise.resolve();
    await Promise.resolve();
    parent.abort();
    expect(await result).toMatchObject({ name: 'AbortError' });
    finish({ data: { privateDraft: 'late private value' } });
    await Promise.resolve();
  });

  it('never dispatches an already-cancelled request and cleans up successful deadlines', async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    parent.abort();
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { ok: true } })));
    vi.stubGlobal('fetch', fetch);
    await expect(apiRequest('/health', { signal: parent.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetch).not.toHaveBeenCalled();
    await expect(apiRequest('/health')).resolves.toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('explains an uncertain write result and never automatically repeats the mutation', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetch);
    const result = apiRequest('/posts', {
      method: 'POST',
      body: JSON.stringify({ body: 'one post' }),
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
    expect(await result).toMatchObject({
      code: 'TIMEOUT',
      message: expect.stringContaining('操作可能已完成'),
    });
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
