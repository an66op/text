import { Suspense, useEffect } from 'react';
import { Outlet, useLocation, useMatches } from 'react-router';
import Navigation from './Navigation';
import { useSocialStore } from '@/features/social/useSocialStore';
import { useAuth } from '@/features/platform/useAuth';
import { useOnlineUnread } from '@/shared/hooks/useOnlineUnread';
import type { PageMeta } from './types';

export function PageLoading() {
  return (
    <div className="route-status" role="status">
      <span className="loading-dot" />
      正在加载…
    </div>
  );
}

const defaultMeta: PageMeta = {
  section: 'discover',
  title: '共鸣',
  screen: 'business',
  level: 'secondary',
};

export default function AppLayout() {
  const { pathname, search } = useLocation();
  const matches = useMatches();
  const { section, title, screen, level } =
    (matches.at(-1)?.handle as PageMeta | undefined) ?? defaultMeta;
  const { unread } = useSocialStore();
  const { user } = useAuth();
  const onlineUnread = useOnlineUnread(unread);
  const readingOnlineChat =
    !!user && pathname === '/social' && !!new URLSearchParams(search).get('conversation');
  const effectiveLevel = readingOnlineChat ? 'secondary' : level;
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.title = `${title} · 共鸣`;
  }, [pathname, title]);
  return (
    <div className={`app messenger-app ios-app ${screen}-screen ${effectiveLevel}-screen`}>
      <Navigation
        section={section}
        unread={onlineUnread}
        showBottomNav={effectiveLevel === 'primary'}
      />
      <div className="workspace">
        <div className="body">
          <main>
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>
    </div>
  );
}
