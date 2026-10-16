export type Validator<T> = (value: unknown) => value is T;
export function readStorage<T>(key: string, fallback: T, validate?: Validator<T>): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const value: unknown = JSON.parse(raw);
    return value !== null && (!validate || validate(value)) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}
export function writeStorage(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    window.dispatchEvent(new CustomEvent('app:storage-error'));
    return false;
  }
}
export const isStringArray: Validator<string[]> = (v): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');
export const isNumberArray: Validator<number[]> = (v): v is number[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x));
