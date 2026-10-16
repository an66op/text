import { useContext } from 'react';
import { CircleContext } from './circle-context';
export { canManage } from './types';
export function useCircles() {
  const value = useContext(CircleContext);
  if (!value) throw new Error('CircleProvider is missing');
  return value;
}
