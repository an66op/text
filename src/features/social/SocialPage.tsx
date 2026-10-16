import { useNavigate } from 'react-router';
import { useProfile } from '@/features/profile/useProfile';
import { pathForModule } from '@/shared/config/paths';
import SocialHub from './SocialHub';
import type { View } from './types';

export default function SocialPage({ view = '消息' }: { view?: View }) {
  const { profile } = useProfile();
  const navigate = useNavigate();
  return (
    <SocialHub
      initialView={view}
      profileName={profile.name}
      profileAvatar={profile.avatar}
      onOpenModule={(name) => navigate(pathForModule(name))}
    />
  );
}
