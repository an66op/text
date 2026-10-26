import { afterEach, expect, it, vi } from 'vitest';
import { privacyApi } from './privacy-api';
const privacy = {
  directMessagePolicy: 'friends' as const,
  groupInvitePolicy: 'nobody' as const,
  allowFriendRequests: false,
  discoverableByHandle: false,
  revision: 3,
  updatedAt: '2026-10-27T08:00:00Z',
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('sends only the four policy fields and CAS revision, excluding server metadata or demo fields', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ data: privacy }), { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  await privacyApi.save({ ...privacy });
  expect(JSON.parse(fetcher.mock.calls[0][1].body as string)).toEqual({
    directMessagePolicy: 'friends',
    groupInvitePolicy: 'nobody',
    allowFriendRequests: false,
    discoverableByHandle: false,
    revision: 3,
  });
});
it.each([
  { ok: true, userId: 'wrong', blocked: true, revision: 4, updatedAt: null },
  { ok: true, userId: 'target', blocked: false, revision: 4, updatedAt: null },
  { ok: true, userId: 'target', blocked: true, revision: -1, updatedAt: null },
])('rejects an unconfirmed successful block receipt %#', async (data) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ data }), { status: 200 })),
  );
  await expect(privacyApi.block('target', 3)).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
    status: 200,
  });
});
it('rejects an exact block lookup containing a different target or a non-private disabled-target projection', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            items: [
              {
                userId: 'wrong',
                available: false,
                user: { id: 'wrong' },
                createdAt: '2026-10-27T08:00:00Z',
              },
            ],
            total: 1,
            revision: 3,
            updatedAt: null,
          },
        }),
        { status: 200 },
      ),
    ),
  );
  await expect(privacyApi.blocks({ userId: 'target', limit: 1 })).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
  });
});
