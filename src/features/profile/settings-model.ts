import { readStorage } from '@/shared/lib/storage';

export const SETTINGS_KEY = 'account-settings-v1';
export const BLOCKED_KEY = 'profile-blocked-contacts';
export type DemoDevice = {
  id: string;
  name: string;
  location: string;
  lastActive: string;
  current?: boolean;
};
export type AccountSettings = {
  account: { email: string; phone: string };
  privacy: {
    visibility: '公开' | '仅好友' | '仅自己';
    findByHandle: boolean;
    friendRequest: boolean;
    readReceipts: boolean;
  };
  notifications: {
    sound: boolean;
    vibration: boolean;
    showPreview: boolean;
    quiet: boolean;
    quietStart: string;
    quietEnd: string;
  };
  security: { deviceVerification: boolean; demoLock: boolean; pinHash?: string; pinSalt?: string };
  devices: DemoDevice[];
};
export const defaultSettings: AccountSettings = {
  account: { email: 'orange@example.com', phone: '13800138000' },
  privacy: { visibility: '仅好友', findByHandle: true, friendRequest: true, readReceipts: true },
  notifications: {
    sound: true,
    vibration: true,
    showPreview: true,
    quiet: false,
    quietStart: '22:00',
    quietEnd: '08:00',
  },
  security: { deviceVerification: true, demoLock: false },
  devices: [
    {
      id: 'current',
      name: '当前浏览器',
      location: '本机 · 当前会话',
      lastActive: '正在使用',
      current: true,
    },
    {
      id: 'demo-mobile',
      name: 'iPhone 15 · 演示设备',
      location: '杭州 · 测试记录',
      lastActive: '昨天 21:30',
    },
    {
      id: 'demo-desktop',
      name: 'MacBook · 演示设备',
      location: '上海 · 测试记录',
      lastActive: '10 月 6 日 14:20',
    },
  ],
};
export function isAccountSettings(value: unknown): value is AccountSettings {
  if (typeof value !== 'object' || value === null) return false;
  const settings = value as Partial<AccountSettings>;
  return (
    typeof settings.account?.email === 'string' &&
    typeof settings.account?.phone === 'string' &&
    ['公开', '仅好友', '仅自己'].includes(settings.privacy?.visibility ?? '') &&
    ['findByHandle', 'friendRequest', 'readReceipts'].every(
      (key) => typeof settings.privacy?.[key as keyof AccountSettings['privacy']] === 'boolean',
    ) &&
    ['sound', 'vibration', 'showPreview', 'quiet'].every(
      (key) =>
        typeof settings.notifications?.[key as keyof AccountSettings['notifications']] ===
        'boolean',
    ) &&
    typeof settings.notifications?.quietStart === 'string' &&
    typeof settings.notifications?.quietEnd === 'string' &&
    typeof settings.security?.deviceVerification === 'boolean' &&
    typeof settings.security?.demoLock === 'boolean' &&
    (settings.security.pinHash === undefined || typeof settings.security.pinHash === 'string') &&
    (settings.security.pinSalt === undefined || typeof settings.security.pinSalt === 'string') &&
    Array.isArray(settings.devices) &&
    settings.devices.every(
      (device) =>
        typeof device === 'object' &&
        device !== null &&
        typeof device.id === 'string' &&
        typeof device.name === 'string' &&
        typeof device.location === 'string' &&
        typeof device.lastActive === 'string',
    )
  );
}
export function loadSettings() {
  return readStorage(SETTINGS_KEY, defaultSettings, isAccountSettings);
}
export async function hashDemoPin(pin: string, salt: string) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
