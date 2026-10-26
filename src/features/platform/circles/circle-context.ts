import { createContext, useContext } from 'react';
import type { Circle } from './types';
export const CircleContext = createContext<{
  circle: Circle;
  refresh: () => void;
  deny: (message: string) => void;
} | null>(null);
export function useCircle() {
  const value = useContext(CircleContext);
  if (!value) throw new Error('圈子页面尚未初始化');
  return value;
}
