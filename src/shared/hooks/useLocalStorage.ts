import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { readStorage, writeStorage, type Validator } from '@/shared/lib/storage';
export function useLocalStorage<T>(key: string, fallback: T, validate?: Validator<T>) {
  const [value, setState] = useState<T>(() => readStorage(key, fallback, validate));
  const latest = useRef(value);
  const setValue = useCallback(
    (update: SetStateAction<T>) => {
      const next =
        typeof update === 'function' ? (update as (previous: T) => T)(latest.current) : update;
      latest.current = next;
      // Forms may navigate away in the same event, before their next effect can run.
      writeStorage(key, next);
      setState(next);
    },
    [key],
  );
  useEffect(() => {
    writeStorage(key, value);
  }, [key, value]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === key || event.key === null) {
        const next = readStorage(key, fallback, validate);
        latest.current = next;
        setState(next);
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [key, fallback, validate]);
  return [value, setValue] as const;
}
