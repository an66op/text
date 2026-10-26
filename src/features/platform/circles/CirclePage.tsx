import { useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { LoginNotice, PlatformError } from '../PlatformUi';
import { useAuth } from '../useAuth';
import { circlesApi } from './api';
import { CircleContext } from './circle-context';
import { circlePaths } from './paths';
import { isManager } from './types';
import { useResource } from './useResource';
import { Empty } from './Ui';

export default function CirclePage({
  title,
  children,
  publicView = false,
  manager = false,
}: {
  title: string;
  children: ReactNode;
  publicView?: boolean;
  manager?: boolean;
}) {
  const auth = useAuth();
  const { circleId = '' } = useParams();
  const location = useLocation();
  const [attempt, setAttempt] = useState(0);
  return (
    <CircleSession
      key={`${auth.user?.id ?? 'guest'}:${auth.expiresAt}:${circleId}:${location.pathname}:${location.search}:${attempt}`}
      title={title}
      circleId={circleId}
      publicView={publicView}
      manager={manager}
      retry={() => setAttempt((value) => value + 1)}
    >
      {children}
    </CircleSession>
  );
}
function CircleSession({
  title,
  circleId,
  children,
  publicView,
  manager,
  retry,
}: {
  title: string;
  circleId: string;
  children: ReactNode;
  publicView: boolean;
  manager: boolean;
  retry: () => void;
}) {
  const auth = useAuth();
  const location = useLocation();
  const resource = useResource(
    `circle:${circleId}`,
    (signal) => circlesApi.circle(circleId, signal),
    undefined,
    auth.status !== 'checking' && auth.status !== 'unavailable',
  );
  const [denied, setDenied] = useState('');
  const circle = resource.data;
  let content: ReactNode;
  if (auth.status === 'checking') content = <Empty>正在验证账号…</Empty>;
  else if (auth.status === 'unavailable')
    content = (
      <PlatformError message={auth.error || '账号服务暂不可达'} retry={() => void auth.refresh()} />
    );
  else if (denied)
    content = (
      <>
        <PlatformError message={denied} retry={retry} />
        <Empty>圈内访问权限已变化，请重新确认。</Empty>
      </>
    );
  else if (!circle)
    content = (
      <>
        <PlatformError message={resource.error} retry={retry} />
        {resource.loading && <Empty>正在读取圈子…</Empty>}
      </>
    );
  else if (!publicView && !auth.user)
    content = (
      <LoginNotice returnTo={location.pathname + location.search} text="登录并加入圈子后查看内容" />
    );
  else if (!publicView && circle.membership !== 'active')
    content = (
      <Empty>
        <h2>加入圈子后查看内容</h2>
        <p>
          {circle.membership === 'pending'
            ? '申请正在等待圈方审核。'
            : circle.membership === 'banned'
              ? '当前账号已被圈方封禁。'
              : '这里的内容仅圈内成员可见。'}
        </p>
        <Link className="sc-primary" to={circlePaths.join(circleId)}>
          查看加入方式
        </Link>
      </Empty>
    );
  else if (!publicView && circle.status === 'suspended')
    content = (
      <Empty>
        <h2>圈子已暂停</h2>
        <p>圈内内容暂不可访问，请等待平台处理。</p>
      </Empty>
    );
  else if (manager && !isManager(circle)) content = <Empty>只有当前圈主或圈管理员可以管理。</Empty>;
  else
    content = (
      <CircleContext.Provider value={{ circle, refresh: resource.refresh, deny: setDenied }}>
        <div key={`${circle.role}:${circle.membership}:${circle.status}:${circle.owner.id}`}>
          {resource.error && <PlatformError message={resource.error} retry={resource.refresh} />}
          {children}
        </div>
      </CircleContext.Provider>
    );
  return (
    <section className="platform-page sc-page">
      <PageHeader
        title={title}
        backTo={publicView ? circlePaths.list : circlePaths.home(circleId)}
      />
      <div className="sc-content">
        {circle?.status === 'archived' && (
          <p className="sc-notice">圈子已归档，可阅读历史，暂不接受新内容。</p>
        )}
        {content}
      </div>
    </section>
  );
}
