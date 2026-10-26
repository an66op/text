import { useState } from 'react';
import { ArrowUpRight, ChevronLeft, Plus, Search } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import AppTopbar from '@/shared/ui/AppTopbar';
import { LoginNotice, PlatformAvatar, PlatformError } from '../PlatformUi';
import { imageUrl, shortTime } from '../platform-format';
import { useAuth } from '../useAuth';
import { circlesApi } from './api';
import { circlePaths } from './paths';
import { useMutation } from './useMutation';
import { useResource } from './useResource';
import { DemoLink, Empty, Pagination } from './Ui';
import type { Circle } from './types';

export default function DirectoryPage() {
  const auth = useAuth();
  return <Directory key={`${auth.user?.id ?? 'guest'}:${auth.expiresAt}`} />;
}
function Directory() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const tab =
    params.get('tab') === 'requests'
      ? 'requests'
      : params.get('tab') === 'mine'
        ? 'mine'
        : 'discover';
  const [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(0);
  const enabled =
    tab !== 'requests' &&
    (tab === 'discover' || !!auth.user) &&
    !['checking', 'unavailable'].includes(auth.status);
  const list = useResource(
    `${tab}:${search}:${page}`,
    (signal) =>
      circlesApi.directory({ scope: tab, q: search, limit: 20, offset: page * 20 }, signal),
    undefined,
    enabled,
  );
  return (
    <section className="platform-page sc-page sc-directory">
      <AppTopbar
        title="圈子"
        leading={
          <Link to="/discover" aria-label="返回发现">
            <ChevronLeft size={23} />
          </Link>
        }
        actions={
          <Link to={circlePaths.create} aria-label="创建圈子">
            <Plus size={22} />
          </Link>
        }
      />
      <div className="sc-content">
        <div className="sc-directory-meta">
          <DemoLink />
        </div>
        <div className="sc-tabs" role="tablist" aria-label="圈子导航">
          {(
            [
              ['mine', '我的'],
              ['discover', '发现'],
              ['requests', '申请'],
            ] as const
          ).map(([id, label]) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab === id}
              key={id}
              onClick={() => {
                setParams({ tab: id });
                setPage(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {auth.status === 'checking' ? (
          <Empty>正在验证账号…</Empty>
        ) : auth.status === 'unavailable' ? (
          <PlatformError
            message={auth.error || '账号服务暂不可达'}
            retry={() => void auth.refresh()}
          />
        ) : tab === 'requests' ? (
          <MyRequests />
        ) : tab === 'mine' && !auth.user ? (
          <LoginNotice returnTo="/circles?tab=mine" text="登录后查看你已加入的圈子" />
        ) : (
          <>
            <form
              className="platform-search"
              onSubmit={(event) => {
                event.preventDefault();
                setSearch(query.trim());
                setPage(0);
              }}
            >
              <Search size={17} />
              <input
                aria-label="搜索服务圈子"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                maxLength={100}
                placeholder="搜索圈子、兴趣"
              />
              <button type="submit">搜索</button>
            </form>
            <PlatformError message={list.error} retry={list.refresh} />
            {list.loading ? (
              <Empty>正在读取圈子…</Empty>
            ) : list.data?.items.length ? (
              <div className="sc-directory-grid">
                {list.data.items.map((circle) => (
                  <CircleCard key={circle.id} circle={circle} />
                ))}
              </div>
            ) : (
              !list.error && (
                <Empty>
                  <h2>{tab === 'mine' ? '还没有加入圈子' : '还没有找到相关圈子'}</h2>
                  <p>发现共同兴趣，也可以创建自己的空间。</p>
                  <Link className="sc-primary" to={circlePaths.create}>
                    创建圈子
                  </Link>
                </Empty>
              )
            )}
            <Pagination
              page={page}
              total={list.data?.total ?? 0}
              disabled={list.loading}
              onPage={setPage}
            />
          </>
        )}
      </div>
    </section>
  );
}
function CircleCard({ circle }: { circle: Circle }) {
  const cover = /^https?:\/\//i.test(circle.cover) ? imageUrl(circle.cover) : '';
  return (
    <Link className="sc-circle-card" to={circlePaths.home(circle.id)}>
      <div
        className="sc-card-cover"
        style={cover ? { backgroundImage: `url(${cover})` } : undefined}
      >
        <span>{circle.icon || '✦'}</span>
        <small>
          {circle.visibility === 'private' ? '私密圈子' : circle.category || '兴趣圈子'}
        </small>
      </div>
      <div className="sc-card-body">
        <h2>
          {circle.name}
          <ArrowUpRight size={17} />
        </h2>
        <p>{circle.description}</p>
        <div className="sc-card-owner">
          <PlatformAvatar user={circle.owner} />
          <span>{circle.owner.name}</span>
          <small>{circle.memberCount} 位成员</small>
        </div>
        <span className="sc-card-membership">
          {circle.status !== 'active'
            ? circle.status === 'archived'
              ? '已归档'
              : '已暂停'
            : circle.membership === 'active'
              ? '已加入'
              : circle.membership === 'pending'
                ? '申请待审'
                : circle.joinPolicy === 'approval'
                  ? '审核加入'
                  : '开放加入'}
        </span>
      </div>
    </Link>
  );
}
function MyRequests() {
  const auth = useAuth();
  const [status, setStatus] = useState('pending'),
    [page, setPage] = useState(0);
  const list = useResource(
    `${status}:${page}`,
    (signal) => circlesApi.requests(null, { status, limit: 20, offset: page * 20 }, signal),
    undefined,
    !!auth.user,
  );
  const mutation = useMutation();
  if (!auth.user)
    return <LoginNotice returnTo="/circles?tab=requests" text="登录后查看本人发出的入圈申请" />;
  return (
    <>
      <p className="sc-muted">本人发出的入圈申请</p>
      <select
        className="sc-select"
        aria-label="申请状态"
        value={status}
        onChange={(event) => {
          setStatus(event.target.value);
          setPage(0);
        }}
      >
        <option value="pending">待审核</option>
        <option value="accepted">已通过</option>
        <option value="declined">已拒绝</option>
        <option value="cancelled">已撤回</option>
      </select>
      <button className="sc-text-button" type="button" onClick={list.refresh}>
        刷新申请
      </button>
      <PlatformError message={list.error || mutation.error} retry={list.refresh} />
      {list.loading ? (
        <Empty>正在读取申请…</Empty>
      ) : !list.data?.items.length ? (
        !list.error && <Empty>没有这个状态的申请。</Empty>
      ) : (
        list.data.items.map((request) => (
          <article className="sc-request-card" key={request.id}>
            <Link to={circlePaths.home(request.circle.id)}>
              <strong>{request.circle.name}</strong>
            </Link>
            <p>{request.note || '未填写申请说明'}</p>
            <small>{shortTime(request.createdAt)}</small>
            {request.status === 'pending' && (
              <button
                type="button"
                disabled={mutation.busy}
                onClick={async () => {
                  if (
                    await mutation.run((signal) =>
                      circlesApi.respond(request.circle.id, request.id, 'cancel', signal),
                    )
                  )
                    list.refresh();
                }}
              >
                撤回申请
              </button>
            )}
          </article>
        ))
      )}
      <Pagination
        page={page}
        total={list.data?.total ?? 0}
        disabled={list.loading}
        onPage={setPage}
      />
    </>
  );
}
