import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_TIMEOUT_MS } from '../../src/shared/api/request-deadline';
import { authContextHeaders, prepareAuthContext } from './auth-context';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('admin browser authentication context', () => {
  it('only prepares a browser CAS version without assuming an identity or caching its generation', async () => {
    let generation = 0;
    const fetcher = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: { generation: `version-${++generation}`, expiresAt: '2099-12-31T00:00:00Z' },
          }),
        ),
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    const context = await prepareAuthContext();
    expect(authContextHeaders(context)).toEqual({
      'X-Gongming-Browser': '1',
      'X-Gongming-Auth-Generation': 'version-1',
    });
    expect((await prepareAuthContext()).generation).toBe('version-2');
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/auth/context');
    const headers = new Headers(fetcher.mock.calls[0][1].headers);
    expect(headers.get('X-Gongming-Browser')).toBe('1');
    expect(headers.has('X-Gongming-Account')).toBe(false);
  });

  it.each([
    { generation: '', expiresAt: '2099-12-31T00:00:00Z' },
    { generation: 'bad\nheader', expiresAt: '2099-12-31T00:00:00Z' },
    { generation: 'old', expiresAt: '2000-01-01T00:00:00Z' },
    { generation: 'unknown', expiresAt: 'invalid' },
  ])('rejects unusable context data before an authentication write: %j', async (data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data }))));
    await expect(prepareAuthContext()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('bounds context preparation without silently falling back to legacy password auth', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetcher);
    const pending = prepareAuthContext().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
    expect(await pending).toMatchObject({ code: 'timeout' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
