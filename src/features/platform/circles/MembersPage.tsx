import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import ActionDialog from '@/shared/ui/ActionDialog';
import { PlatformAvatar, PlatformError } from '../PlatformUi';
import { useAuth } from '../useAuth';
import { shortTime } from '../platform-format';
import CirclePage from './CirclePage';
import { circlesApi } from './api';
import { useCircle } from './circle-context';
import { circlePaths } from './paths';
import { isManager, type Member } from './types';
import { useMutation } from './useMutation';
import { useResource } from './useResource';
import { Empty, Pagination } from './Ui';

const roleNames = { owner: '圈主', admin: '管理员', member: '成员' };
type Decision = { kind: 'remove' | 'unban' | 'transfer'; member: Member } | { kind: 'leave' };
export default function MembersPage() {
  return (
    <CirclePage title="成员">
      <Members />
    </CirclePage>
  );
}
function Members() {
  const { circle, deny, refresh } = useCircle(),
    { user } = useAuth(),
    navigate = useNavigate();
  const [tab, setTab] = useState('active'),
    [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(0),
    [decision, setDecision] = useState<Decision | null>(null),
    [ban, setBan] = useState(false),
    [notice, setNotice] = useState('');
  const manager = isManager(circle),
    writable = circle.status === 'active';
  const list = useResource(
    `${tab}:${search}:${page}`,
    (signal) =>
      circlesApi.members(
        circle.id,
        { status: tab, q: search, limit: 20, offset: page * 20 },
        signal,
      ),
    deny,
    tab !== 'requests',
  );
  const mutation = useMutation(deny);
  useEffect(() => {
    if (!decision || decision.kind === 'leave' || list.loading || mutation.busy || !list.data)
      return;
    const target = list.data.items.find((member) => member.user.id === decision.member.user.id);
    if (
      !target ||
      target.role !== decision.member.role ||
      target.status !== decision.member.status
    ) {
      setDecision(null);
      setNotice('成员状态已变化，请重新查看后再操作。');
    }
  }, [decision, list.data, list.loading, mutation.busy]);
  const confirm = async () => {
    if (!decision || !writable) return;
    if (decision.kind === 'leave') {
      if ((await mutation.run((signal) => circlesApi.leave(circle.id, signal)))?.ok)
        navigate(circlePaths.list, { replace: true });
      return;
    }
    const target = decision.member;
    const result = await mutation.run<unknown>((signal) =>
      decision.kind === 'transfer'
        ? circlesApi.transfer(circle.id, target.user.id, signal)
        : decision.kind === 'unban'
          ? circlesApi.unban(circle.id, target.user.id, signal)
          : circlesApi.removeMember(circle.id, target.user.id, ban, signal),
    );
    if (result) {
      setDecision(null);
      setNotice(
        decision.kind === 'transfer'
          ? `已将圈主转交给 ${target.user.name}`
          : decision.kind === 'unban'
            ? '已解除封禁，成员需重新申请加入'
            : ban
              ? '成员已被封禁，不能通过邀请重新加入'
              : '成员已移出，可重新申请加入',
      );
      list.refresh();
      refresh();
    }
  };
  return (
    <>
      <div className="sc-section-heading">
        <span>{circle.memberCount} 位成员</span>
        {manager && writable && <Link to={circlePaths.invite(circle.id)}>邀请成员 ↗</Link>}
      </div>
      {manager && (
        <div className="sc-tabs" role="tablist" aria-label="成员管理分类">
          {(
            [
              ['active', '成员'],
              ['requests', '审批'],
              ['banned', '封禁'],
              ['removed', '移除'],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              role="tab"
              key={value}
              aria-selected={tab === value}
              onClick={() => {
                setTab(value);
                setPage(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {tab === 'requests' ? (
        <Approvals writable={writable} />
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
            <input
              aria-label="搜索圈子成员"
              placeholder="搜索成员"
              maxLength={100}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="submit">搜索</button>
          </form>
          <PlatformError message={list.error || mutation.error} retry={list.refresh} />
          {notice && (
            <p className="sc-success" role="status">
              {notice}
            </p>
          )}
          {list.loading ? (
            <Empty>正在读取成员…</Empty>
          ) : list.data?.items.length ? (
            list.data.items.map((member) => {
              const editable =
                manager &&
                writable &&
                member.user.id !== user?.id &&
                member.role !== 'owner' &&
                (circle.role === 'owner' || member.role === 'member');
              return (
                <article className="sc-member-card" key={member.user.id}>
                  <div className="sc-host">
                    <PlatformAvatar user={member.user} />
                    <div>
                      <strong>
                        {member.user.name}
                        {member.user.id === user?.id && '（我）'}
                      </strong>
                      <small>
                        @{member.user.handle} · {roleNames[member.role]}
                      </small>
                    </div>
                  </div>
                  <small className="sc-muted">加入于 {shortTime(member.joinedAt)}</small>
                  {editable && (
                    <div className="sc-member-tools">
                      {member.status === 'active' && circle.role === 'owner' && (
                        <>
                          <select
                            aria-label={`设置${member.user.name}的角色`}
                            value={member.role}
                            disabled={mutation.busy}
                            onChange={async (event) => {
                              const next = await mutation.run((signal) =>
                                circlesApi.role(
                                  circle.id,
                                  member.user.id,
                                  event.target.value as 'admin' | 'member',
                                  signal,
                                ),
                              );
                              if (next) {
                                list.refresh();
                                refresh();
                                setNotice('角色已由服务器更新');
                              }
                            }}
                          >
                            <option value="member">成员</option>
                            <option value="admin">管理员</option>
                          </select>
                          <button
                            type="button"
                            disabled={mutation.busy}
                            onClick={() => setDecision({ kind: 'transfer', member })}
                          >
                            转交圈主
                          </button>
                        </>
                      )}
                      {member.status === 'banned' ? (
                        <button
                          type="button"
                          disabled={mutation.busy}
                          onClick={() => setDecision({ kind: 'unban', member })}
                        >
                          解除封禁
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="sc-danger"
                          disabled={mutation.busy}
                          onClick={() => {
                            setBan(member.status === 'removed');
                            setDecision({ kind: 'remove', member });
                          }}
                        >
                          {member.status === 'removed' ? '封禁成员' : '移除成员'}
                        </button>
                      )}
                    </div>
                  )}
                </article>
              );
            })
          ) : (
            !list.error && <Empty>没有符合条件的成员。</Empty>
          )}
          <Pagination
            page={page}
            total={list.data?.total ?? 0}
            disabled={list.loading}
            onPage={setPage}
          />
        </>
      )}
      {circle.role !== 'owner' && writable && (
        <button
          className="sc-danger sc-leave"
          type="button"
          onClick={() => setDecision({ kind: 'leave' })}
        >
          退出圈子
        </button>
      )}
      {circle.role === 'owner' && (
        <p className="sc-muted">圈主退出前需要先将圈主转交给正常成员。</p>
      )}
      {decision && (
        <ActionDialog
          title={
            decision.kind === 'leave'
              ? `退出「${circle.name}」？`
              : decision.kind === 'transfer'
                ? `将圈主转交给 ${decision.member.user.name}？`
                : decision.kind === 'unban'
                  ? `解禁 ${decision.member.user.name}？`
                  : `移除 ${decision.member.user.name}？`
          }
          confirmLabel={
            decision.kind === 'transfer'
              ? '确认转交圈主'
              : decision.kind === 'leave'
                ? '确认退出'
                : decision.kind === 'unban'
                  ? '确认解禁'
                  : ban
                    ? '确认封禁'
                    : '确认移除'
          }
          busy={mutation.busy}
          danger
          onClose={() => setDecision(null)}
          onConfirm={() => void confirm()}
        >
          <p>
            {decision.kind === 'transfer'
              ? '对方将获得圈主权限，你将成为管理员。此操作需要新圈主决定是否再次转交。'
              : decision.kind === 'leave'
                ? '退出后将失去圈内内容访问权限，需要重新申请或有效邀请才能回来。'
                : decision.kind === 'unban'
                  ? '解禁后状态为已移除，需要由本人重新申请，不会自动加入。'
                  : '移出后会失去圈内内容访问权限。封禁后不能用申请或邀请绕过。'}
          </p>
          {decision.kind === 'remove' && (
            <label className="sc-check">
              <input
                type="checkbox"
                checked={ban}
                disabled={mutation.busy}
                onChange={(event) => setBan(event.target.checked)}
              />
              同时封禁，禁止重新加入
            </label>
          )}
          <PlatformError message={mutation.error} />
        </ActionDialog>
      )}
    </>
  );
}
function Approvals({ writable }: { writable: boolean }) {
  const { circle, deny, refresh } = useCircle();
  const [page, setPage] = useState(0),
    [notice, setNotice] = useState('');
  const list = useResource(
      `${circle.id}:${page}`,
      (signal) =>
        circlesApi.requests(circle.id, { status: 'pending', limit: 20, offset: page * 20 }, signal),
      deny,
    ),
    mutation = useMutation(deny);
  return (
    <>
      <div className="sc-section-heading">
        <span>待处理入圈申请</span>
        <button type="button" onClick={list.refresh}>
          刷新申请
        </button>
      </div>
      <PlatformError message={list.error || mutation.error} retry={list.refresh} />
      {notice && (
        <p role="status" className="sc-success">
          {notice}
        </p>
      )}
      {list.loading ? (
        <Empty>正在读取申请…</Empty>
      ) : list.data?.items.length ? (
        list.data.items.map((request) => (
          <article className="sc-request-card" key={request.id}>
            <div className="sc-host">
              <PlatformAvatar user={request.user} />
              <div>
                <strong>{request.user.name}</strong>
                <small>@{request.user.handle}</small>
              </div>
            </div>
            <p>{request.note || '未填写申请说明'}</p>
            <small>{shortTime(request.createdAt)}</small>
            <div>
              <button
                disabled={mutation.busy || !writable}
                onClick={async () => {
                  if (
                    await mutation.run((signal) =>
                      circlesApi.respond(circle.id, request.id, 'accept', signal),
                    )
                  ) {
                    list.refresh();
                    refresh();
                    setNotice(`已通过 ${request.user.name} 的申请`);
                  }
                }}
              >
                通过申请
              </button>
              <button
                disabled={mutation.busy || !writable}
                onClick={async () => {
                  if (
                    await mutation.run((signal) =>
                      circlesApi.respond(circle.id, request.id, 'decline', signal),
                    )
                  ) {
                    list.refresh();
                    setNotice('申请已拒绝');
                  }
                }}
              >
                拒绝申请
              </button>
            </div>
          </article>
        ))
      ) : (
        !list.error && <Empty>没有待处理申请。</Empty>
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
