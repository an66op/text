import { useParams, useSearchParams } from 'react-router';
import { PlatformAvatar, PlatformError } from '../../PlatformUi';
import CirclePage from '../CirclePage';
import { useCircle } from '../circle-context';
import { useResource } from '../useResource';
import { Empty } from '../Ui';
import { eventsApi } from './api';
import { eventTime, registrationLabel } from './model';
import { EventStatus } from './EventUi';
import type { AttendeesStatus } from './types';
import EventPagination from './EventPagination';
export default function AttendeesPage() {
  return (
    <CirclePage title="名单" manager>
      <Attendees />
    </CirclePage>
  );
}
function Attendees() {
  const { circle, deny } = useCircle(),
    { eventId = '' } = useParams(),
    [params, setParams] = useSearchParams();
  const raw = params.get('status'),
    status: AttendeesStatus =
      raw === 'registered' || raw === 'waitlisted' || raw === 'cancelled' ? raw : 'all';
  const rawPage = params.get('page') || '1',
    page = /^[1-9]\d{0,3}$/.test(rawPage) ? Math.min(Number(rawPage) - 1, 5000) : 0;
  const detail = useResource(
    eventId,
    (signal) => eventsApi.detail(circle.id, eventId, signal),
    deny,
  );
  const list = useResource(
    `${eventId}:${status}:${page}`,
    (signal) =>
      eventsApi.attendees(circle.id, eventId, { status, limit: 20, offset: page * 20 }, signal),
    deny,
    !!detail.data,
  );
  const change = (next: AttendeesStatus, nextPage = 0) =>
    setParams({
      ...(next !== 'all' ? { status: next } : {}),
      ...(nextPage ? { page: String(nextPage + 1) } : {}),
    });
  return (
    <>
      <PlatformError
        message={detail.error || list.error}
        retry={() => {
          detail.refresh();
          list.refresh();
        }}
      />
      {detail.data && (
        <>
          <h1 className="sce-title">{detail.data.title}</h1>
          <EventStatus value={detail.data} />
          <p className="sc-muted">
            已确认 {detail.data.registeredCount} / {detail.data.capacity} 位 · 候补{' '}
            {detail.data.waitlistedCount} 位
          </p>
          <div className="sce-tabs" role="tablist" aria-label="报名名单分类">
            {(
              [
                ['all', '全部'],
                ['registered', '报名'],
                ['waitlisted', '候补'],
                ['cancelled', '取消'],
              ] as const
            ).map(([value, label]) => (
              <button
                type="button"
                role="tab"
                key={value}
                aria-selected={status === value}
                onClick={() => change(value)}
              >
                {label}
              </button>
            ))}
            <button type="button" aria-label="刷新名单" onClick={list.refresh}>
              刷新
            </button>
          </div>
        </>
      )}
      {detail.loading || list.loading ? (
        <Empty>正在读取报名名单…</Empty>
      ) : list.data?.items.length ? (
        <div className="sce-attendees">
          {list.data.items.map((entry) => (
            <article key={entry.user.id}>
              <PlatformAvatar user={entry.user} />
              <div>
                <strong>{entry.user.name}</strong>
                <small>@{entry.user.handle}</small>
                <p>{registrationLabel(entry.registration)}</p>
                <small>最近变更 {eventTime(entry.registration.updatedAt)}</small>
              </div>
            </article>
          ))}
        </div>
      ) : (
        detail.data && !list.error && <Empty>暂无这个状态的报名。</Empty>
      )}
      <EventPagination
        page={page}
        total={list.data?.total ?? 0}
        loading={list.loading}
        onPage={(value) => change(status, value)}
      />
    </>
  );
}
