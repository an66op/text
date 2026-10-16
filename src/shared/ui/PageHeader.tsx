import { ChevronLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { type ReactNode } from 'react';
import { paths } from '@/shared/config/paths';
export default function PageHeader({
  title,
  backTo = paths.discover,
  action,
}: {
  title: string;
  backTo?: string;
  action?: ReactNode;
}) {
  const navigate = useNavigate();
  const { key } = useLocation();
  const back = () => {
    const historyIndex: unknown = window.history.state?.idx;
    const hasHistory = typeof historyIndex === 'number' ? historyIndex > 0 : key !== 'default';
    if (hasHistory) navigate(-1);
    else navigate(backTo, { replace: true });
  };
  return (
    <div className="content-topbar">
      <button aria-label="返回" onClick={back}>
        <ChevronLeft size={25} strokeWidth={2} />
      </button>
      <strong>{title}</strong>
      {action}
    </div>
  );
}
