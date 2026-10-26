import { describe, expect, it } from 'vitest';
import { actionLabel, fileSize, safeImageUrl, safeOffset, safeReturnTo } from './format';

describe('admin navigation and media guards', () => {
  it('labels wallet security events without interpreting target IDs as wallet owners', () => {
    expect(actionLabel('wallet.bind')).toBe('绑定本人钱包');
    expect(actionLabel('wallet.unbind')).toBe('解绑本人钱包');
    expect(actionLabel('wallet.login')).toBe('钱包签名登录');
    expect(actionLabel('__proto__')).toBe('__proto__');
    expect(actionLabel('future.action')).toBe('future.action');
  });
  it('keeps login returns inside known console routes', () => {
    expect(safeReturnTo('/reports?status=open&detail=r1')).toBe('/reports?status=open&detail=r1');
    expect(safeReturnTo('/media?status=blocked')).toBe('/media?status=blocked');
    expect(safeReturnTo('/circles/posts?circleId=circle_1')).toBe(
      '/circles/posts?circleId=circle_1',
    );
    expect(safeReturnTo('/circles/events?moderation=hidden')).toBe(
      '/circles/events?moderation=hidden',
    );
    for (const path of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/login',
      '/unknown',
      '/circles/members',
      '/circles/events/attendees',
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
  it('only allows exact API-generated relative image paths', () => {
    const image = '/api/v1/media/images/media_' + 'ab'.repeat(16);
    expect(safeImageUrl(image)).toBe(image);
    for (const value of [
      image + '?token=secret',
      image + '#preview',
      image + '/',
      image.replace('media_ab', 'media_AB'),
      image.replace('/images/', '/images/%2e%2e/'),
      image.replace('media_', '%6dedia_'),
      image.slice(0, -1),
      image + 'f',
      '//evil.example' + image,
      '/api/v1/admin/system',
      '/uploads/image.png',
      '../' + image,
      ' ' + image,
      image + '\n',
    ])
      expect(safeImageUrl(value)).toBe('');
  });
  it('formats actual image byte sizes without confusing bytes with pixels', () => {
    expect(fileSize(983)).toBe('983 B');
    expect(fileSize(1536)).toBe('1.5 KiB');
    expect(fileSize(8 * 1024 * 1024)).toBe('8 MiB');
    expect(fileSize(-1)).toBe('大小未知');
  });
});
