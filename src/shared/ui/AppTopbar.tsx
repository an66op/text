import type { ReactNode } from 'react';
import './AppTopbar.css';

type AppTopbarProps = {
  title: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleAs?: 'h1' | 'strong';
  appearance?: 'glass' | 'plain';
};

export default function AppTopbar({
  title,
  leading,
  actions,
  className = '',
  titleAs = 'h1',
  appearance = 'plain',
}: AppTopbarProps) {
  return (
    <header
      className={`app-topbar ${appearance === 'plain' ? 'app-topbar-plain ' : ''}${className}`.trim()}
    >
      <div className="app-topbar-leading">{leading}</div>
      {titleAs === 'strong' ? (
        <strong className="app-topbar-title">{title}</strong>
      ) : (
        <h1 className="app-topbar-title">{title}</h1>
      )}
      <div className="app-topbar-actions">{actions}</div>
    </header>
  );
}
