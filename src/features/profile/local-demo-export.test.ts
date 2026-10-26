import { beforeEach, expect, it } from 'vitest';
import { localDemoExport } from './local-demo-export';

beforeEach(() => localStorage.clear());
it('exports only named local demo domains and never treats familiar prefixes as permission to export', () => {
  localStorage.setItem('profile', '{"name":"本机资料"}');
  localStorage.setItem('account-settings-v1', '{"privacy":"本机演示"}');
  localStorage.setItem('social-messages', '{"demo":[]}');
  for (const key of [
    'profile-private-blocks',
    'account-settings-server-privacy',
    'preferences-private',
    'wallet-identity',
    'social-private-contact-policy',
    'gongming-message-draft-v1:user:chat',
    'contact-privacy',
    'blocks',
  ])
    localStorage.setItem(key, 'private-server-data');
  expect(localDemoExport()).toEqual({
    profile: '{"name":"本机资料"}',
    'account-settings-v1': '{"privacy":"本机演示"}',
    'social-messages': '{"demo":[]}',
  });
});
it('does not create defaults or enumerate unknown storage when no demo key exists', () => {
  localStorage.setItem('profile-preferences-private', 'secret');
  expect(localDemoExport()).toEqual({});
  expect(localStorage.length).toBe(1);
});
