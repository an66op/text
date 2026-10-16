import { Navigate, useParams } from 'react-router';
import { circlePaths } from './routes';

export default function LegacyCircleRedirect({
  kind = 'home',
}: {
  kind?: 'home' | 'settings' | 'members' | 'events';
}) {
  const { contentId, eventId } = useParams();
  if (!contentId) return <Navigate to={circlePaths.list} replace />;
  const to =
    kind === 'settings'
      ? circlePaths.settings(contentId)
      : kind === 'members'
        ? circlePaths.members(contentId)
        : kind === 'events'
          ? `${circlePaths.channel(contentId, 'events')}?event=${encodeURIComponent(eventId || '')}`
          : circlePaths.home(contentId);
  return <Navigate to={to} replace />;
}
