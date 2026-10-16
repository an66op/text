import { useContext } from 'react';
import { SocialContext } from './social-context';

export function useSocialStore() {
  const context = useContext(SocialContext);
  if (!context) throw new Error('SocialProvider is required');
  return context;
}
