import { useState } from 'react';
import { Crown, Search, ShieldCheck, UserMinus, UserPlus, Users } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { useToast } from '@/shared/ui/useToast';
import { circlePaths } from './routes';
import { canManage, useCircles } from './useCircles';
import { CircleManageUnavailable } from './CircleManageUnavailable';
import type { CircleMember } from './types';

const roleNames = { owner: '圈主', admin: '管理员', member: '成员' };

export function CircleMembersPage() {
  const { circleId = '' } = useParams();
  const { getCircle, getMembers, setMemberRole, removeMember, leaveCircle } = useCircles();
  const notify = useToast();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const circle = getCircle(circleId);
  if (!circle) return <CircleManageUnavailable title="成员与角色" />;
  if (!circle.joined)
    return (
      <CircleManageUnavailable
        title="成员与角色"
        circleId={circleId}
        message="加入圈子后可以查看成员列表。"
      />
    );
  const members = getMembers(circleId);
  const filtered = members.filter((member) =>
    `${member.name} ${roleNames[member.role]}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const managing = canManage(circle);
  const changeRole = (member: CircleMember, role: 'admin' | 'member') => {
    setError('');
    try {
      setMemberRole(circleId, member.id, role);
      notify(role === 'admin' ? '已设为管理员' : '已设为普通成员');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '角色更新失败，请重试。');
    }
  };
  const remove = (member: CircleMember) => {
    setError('');
    try {
      removeMember(circleId, member.id);
      setRemoving(null);
      notify('成员已移出圈子');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '移除失败，请重试。');
    }
  };
  const leave = () => {
    setError('');
    try {
      leaveCircle(circleId);
      notify('已退出圈子');
      navigate(circlePaths.list, { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '退出失败，请重试。');
    }
  };
  return (
    <div className="circle-page circle-manage-page">
      <PageHeader
        title="成员与角色"
        backTo={circlePaths.home(circleId)}
        action={
          <Link to={circlePaths.invite(circleId)} aria-label="邀请成员">
            <UserPlus size={21} />
          </Link>
        }
      />
      <div className="circle-page-body">
        <div className="circle-members-summary">
          <span>
            <Users size={19} />
            <strong>{members.length}</strong> 位成员
          </span>
          <span>
            <i />
            {members.filter((member) => member.online).length} 在线
          </span>
        </div>
        <label className="circle-member-search">
          <Search size={19} />
          <input
            aria-label="搜索成员"
            placeholder="搜索成员或角色"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {error && (
          <p className="circle-manage-error" role="alert">
            {error}
          </p>
        )}
        <div className="circle-manage-card circle-members-list">
          {filtered.map((member) => {
            const editable =
              managing &&
              member.id !== 'me' &&
              member.role !== 'owner' &&
              (circle.role === 'owner' || member.role === 'member');
            return (
              <div className="circle-member-item" key={member.id}>
                <div className="circle-member-row">
                  <span className="circle-member-avatar">
                    <img src={member.avatar} alt="" />
                    {member.online && <i />}
                  </span>
                  <div className="circle-member-info">
                    <strong>
                      {member.name}
                      {member.id === 'me' && <small>（我）</small>}
                    </strong>
                    <span className={`circle-member-role ${member.role}`}>
                      {member.role === 'owner' ? (
                        <Crown size={12} />
                      ) : member.role === 'admin' ? (
                        <ShieldCheck size={12} />
                      ) : null}
                      {roleNames[member.role]}
                    </span>
                  </div>
                  {editable && (
                    <div className="circle-member-controls">
                      {circle.role === 'owner' && (
                        <select
                          aria-label={`设置${member.name}的角色`}
                          value={member.role}
                          onChange={(event) =>
                            changeRole(member, event.target.value as 'admin' | 'member')
                          }
                        >
                          <option value="member">成员</option>
                          <option value="admin">管理员</option>
                        </select>
                      )}
                      <button
                        aria-label={`移除${member.name}`}
                        className="circle-member-remove"
                        onClick={() => setRemoving(removing === member.id ? null : member.id)}
                      >
                        <UserMinus size={18} />
                      </button>
                    </div>
                  )}
                </div>
                {removing === member.id && editable && (
                  <div className="circle-member-confirm">
                    <p>将 {member.name} 移出圈子？</p>
                    <div>
                      <button className="secondary" onClick={() => setRemoving(null)}>
                        取消
                      </button>
                      <button className="circle-danger-button" onClick={() => remove(member)}>
                        确认移除
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {!filtered.length && (
            <div className="circle-manage-empty">
              <Search size={25} />
              <h2>没有找到成员</h2>
              <p>试试其他昵称或角色。</p>
              <button className="secondary" onClick={() => setQuery('')}>
                清除搜索
              </button>
            </div>
          )}
        </div>
        {circle.role !== 'owner' && (
          <section className="circle-manage-card circle-danger-zone">
            <h2>退出圈子</h2>
            {leaving ? (
              <div className="circle-inline-confirm">
                <p>退出后将无法查看仅成员可见的内容，可以通过公开入口或邀请码重新加入。</p>
                <div>
                  <button className="secondary" onClick={() => setLeaving(false)}>
                    取消
                  </button>
                  <button className="circle-danger-button" onClick={leave}>
                    确认退出
                  </button>
                </div>
              </div>
            ) : (
              <button className="circle-danger-button" onClick={() => setLeaving(true)}>
                退出圈子
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
