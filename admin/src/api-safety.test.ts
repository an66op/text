import { afterEach, describe, expect, it, vi } from 'vitest';
import { setExpectedAccount } from '../../src/shared/api/account-guard';
import { API_TIMEOUT_MS } from '../../src/shared/api/request-deadline';
import { api, SESSION_EXPIRED_EVENT } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setExpectedAccount('');
});

describe('operator account and transport isolation', () => {
  it('does not expire the new operator when an old request returns 401', async () => {
    let finish!: (response: Response) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const expired = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    setExpectedAccount('operator-A');
    const pending = api('/admin/users');
    setExpectedAccount('operator-B');
    finish(new Response(JSON.stringify({ error: { code: 'unauthorized' } }), { status: 401 }));
    await expect(pending).rejects.toMatchObject({ code: 'account_changed' });
    expect(expired).not.toHaveBeenCalled();
    window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  });

  it('discards a private body that completes after identity changes and guards logout writes', async () => {
    let finish!: (body: unknown) => void;
    const fetch = vi.fn().mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    vi.stubGlobal('fetch', fetch);
    setExpectedAccount('operator-A');
    const pending = api('/admin/users');
    await Promise.resolve();
    await Promise.resolve();
    setExpectedAccount('operator-B');
    finish({ data: { privateEmail: 'old-account@example.test' } });
    await expect(pending).rejects.toMatchObject({ code: 'account_changed' });
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { ok: true } })));
    await api('/auth/logout', { method: 'POST' });
    expect(new Headers(fetch.mock.calls[1][1].headers).get('X-Gongming-Account')).toBe(
      'operator-B',
    );
  });

  it('bounds a stalled write without retrying or treating its uncertain result as failure to commit', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetch);
    const pending = api('/admin/posts/one', { method: 'PATCH', body: { status: 'hidden' } }).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
    expect(await pending).toMatchObject({
      code: 'timeout',
      message: expect.stringContaining('操作可能已完成'),
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves explicit cancellation while decoding a response body', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 200, ok: true, json: () => new Promise(() => {}) }),
    );
    const pending = api('/admin/audit', { signal: controller.signal }).catch(
      (error: unknown) => error,
    );
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    expect(await pending).toMatchObject({ name: 'AbortError' });
  });
});
