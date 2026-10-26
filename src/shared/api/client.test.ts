import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiQuery, apiRequest, onUnauthorized } from './client';

afterEach(() => vi.unstubAllGlobals());

describe('Go API client', () => {
  it('uses same-origin cookie credentials and encoded query values', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: { id: 'post' } }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      apiRequest('/posts', { method: 'POST', body: JSON.stringify({ body: 'hello' }) }),
    ).resolves.toEqual({ id: 'post' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/posts',
      expect.objectContaining({ credentials: 'include', method: 'POST' }),
    );
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(options.headers).get('Content-Type')).toBe('application/json');
    expect(apiQuery({ q: '设计 & Web3', offset: 0, topic: undefined })).toBe(
      '?q=%E8%AE%BE%E8%AE%A1+%26+Web3&offset=0',
    );
  });

  it('keeps server permission errors typed and invalidates only protected 401 requests', async () => {
    const listener = vi.fn();
    const stop = onUnauthorized(listener);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 'forbidden', message: '仅频道主可以发布' } }),
          { status: 403 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiRequest('/conversations/one/messages')).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      code: 'forbidden',
      message: '仅频道主可以发布',
    });
    expect(listener).not.toHaveBeenCalled();
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'unauthorized', message: '登录已失效' } }), {
          status: 401,
        }),
      ),
    );
    await expect(apiRequest('/auth/login')).rejects.toBeInstanceOf(ApiError);
    expect(listener).not.toHaveBeenCalled();
    await expect(apiRequest('/posts/one/like')).rejects.toBeInstanceOf(ApiError);
    expect(listener).toHaveBeenCalledOnce();
    stop();
  });

  it('does not turn network failures or invalid envelopes into local success', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiRequest('/posts')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
    fetchMock.mockResolvedValue(new Response('<html>proxy down</html>', { status: 502 }));
    await expect(apiRequest('/posts')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      status: 502,
    });
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    await expect(apiRequest('/posts')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    const aborted = new DOMException('Canceled', 'AbortError');
    fetchMock.mockRejectedValue(aborted);
    await expect(apiRequest('/posts')).rejects.toBe(aborted);
  });
});
