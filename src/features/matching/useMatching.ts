import { useLocalStorage } from '@/shared/hooks/useLocalStorage';
import { writeStorage } from '@/shared/lib/storage';
import {
  defaultMatchingState,
  isMatchingState,
  MATCHING_STORAGE_KEY,
  type MatchingState,
} from './matching-model';

export function useMatching() {
  const [state, setState] = useLocalStorage(
    MATCHING_STORAGE_KEY,
    defaultMatchingState,
    isMatchingState,
  );
  const save = (update: MatchingState | ((previous: MatchingState) => MatchingState)) => {
    setState((previous) => {
      const next = typeof update === 'function' ? update(previous) : update;
      if (!isMatchingState(next)) throw new Error('记录无效，请重试');
      if (!writeStorage(MATCHING_STORAGE_KEY, next))
        throw new Error('保存失败，请检查浏览器存储空间后重试');
      return next;
    });
  };
  return { state, save };
}
