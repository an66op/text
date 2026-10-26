import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { LoginNotice, PlatformError } from '../PlatformUi';
import { useAuth } from '../useAuth';
import './circles.css';
import '../platform.css';
export function AuthGate({ title, children }: { title: string; children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'checking' || auth.status === 'unavailable' || !auth.user)
    return (
      <section className="platform-page sc-page">
        <PageHeader title={title} backTo="/circles" />
        <div className="sc-content">
          {auth.status === 'checking' ? (
            <p role="status" className="sc-empty">
              正在验证账号…
            </p>
          ) : auth.status === 'unavailable' ? (
            <PlatformError
              message={auth.error || '账号服务暂不可达'}
              retry={() => void auth.refresh()}
            />
          ) : (
            <>
              <LoginNotice
                returnTo={`${location.pathname}${location.search}`}
                text="登录后，加入真实圈子"
              />
              {location.hash && (
                <p className="sc-muted">登录后请重新打开原邀请链接；邀请码不会写入登录地址。</p>
              )}
            </>
          )}
        </div>
      </section>
    );
  return <div key={`${auth.user.id}:${auth.expiresAt}`}>{children}</div>;
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="sc-empty">{children}</div>;
}
export function Pagination({
  page,
  total,
  limit = 20,
  disabled,
  onPage,
}: {
  page: number;
  total: number;
  limit?: number;
  disabled?: boolean;
  onPage: (page: number) => void;
}) {
  return total > limit ? (
    <nav className="sc-pagination" aria-label="分页">
      <button disabled={disabled || !page} onClick={() => onPage(page - 1)}>
        上一页
      </button>
      <span>
        {page + 1} / {Math.max(1, Math.ceil(total / limit))}
      </span>
      <button disabled={disabled || (page + 1) * limit >= total} onClick={() => onPage(page + 1)}>
        下一页
      </button>
    </nav>
  ) : null;
}
export function DemoLink() {
  return (
    <Link className="sc-demo-link" to="/circles/demo">
      本机圈子演示 ↗
    </Link>
  );
}
