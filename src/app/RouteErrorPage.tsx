import { useEffect } from 'react';
import { useRouteError } from 'react-router';
import { paths } from '@/shared/config/paths';

export default function RouteErrorPage() {
  const error = useRouteError();
  useEffect(() => {
    console.error('路由加载失败', error);
  }, [error]);
  return (
    <div className="route-status">
      <h1>页面暂时无法打开</h1>
      <p>请重新加载页面后再试。</p>
      <button className="primary" onClick={() => window.location.reload()}>
        重新加载
      </button>
      <a href={paths.social}>返回社交</a>
    </div>
  );
}
