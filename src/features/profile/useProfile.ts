import { useContext } from 'react';
import { ProfileContext } from './profile-context';

export function useProfile() {
  const value = useContext(ProfileContext);
  if (!value) throw new Error('ProfileProvider is missing');
  return value;
}
