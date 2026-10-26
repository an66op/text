import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionApi } from './session-api';

afterEach(() => vi.unstubAllGlobals());
describe('session device API', () => {
  it('uses cookie-backed versioned routes, escapes IDs, and sends an explicit empty batch body', async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ data: { ok: true, current: false, revoked: 2, items: [], total: 0 } }),
            { status: 200 },
          ),
      );
    vi.stubGlobal('fetch', fetcher);
    await sessionApi.list();
    await sessionApi.revoke('legacy/session +');
    await sessionApi.revokeOthers();
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/me/sessions');
    expect(fetcher.mock.calls[1]).toEqual([
      '/api/v1/me/sessions/legacy%2Fsession%20%2B',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' }),
    ]);
    expect(fetcher.mock.calls[2]).toEqual([
      '/api/v1/me/sessions/revoke-others',
      expect.objectContaining({ method: 'POST', body: '{}', credentials: 'include' }),
    ]);
  });

  it('propagates permission failures instead of returning success', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { code: 'forbidden', message: '不能撤销这个会话' } }),
            { status: 403 },
          ),
        ),
    );
    await expect(sessionApi.revoke('other')).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
      message: '不能撤销这个会话',
    });
  });
});
