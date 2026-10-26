import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, queryString, SESSION_EXPIRED_EVENT } from './api';
import { setExpectedAccount } from '../../src/shared/api/account-guard';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setExpectedAccount('');
});

describe('admin API boundary', () => {
  it('sends cookie-authenticated structured writes and unwraps only server data', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: { id: 'u1' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      api('/admin/users/u1', { method: 'PATCH', body: { role: 'moderator' } }),
    ).resolves.toEqual({ id: 'u1' });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/admin/users/u1',
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'include',
        body: '{"role":"moderator"}',
      }),
    );
    expect(new Headers(fetch.mock.calls[0][1].headers).get('Content-Type')).toBe(
      'application/json',
    );
  });

  it('expires a rejected operational session, but does not expire on a bad login', async () => {
    const listener = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, listener);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({ error: { code: 'unauthorized', message: '请重新登录' } }),
              { status: 401 },
            ),
          ),
        ),
    );
    await expect(api('/admin/users')).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
      message: '请重新登录',
    });
    expect(listener).toHaveBeenCalledTimes(1);
    await expect(
      api('/auth/login', { method: 'POST', body: { email: 'a', password: 'b' } }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(SESSION_EXPIRED_EVENT, listener);
  });

  it('preserves permission errors and never treats an invalid response as success', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: 'forbidden', message: '仅管理员可修改角色' } }),
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(new Response('<html>proxy failure</html>', { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await expect(api('/admin/users/u1', { method: 'PATCH' })).rejects.toMatchObject({
      status: 403,
      message: '仅管理员可修改角色',
    });
    await expect(api('/admin/overview')).rejects.toMatchObject({
      code: 'invalid_response',
      status: 502,
    });
    await expect(api('/admin/overview')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('retains cancellation and gives network failures a readable message', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetch);
    await expect(api('/admin/posts')).rejects.toMatchObject({ name: 'AbortError' });
    await expect(api('/admin/posts')).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining('Go API'),
    });
  });

  it('encodes untrusted search and preserves zero offsets', () => {
    expect(queryString({ q: 'a & b', status: '', offset: 0, limit: 20, role: undefined })).toBe(
      '?q=a+%26+b&offset=0&limit=20',
    );
  });
});
