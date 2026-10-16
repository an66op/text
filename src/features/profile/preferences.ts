import { useLocalStorage } from '@/shared/hooks/useLocalStorage';

const defaults: Record<string, boolean> = {};
const isPreferences = (value: unknown): value is Record<string, boolean> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((preference) => typeof preference === 'boolean');

export function usePreferences() {
  return useLocalStorage('preferences', defaults, isPreferences);
}
