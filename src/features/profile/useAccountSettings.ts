import { useEffect, useState } from 'react';
import { isStringArray, readStorage, writeStorage } from '@/shared/lib/storage';
import { BLOCKED_KEY, loadSettings, SETTINGS_KEY, type AccountSettings } from './settings-model';

export function useAccountSettings() {
  const [settings, setSettings] = useState(loadSettings);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === SETTINGS_KEY || event.key === null) setSettings(loadSettings());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const update = (change: (current: AccountSettings) => AccountSettings) => {
    const next = change(loadSettings());
    if (!writeStorage(SETTINGS_KEY, next)) return false;
    setSettings(next);
    return true;
  };
  return { settings, update };
}
export function useBlockedContacts() {
  const [blocked, setBlocked] = useState(() =>
    readStorage<string[]>(BLOCKED_KEY, [], isStringArray),
  );
  useEffect(() => {
    const sync = () => setBlocked(readStorage<string[]>(BLOCKED_KEY, [], isStringArray));
    const onStorage = (event: StorageEvent) => {
      if (event.key === BLOCKED_KEY || event.key === null) sync();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('profile:blocked-update', sync);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('profile:blocked-update', sync);
    };
  }, []);
  const update = (ids: string[]) => {
    if (!writeStorage(BLOCKED_KEY, [...new Set(ids)])) return false;
    setBlocked(ids);
    window.dispatchEvent(new Event('profile:blocked-update'));
    return true;
  };
  return { blocked, update };
}
