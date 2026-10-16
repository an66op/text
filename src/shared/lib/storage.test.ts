import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { isNumberArray, isStringArray, readStorage, writeStorage } from './storage';

describe('persisted application data', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('writes JSON and restores it without changing its shape', () => {
    const profile = { name: '小橙', bio: '一起探索', preferences: ['阅读'] };

    expect(writeStorage('profile', profile)).toBe(true);
    expect(localStorage.getItem('profile')).toBe(JSON.stringify(profile));
    expect(readStorage('profile', { name: '默认用户' })).toEqual(profile);
  });

  it('keeps valid falsy values instead of replacing them with a fallback', () => {
    localStorage.setItem('balance', '0');
    localStorage.setItem('notifications', 'false');
    localStorage.setItem('draft', '""');

    expect(readStorage('balance', 100)).toBe(0);
    expect(readStorage('notifications', true)).toBe(false);
    expect(readStorage('draft', '默认草稿')).toBe('');
  });

  it('falls back when the entry is missing, null, or invalid JSON', () => {
    const fallback = ['默认数据'];
    expect(readStorage('missing', fallback, isStringArray)).toBe(fallback);

    localStorage.setItem('items', 'null');
    expect(readStorage('items', fallback, isStringArray)).toBe(fallback);

    localStorage.setItem('items', '{"truncated":');
    expect(readStorage('items', fallback, isStringArray)).toBe(fallback);
  });

  it('rejects stored values that do not match the feature validator', () => {
    localStorage.setItem('joined', '["摄影", 42]');
    localStorage.setItem('likes', '[1, "2"]');

    expect(readStorage('joined', ['默认组织'], isStringArray)).toEqual(['默认组织']);
    expect(readStorage('likes', [9], isNumberArray)).toEqual([9]);

    localStorage.setItem('joined', '["摄影", "阅读"]');
    localStorage.setItem('likes', '[1, 2]');

    expect(readStorage('joined', [], isStringArray)).toEqual(['摄影', '阅读']);
    expect(readStorage('likes', [], isNumberArray)).toEqual([1, 2]);
    expect(isNumberArray([1, Number.POSITIVE_INFINITY])).toBe(false);
  });

  it('continues with fallback data when reading storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError');
    });

    expect(readStorage('profile', { name: '默认用户' })).toEqual({ name: '默认用户' });
  });

  it('reports a failed write through the shared storage error event', () => {
    const listener = vi.fn();
    window.addEventListener('app:storage-error', listener);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    try {
      expect(writeStorage('messages', ['新消息'])).toBe(false);
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0]).toBeInstanceOf(CustomEvent);
    } finally {
      window.removeEventListener('app:storage-error', listener);
    }
  });
});
