import { useCallback } from 'react';
import { useLocalStorage } from '@/shared/hooks/useLocalStorage';
import { writeStorage } from '@/shared/lib/storage';
import { AI_STORAGE_KEY, defaultAiState, isAiState, type AiState } from './ai-model';
export function useAiStore() {
  const [state, setState] = useLocalStorage(AI_STORAGE_KEY, defaultAiState, isAiState);
  const save = useCallback(
    (update: AiState | ((previous: AiState) => AiState)) => {
      setState((previous) => {
        const next = typeof update === 'function' ? update(previous) : update;
        if (!isAiState(next)) throw new Error('会话数据无法保存，请检查内容长度或会话数量');
        if (!writeStorage(AI_STORAGE_KEY, next))
          throw new Error('保存失败，草稿已保留，请检查本地存储空间');
        return next;
      });
    },
    [setState],
  );
  return { state, save };
}
export type AiSave = ReturnType<typeof useAiStore>['save'];
