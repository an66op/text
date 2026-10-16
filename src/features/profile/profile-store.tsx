import { useMemo, type ReactNode } from 'react';
import { useLocalStorage } from '@/shared/hooks/useLocalStorage';
import { ProfileContext, type Profile } from './profile-context';
// Keep context identity stable when the provider is refreshed during development.
const defaultProfile: Profile = {
  name: '橘子汽水',
  bio: '收集生活里的小确幸。摄影 / 旅行 / 咖啡 ☕',
};
const isProfile = (v: unknown): v is Profile =>
  typeof v === 'object' &&
  v !== null &&
  'name' in v &&
  typeof v.name === 'string' &&
  'bio' in v &&
  typeof v.bio === 'string' &&
  (!('avatar' in v) || typeof v.avatar === 'string') &&
  (!('location' in v) || typeof v.location === 'string') &&
  (!('handle' in v) || typeof v.handle === 'string') &&
  (!('gender' in v) || ['不公开', '女', '男'].includes(v.gender as string));
export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useLocalStorage('profile', defaultProfile, isProfile);
  const value = useMemo(() => ({ profile, setProfile }), [profile, setProfile]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}
