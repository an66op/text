import { afterEach, describe, expect, it, vi } from 'vitest';
import { notificationsApi } from './api';

afterEach(() => vi.unstubAllGlobals());

function mockResponse(data: unknown) {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data })));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

describe('notification service requests', () => {
  it('sends filters and pagination only to the same-origin notification service', async () => {
    const data = { items: [], total: 0, unreadTotal: 2, throughId: null };
    const fetcher = mockResponse(data);
    expect(
      await notificationsApi.list({ category: 'requests', unread: true, limit: 20, offset: 40 }),
    ).toEqual(data);
    const [path, options] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/v1/notifications?category=requests&unread=true&limit=20&offset=40');
    expect(options.credentials).toBe('include');
    expect(options.body).toBeUndefined();
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('preserves the explicit false unread filter and zero offset', async () => {
    const fetcher = mockResponse({ items: [], total: 0, unreadTotal: 0, throughId: null });
    await notificationsApi.list({ category: 'all', unread: false, limit: 20, offset: 0 });
    expect(fetcher.mock.calls[0][0]).toBe(
      '/api/v1/notifications?category=all&unread=false&limit=20&offset=0',
    );
  });

  it('uses the lightweight unread endpoint without loading the list', async () => {
    const fetcher = mockResponse({ unreadTotal: 3, throughId: `notice_${'a'.repeat(32)}` });
    await notificationsApi.unread();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/notifications/unread');
    expect(fetcher.mock.calls[0][1].body).toBeUndefined();
  });

  it('posts an empty object for a single read and encodes the path segment', async () => {
    const fetcher = mockResponse({ ok: true, unreadTotal: 0, readAt: '2026-10-27T00:00:00Z' });
    await notificationsApi.read('notice/with?syntax');
    const [path, options] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/v1/notifications/notice%2Fwith%3Fsyntax/read');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({});
    expect(new Headers(options.headers).get('Content-Type')).toBe('application/json');
  });

  it.each([null, `notice_${'b'.repeat(32)}`])(
    'preserves the exact read-all boundary %s, including an explicit null field',
    async (throughId) => {
      const fetcher = mockResponse({ ok: true, markedRead: 0, unreadTotal: 4 });
      await notificationsApi.readAll(throughId);
      const [path, options] = fetcher.mock.calls[0] as [string, RequestInit];
      expect(path).toBe('/api/v1/notifications/read-all');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body as string)).toEqual({ throughId });
    },
  );

  it('honors caller cancellation before issuing a write', async () => {
    const fetcher = mockResponse({ ok: true, markedRead: 1, unreadTotal: 0 });
    const controller = new AbortController();
    controller.abort();
    await expect(
      notificationsApi.readAll(`notice_${'c'.repeat(32)}`, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
