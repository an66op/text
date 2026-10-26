import { Plus, RefreshCw } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { PlatformError } from '../../PlatformUi';
import CirclePage from '../CirclePage';
import { useCircle } from '../circle-context';
import { circlePaths } from '../paths';
import { isManager } from '../types';
import { useResource } from '../useResource';
import { Empty } from '../Ui';
import { eventsApi } from './api';
import { EventCard } from './EventUi';
import type { EventsView } from './types';
import EventPagination from './EventPagination';
export default function EventsPage() {
  return (
    <CirclePage title="活动">
      <Events />
    </CirclePage>
  );
}
function Events() {
  const { circle, deny } = useCircle(),
    [params, setParams] = useSearchParams();
  const requested = params.get('view'),
    view: EventsView = requested === 'mine' || requested === 'all' ? requested : 'upcoming';
  const rawPage = params.get('page') || '1',
    page = /^[1-9]\d{0,3}$/.test(rawPage) ? Math.min(Number(rawPage) - 1, 5000) : 0;
  const list = useResource(
    `${circle.id}:${view}:${page}`,
    (signal) => eventsApi.list(circle.id, { view, limit: 20, offset: page * 20 }, signal),
    deny,
  );
  const change = (nextView: EventsView, nextPage = 0) =>
    setParams({
      ...(nextView !== 'upcoming' ? { view: nextView } : {}),
      ...(nextPage ? { page: String(nextPage + 1) } : {}),
    });
  return (
    <>
      <div className="sce-heading">
        <div className="sce-tabs" role="tablist" aria-label="活动分类">
          {(
            [
              ['upcoming', '近期'],
              ['mine', '我的'],
              ['all', '全部'],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              role="tab"
              key={value}
              aria-selected={view === value}
              onClick={() => change(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" aria-label="刷新活动" onClick={list.refresh}>
          <RefreshCw size={17} />
        </button>
        {isManager(circle) && circle.status === 'active' && (
          <Link to={circlePaths.eventCreate(circle.id)} aria-label="创建活动">
            <Plus size={20} />
          </Link>
        )}
      </div>
      <PlatformError message={list.error} retry={list.refresh} />
      {list.loading ? (
        <Empty>正在读取活动…</Empty>
      ) : list.data?.items.length ? (
        <div className="sce-list">
          {list.data.items.map((value) => (
            <EventCard key={value.id} value={value} />
          ))}
        </div>
      ) : (
        !list.error && (
          <Empty>
            <h2>{view === 'mine' ? '尚无有效报名或候补' : '暂无符合条件的活动'}</h2>
            {isManager(circle) && circle.status === 'active' && (
              <Link className="sc-primary" to={circlePaths.eventCreate(circle.id)}>
                创建活动
              </Link>
            )}
          </Empty>
        )
      )}
      <EventPagination
        page={page}
        total={list.data?.total ?? 0}
        loading={list.loading}
        onPage={(value) => change(view, value)}
      />
    </>
  );
}
