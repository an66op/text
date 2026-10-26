import { useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  CircleHelp,
  CircleDot,
  FileText,
  Flag,
  Images,
  LayoutDashboard,
  LogOut,
  Settings2,
  ShieldCheck,
  Users,
  Waves,
} from 'lucide-react';
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router';
import { errorMessage } from './api';
import { frontendUrl } from './config';
import type { SystemInfo } from './types';
import { useResource } from './use-resource';
import { dateTime, roleLabels } from './format';
import { useSession } from './use-session';
import { Avatar, Badge, ErrorState, Loading, Notice } from './ui';
import LoginPage from './pages/LoginPage';
import OverviewPage from './pages/OverviewPage';
import UsersPage from './pages/UsersPage';
import ContentPage from './pages/ContentPage';
import MediaPage from './pages/MediaPage';
import CirclesPage, { CirclePostsPage } from './pages/CirclesPage';
import CircleEventsPage from './pages/CircleEventsPage';
import ReportsPage from './pages/ReportsPage';
import AuditPage from './pages/AuditPage';
import SystemPage from './pages/SystemPage';

const navigation = [
  { to: '/overview', title: '运营总览', icon: LayoutDashboard, code: '01' },
  { to: '/users', title: '用户管理', icon: Users, code: '02' },
  { to: '/content', title: '内容审核', icon: FileText, code: '03' },
  { to: '/media', title: '图片管理', icon: Images, code: '04' },
  { to: '/circles', title: '圈子治理', icon: CircleDot, code: '05' },
  { to: '/reports', title: '举报中心', icon: Flag, code: '06' },
  { to: '/audit', title: '操作审计', icon: Activity, code: '07' },
  { to: '/system', title: '系统状态', icon: Settings2, code: '08' },
];

function EnvironmentBadge() {
  const { data, error } = useResource<SystemInfo>('/admin/system');
  if (!data) return <Badge tone={error ? 'warning' : 'neutral'}>环境待确认</Badge>;
  return (
    <Badge tone={data.environment === 'production' ? 'good' : 'warning'}>
      {data.environment === 'production'
        ? '生产环境'
        : data.environment === 'development'
          ? '独立测试环境'
          : data.environment || '未知环境'}
    </Badge>
  );
}

function ProtectedLayout() {
  const { session, status, error, refresh, logout } = useSession();
  const location = useLocation();
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const signOut = async () => {
    setLogoutBusy(true);
    setLogoutError('');
    try {
      await logout();
    } catch (error) {
      setLogoutError(errorMessage(error));
    } finally {
      setLogoutBusy(false);
    }
  };

  if (status === 'checking')
    return (
      <div className="full-state">
        <Loading label="正在验证运营会话…" />
      </div>
    );
  if (status === 'unavailable')
    return (
      <div className="full-state">
        <ErrorState message={error} onRetry={() => void refresh()} />
      </div>
    );
  if (!session)
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (session.user.role !== 'admin' && session.user.role !== 'moderator') {
    return (
      <div className="full-state">
        <div className="access-card">
          <span className="state-icon">
            <ShieldCheck size={28} />
          </span>
          <h1>当前账号没有运营权限</h1>
          <p>{session.user.email} 是成员账号。工作台仅向管理员与审核员开放。</p>
          {logoutError && <Notice>{logoutError}</Notice>}
          <button
            className="button button-primary"
            onClick={() => void signOut()}
            disabled={logoutBusy}
          >
            {logoutBusy ? '正在退出…' : '退出并切换账号'}
          </button>
          <a className="text-link" href={frontendUrl}>
            返回共鸣前台 <ArrowUpRight size={15} />
          </a>
        </div>
      </div>
    );
  }
  const activeTitle =
    navigation.find((item) => location.pathname.startsWith(item.to))?.title || '运营工作台';

  return (
    <div className="admin-shell" key={`${session.user.id}:${session.expiresAt}`}>
      <aside className="sidebar">
        <Link to="/overview" className="brand" aria-label="共鸣运营首页">
          <span className="brand-mark">
            <Waves size={24} strokeWidth={2.5} />
          </span>
          <span>
            <strong>共鸣</strong>
            <small>运营工作台</small>
          </span>
          <span className="brand-version">1.0</span>
        </Link>
        <div className="sidebar-label">
          工作空间 <span>WORKSPACE</span>
        </div>
        <nav aria-label="运营导航">
          {navigation.map(({ to, title, icon: Icon, code }) => (
            <NavLink
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              key={to}
              to={to}
            >
              <Icon size={19} />
              <span>{title}</span>
              <small>{code}</small>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-note">
            <ShieldCheck size={20} />
            <div>
              <strong>每一步，都有记录</strong>
              <p>运营变更由服务端审计留痕。</p>
            </div>
          </div>
          <Link to="/system" className="sidebar-help">
            <CircleHelp size={17} /> 环境与接入说明 <ArrowUpRight size={14} />
          </Link>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            工作空间 <span>/</span> <strong>{activeTitle}</strong>
          </div>
          <div className="topbar-right">
            <EnvironmentBadge />
            <span className="topbar-divider" />
            <div className="operator">
              <Avatar name={session.user.name} src={session.user.avatar} />
              <div>
                <strong>{session.user.name}</strong>
                <small>{roleLabels[session.user.role]}</small>
              </div>
            </div>
            <button
              className="icon-button"
              aria-label="退出登录"
              title="退出登录"
              disabled={logoutBusy}
              onClick={() => void signOut()}
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        {logoutError && (
          <div className="global-notice">
            <Notice onDismiss={() => setLogoutError('')}>{logoutError}</Notice>
          </div>
        )}
        {error && (
          <div className="global-notice">
            <Notice>
              {error}{' '}
              <button className="text-link" onClick={() => void refresh()}>
                重新验证
              </button>
            </Notice>
          </div>
        )}
        <main className="workspace-main">
          <Outlet />
        </main>
        <footer className="workspace-footer">
          <span>共鸣控制台 · 数据由 Go API 实时读取</span>
          <span>会话到期 {dateTime(session.expiresAt)} CST</span>
        </footer>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="state-panel">
      <span className="eyebrow">404</span>
      <h1>没有找到这个页面</h1>
      <p>页面地址可能已变更。</p>
      <Link className="button button-primary" to="/overview">
        返回总览
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedLayout />}>
        <Route index element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/content" element={<ContentPage />} />
        <Route path="/media" element={<MediaPage />} />
        <Route path="/circles" element={<CirclesPage />} />
        <Route path="/circles/posts" element={<CirclePostsPage />} />
        <Route path="/circles/events" element={<CircleEventsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/system" element={<SystemPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
