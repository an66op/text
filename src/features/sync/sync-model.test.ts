import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  localSnapshot,
  readDocumentList,
  restoreDocuments,
  type PersonalDocument,
} from './sync-model';
const doc = (key: string, data: unknown): PersonalDocument => ({
  key,
  value: { version: 1, data },
  revision: 1,
  updatedAt: new Date().toISOString(),
});
describe('explicit personal document restores', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());
  it('rejects arbitrary storage domains, shared data and malformed cloud data before any write', () => {
    localStorage.setItem('content-publish-draft', '"keep"');
    expect(() => localSnapshot('wallet')).toThrow();
    expect(() =>
      restoreDocuments([doc('drafts', 'replace'), doc('bookshelf', { invalid: true })]),
    ).toThrow();
    expect(localStorage.getItem('content-publish-draft')).toBe('"keep"');
    expect(() => restoreDocuments([doc('wallet', { balance: 100 })])).toThrow();
  });
  it('restores only the requested personal data and emits updates for existing providers', () => {
    localStorage.setItem('wallet', '{"balance":10}');
    restoreDocuments([doc('drafts', 'a restored draft'), doc('bookshelf', ['novel-1'])]);
    expect(localSnapshot('drafts')).toEqual({ version: 1, data: 'a restored draft' });
    expect(localStorage.getItem('wallet')).toBe('{"balance":10}');
    expect(localStorage.getItem('content-bookshelf-ids')).toBe('["novel-1"]');
  });
  it('rejects duplicate keys, oversized valid payloads and invalid revisions before writing', () => {
    localStorage.setItem('content-publish-draft', '"original"');
    expect(() => restoreDocuments([doc('drafts', 'first'), doc('drafts', 'second')])).toThrow(
      '重复',
    );
    expect(() => restoreDocuments([doc('bookshelf', ['a'.repeat(140000)])])).toThrow('128KB');
    expect(() => restoreDocuments([{ ...doc('drafts', 'first'), revision: 0 }])).toThrow();
    expect(() => restoreDocuments([{ ...doc('drafts', 'first'), updatedAt: 'invalid' }])).toThrow();
    expect(localStorage.getItem('content-publish-draft')).toBe('"original"');
    expect(
      readDocumentList({ items: [doc('wallet', { balance: 99 }), doc('drafts', 'supported')] }),
    ).toEqual([doc('drafts', 'supported')]);
  });
  it('rolls back earlier writes and emits no provider events when a later storage write fails', () => {
    localStorage.setItem('content-publish-draft', '"original"');
    const set = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'content-bookshelf-ids') throw new DOMException('quota', 'QuotaExceededError');
      set.call(this, key, value);
    });
    const listener = vi.fn();
    window.addEventListener('storage', listener);
    expect(() =>
      restoreDocuments([doc('drafts', 'changed'), doc('bookshelf', ['novel-1'])]),
    ).toThrow();
    expect(localStorage.getItem('content-publish-draft')).toBe('"original"');
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener('storage', listener);
  });
});
