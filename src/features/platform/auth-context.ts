import { createContext } from 'react';
import type { PlatformUser } from '@/shared/api/types';

export type AuthState = {
  user: PlatformUser | null;
  status: 'checking' | 'guest' | 'authenticated' | 'unavailable';
  error: string;
  expiresAt: string;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (value: {
    email: string;
    password: string;
    name: string;
    handle: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (value: { name?: string; bio?: string; avatar?: string }) => Promise<void>;
};

const noProvider = async () => {
  throw new Error('账号服务尚未初始化');
};

export const AuthContext = createContext<AuthState>({
  user: null,
  status: 'guest',
  error: '',
  expiresAt: '',
  refresh: async () => {},
  login: noProvider,
  register: noProvider,
  logout: noProvider,
  updateProfile: noProvider,
});
