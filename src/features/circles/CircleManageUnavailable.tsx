import { LockKeyhole } from 'lucide-react';
import { Link } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { circlePaths } from './routes';

export function CircleManageUnavailable({
  title,
  circleId,
  message = '这个圈子不存在，或已被解散。',
}: {
  title: string;
  circleId?: string;
  message?: string;
}) {
  const backTo = circleId ? circlePaths.home(circleId) : circlePaths.list;
  return (
    <div className="circle-page circle-manage-page">
      <PageHeader title={title} backTo={backTo} />
      <div className="circle-page-body">
        <div className="circle-manage-empty">
          <LockKeyhole size={30} />
          <h2>暂时无法访问</h2>
          <p>{message}</p>
          <Link className="secondary" to={backTo}>
            {circleId ? '返回圈子' : '返回圈子列表'}
          </Link>
        </div>
      </div>
    </div>
  );
}
