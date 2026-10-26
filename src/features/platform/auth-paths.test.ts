import { describe, expect, it } from 'vitest';
import { loginPath, safeReturnTo } from './auth-paths';

describe('authentication return routes', () => {
  it('retains internal deep links and query strings', () => {
    expect(safeReturnTo('/messages?conversation=one#latest')).toBe(
      '/messages?conversation=one#latest',
    );
    expect(loginPath('/world?topic=设计')).toBe(
      '/login?returnTo=%2Fworld%3Ftopic%3D%25E8%25AE%25BE%25E8%25AE%25A1',
    );
  });
  it.each([
    'https://evil.test',
    '//evil.test',
    '/\\evil.test',
    'javascript:alert(1)',
    '/\nevil',
    '/login?returnTo=//evil.test',
    '/register',
    '',
  ])('rejects unsafe or recursive return route %s', (route) => {
    expect(safeReturnTo(route)).toBe('/account');
  });
});
