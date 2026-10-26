import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventsApi } from './api';
import { eventInput, eventForm } from './model';
import { activity, registration } from './test-fixtures';
afterEach(() => vi.unstubAllGlobals());
describe('circle event service requests', () => {
  it('keeps registration intent and stable client ID explicit and edits at the reviewed revision', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ok: true, registration } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: activity })));
    vi.stubGlobal('fetch', fetcher);
    await eventsApi.registration(
      activity.circleId,
      activity.id,
      'waitlist',
      'stable-event-request',
    );
    expect(fetcher.mock.calls[0][0]).toBe(
      `/api/v1/circles/${activity.circleId}/events/${activity.id}/registration`,
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      intent: 'waitlist',
      clientId: 'stable-event-request',
    });
    await eventsApi.update(activity.circleId, activity.id, {
      ...eventInput(eventForm(activity), activity),
      revision: activity.revision,
    });
    expect(fetcher.mock.calls[1][1].method).toBe('PATCH');
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
      revision: 3,
      startsAt: activity.startsAt,
    });
  });
  it('uses narrow paginated lists and fixed report scope without accepting an arbitrary target', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { items: [activity], total: 31 } })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { items: [], total: 0 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'report-one' } })));
    vi.stubGlobal('fetch', fetcher);
    await eventsApi.list(activity.circleId, { view: 'mine', limit: 20, offset: 20 });
    await eventsApi.attendees(activity.circleId, activity.id, {
      status: 'waitlisted',
      limit: 20,
      offset: 40,
    });
    await eventsApi.report(activity.circleId, activity.id, '活动信息不合适');
    expect(fetcher.mock.calls[0][0]).toContain('view=mine&limit=20&offset=20');
    expect(fetcher.mock.calls[1][0]).toContain('/attendees?status=waitlisted&limit=20&offset=40');
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ reason: '活动信息不合适' });
  });
  it('rejects a circle or event mismatched receipt before it can become visible in the current page', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ...activity, circleId: 'wrong-circle' } })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ...activity, id: 'wrong-event' } })),
      );
    vi.stubGlobal('fetch', fetcher);
    await expect(eventsApi.detail(activity.circleId, activity.id)).rejects.toThrow(
      '回执与当前页面不一致',
    );
    await expect(eventsApi.cancel(activity.circleId, activity.id, 3)).rejects.toThrow(
      '回执与当前页面不一致',
    );
  });
});
