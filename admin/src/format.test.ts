import { describe, expect, it } from 'vitest';
import { safeImageUrl, safeOffset, safeReturnTo } from './format';

describe('admin navigation and media guards', () => {
  it('keeps login returns inside known console routes', () => {
    expect(safeReturnTo('/reports?status=open&detail=r1')).toBe('/reports?status=open&detail=r1');
    for (const path of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/login',
      '/unknown',
      null,
      '/users\n',
    ]) {
      expect(safeReturnTo(path)).toBe('/overview');
    }
  });
  it('normalizes pagination and refuses invalid offsets', () => {
    expect(safeOffset('47')).toBe(40);
    for (const value of [null, '-1', 'NaN', 'Infinity', '3.4', '9007199254740992'])
      expect(safeOffset(value)).toBe(0);
  });
  it('renders external media only through http or https', () => {
    expect(safeImageUrl('https://example.com/a.jpg')).toBe('https://example.com/a.jpg');
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///tmp/a',
      '/relative.jpg',
      '',
    ])
      expect(safeImageUrl(value)).toBe('');
  });
});
