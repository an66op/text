import { Link } from 'react-router';
import { paths } from '@/shared/config/paths';
export default function NotFoundPage() {
  return (
    <div className="route-status">
      <h1>页面不存在</h1>
      <p>这个地址可能已变更。</p>
      <Link className="primary" to={paths.social}>
        返回社交
      </Link>
    </div>
  );
}
