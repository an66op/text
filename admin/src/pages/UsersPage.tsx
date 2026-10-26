import { useState } from 'react';
import { Eye, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { api, errorMessage, queryString } from '../api';
import { dateTime, number, roleLabels, userStatusLabels } from '../format';
import { PAGE_SIZE, useListParams } from '../use-list-params';
import { useResource } from '../use-resource';
import { useSession } from '../use-session';
import type { Page, User, UserRole, UserStatus } from '../types';
import {
  Avatar,
  Badge,
  ConfirmAction,
  Dialog,
  Empty,
  ErrorState,
  Loading,
  Notice,
  PageHeading,
  Pagination,
  SearchForm,
} from '../ui';

function UserDetails({
  user,
  onClose,
  onSaved,
}: {
  user: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { session } = useSession();
  const [role, setRole] = useState<UserRole>(user.role);
  const [status, setStatus] = useState<UserStatus>(user.status);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const self = user.id === session?.user.id;
  const allowed = session?.user.role === 'admin' && !self;
  const changed = role !== user.role || status !== user.status;
  const save = async () => {
    if (!allowed || !changed || busy) return;
    setBusy(true);
    setError('');
    try {
      const changes: { role?: UserRole; status?: UserStatus } = {};
      if (role !== user.role) changes.role = role;
      if (status !== user.status) changes.status = status;
      await api<User>(`/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        body: changes,
      });
      onSaved();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="用户资料与权限"
      description="账号变更立即生效，并由服务端写入审计记录。"
      onClose={onClose}
      busy={busy}
    >
      <div className="profile-summary">
        <Avatar name={user.name} src={user.avatar} size="large" />
        <div>
          <h3>{user.name}</h3>
          <p>@{user.handle}</p>
          <Badge tone={user.status === 'active' ? 'good' : 'danger'}>
            {userStatusLabels[user.status]}
          </Badge>
        </div>
      </div>
      <dl className="detail-grid">
        <div>
          <dt>账号 ID</dt>
          <dd className="mono break-all">{user.id}</dd>
        </div>
        <div>
          <dt>注册时间</dt>
          <dd>{dateTime(user.createdAt)}</dd>
        </div>
        <div>
          <dt>邮箱</dt>
          <dd className="break-all">{user.email}</dd>
        </div>
        <div>
          <dt>个人介绍</dt>
          <dd>{user.bio || '暂未填写'}</dd>
        </div>
      </dl>
      <div className="section-separator" />
      <div className="section-label">
        <ShieldCheck size={17} />
        <h3>账号权限</h3>
      </div>
      {!allowed && (
        <Notice tone="info">
          {self
            ? '当前登录账号不能在此修改自身状态或角色。请由另一位管理员操作。'
            : '审核员可以查看账号资料，用户角色和状态变更仅对管理员开放。'}
        </Notice>
      )}
      <div className="form-columns">
        <label className="field">
          账号状态
          <select
            value={status}
            disabled={!allowed || confirming}
            onChange={(event) => setStatus(event.target.value as UserStatus)}
          >
            <option value="active">正常</option>
            <option value="suspended">停用</option>
          </select>
        </label>
        <label className="field">
          角色
          <select
            value={role}
            disabled={!allowed || confirming}
            onChange={(event) => setRole(event.target.value as UserRole)}
          >
            <option value="member">成员</option>
            <option value="moderator">审核员</option>
            <option value="admin">管理员</option>
          </select>
        </label>
      </div>
      <p className="field-hint">
        成员参与社区；审核员处理内容与举报；管理员还可管理账号权限。停用后账号将失去访问权限。
      </p>
      {confirming ? (
        <ConfirmAction
          title="确认账号变更"
          description={`将 @${user.handle} 的状态由「${userStatusLabels[user.status]}」改为「${userStatusLabels[status]}」，角色由「${roleLabels[user.role]}」改为「${roleLabels[role]}」。最后一位管理员受服务端保护。`}
          confirmLabel="确认并保存"
          danger={status === 'suspended' || role !== user.role}
          phrase={user.handle}
          busy={busy}
          error={error}
          onConfirm={() => void save()}
          onCancel={() => {
            setConfirming(false);
            setError('');
          }}
        />
      ) : (
        <div className="form-actions">
          <button className="button button-quiet" onClick={onClose}>
            关闭
          </button>
          <button
            className="button button-primary"
            disabled={!allowed || !changed}
            onClick={() => setConfirming(true)}
          >
            检查并保存
          </button>
        </div>
      )}
    </Dialog>
  );
}

export default function UsersPage() {
  const { q, status, role, offset, detail, update } = useListParams();
  const { data, loading, error, reload } = useResource<Page<User>>(
    `/admin/users${queryString({ q, status, role, offset, limit: PAGE_SIZE })}`,
  );
  const [notice, setNotice] = useState('');
  const selected = data?.items.find((user) => user.id === detail);
  return (
    <>
      <PageHeading
        eyebrow="PEOPLE"
        title="用户管理"
        description="查看社区成员，维护账号状态与清楚的权限边界。"
        actions={
          <button className="button" onClick={reload} disabled={loading}>
            <RefreshCw size={16} />
            刷新
          </button>
        }
      />
      {notice && (
        <Notice tone="success" onDismiss={() => setNotice('')}>
          {notice}
        </Notice>
      )}
      <section className="panel">
        <div className="list-toolbar">
          <SearchForm
            value={q}
            placeholder="搜索昵称、标识或邮箱"
            onSearch={(value) => update('q', value)}
          />
          <div className="filter-group">
            <label>
              状态
              <select
                aria-label="筛选用户状态"
                value={status}
                onChange={(event) => update('status', event.target.value)}
              >
                <option value="">全部状态</option>
                <option value="active">正常</option>
                <option value="suspended">已停用</option>
              </select>
            </label>
            <label>
              角色
              <select
                aria-label="筛选用户角色"
                value={role}
                onChange={(event) => update('role', event.target.value)}
              >
                <option value="">全部角色</option>
                <option value="member">成员</option>
                <option value="moderator">审核员</option>
                <option value="admin">管理员</option>
              </select>
            </label>
          </div>
        </div>
        <div className="list-summary">
          <span>成员目录</span>
          {data && <span>{number(data.total)} 位用户</span>}
        </div>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : (
          data && (
            <>
              {data.items.length ? (
                <div className="table-scroll">
                  <table>
                    <caption className="sr-only">用户列表</caption>
                    <thead>
                      <tr>
                        <th>用户</th>
                        <th>邮箱</th>
                        <th>角色</th>
                        <th>状态</th>
                        <th>注册时间</th>
                        <th className="align-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((user) => (
                        <tr key={user.id}>
                          <td>
                            <div className="user-cell">
                              <Avatar name={user.name} src={user.avatar} />
                              <div>
                                <strong>{user.name}</strong>
                                <small>@{user.handle}</small>
                              </div>
                            </div>
                          </td>
                          <td className="muted">{user.email}</td>
                          <td>
                            <Badge
                              tone={
                                user.role === 'admin'
                                  ? 'purple'
                                  : user.role === 'moderator'
                                    ? 'warning'
                                    : 'neutral'
                              }
                            >
                              {roleLabels[user.role]}
                            </Badge>
                          </td>
                          <td>
                            <Badge tone={user.status === 'active' ? 'good' : 'danger'}>
                              {userStatusLabels[user.status]}
                            </Badge>
                          </td>
                          <td className="muted nowrap">{dateTime(user.createdAt)}</td>
                          <td className="align-right">
                            <button
                              className="row-button"
                              onClick={() => update('detail', user.id)}
                              aria-label={`查看 ${user.name}`}
                            >
                              <Eye size={15} />
                              详情
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty icon={<Users size={25} />} />
              )}
              <Pagination
                total={data.total}
                offset={offset}
                count={data.items.length}
                limit={PAGE_SIZE}
                onChange={(value) => update('offset', String(value))}
              />
            </>
          )
        )}
      </section>
      {selected && (
        <UserDetails
          key={selected.id + selected.role + selected.status}
          user={selected}
          onClose={() => update('detail', '')}
          onSaved={() => {
            setNotice('账号变更已保存，服务端已记录此次操作。');
            update('detail', '');
            reload();
          }}
        />
      )}
      {detail && data && !selected && !loading && (
        <Dialog title="未找到用户" onClose={() => update('detail', '')}>
          <Empty
            title="这位用户不在当前列表"
            description="记录可能已变更，关闭详情并刷新列表后重试。"
          />
        </Dialog>
      )}
    </>
  );
}
