import { useSearchParams } from 'react-router';
import { safeOffset } from './format';

export const PAGE_SIZE = 20;

export function useListParams() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const status = params.get('status') || '';
  const role = params.get('role') || '';
  const offset = safeOffset(params.get('offset'), PAGE_SIZE);
  const detail = params.get('detail') || '';
  const update = (key: string, value: string) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'detail' && key !== 'offset') {
        next.delete('offset');
        next.delete('detail');
      }
      return next;
    });
  };
  return { q, status, role, offset, detail, update };
}
