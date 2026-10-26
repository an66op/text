import { afterEach, describe, expect, it, vi } from 'vitest';
import { circlesApi } from './api';
import { circle } from './test-fixtures';

afterEach(() => vi.unstubAllGlobals());
describe('circle service list contracts', () => {
  it('loads every permitted channel and passes a real invitation cursor instead of truncating management lists', async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify({ data: { items: [], total: 0 } })),
      );
    vi.stubGlobal('fetch', fetcher);
    await circlesApi.channels(circle.id);
    expect(fetcher.mock.calls[0][0]).toBe(`/api/v1/circles/${circle.id}/channels?limit=50`);
    await circlesApi.invites(circle.id, undefined, 40);
    expect(fetcher.mock.calls[1][0]).toBe(
      `/api/v1/circles/${circle.id}/invites?limit=20&offset=40`,
    );
  });
});
