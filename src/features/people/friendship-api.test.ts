import { afterEach, describe, expect, it, vi } from 'vitest';
import { friendshipApi } from './friendship-api';

afterEach(() => vi.unstubAllGlobals());
describe('friendship HTTP boundaries', () => {
  it('encodes user and request IDs and keeps pagination and explicit actions in the contract', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ data: { items: [], total: 0 } }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetch);
    await friendshipApi.friends('昵称 & 名字', 30);
    expect(fetch.mock.calls[0][0]).toBe(
      '/api/v1/friends?q=%E6%98%B5%E7%A7%B0+%26+%E5%90%8D%E5%AD%97&limit=30&offset=30',
    );
    await friendshipApi.respond('request/one', 'cancel');
    expect(fetch.mock.calls[1][0]).toBe('/api/v1/friend-requests/request%2Fone/respond');
    expect(fetch.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ action: 'cancel' }),
    });
    await friendshipApi.remove('user/one');
    expect(fetch.mock.calls[2][0]).toBe('/api/v1/friends/user%2Fone');
    expect(fetch.mock.calls[2][1]).toMatchObject({ method: 'DELETE' });
  });
  it('surfaces permission and conflict errors without fabricating a friendship', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: 'forbidden', message: '只有收到申请的成员才能接受' },
            }),
            { status: 403 },
          ),
      ),
    );
    await expect(friendshipApi.respond('request-one', 'accept')).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
      message: '只有收到申请的成员才能接受',
    });
  });
});
