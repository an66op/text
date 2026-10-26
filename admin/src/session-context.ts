import { createContext } from 'react';
import type { Session } from './types';

export interface SessionContextValue {
  status: 'checking' | 'authenticated' | 'anonymous' | 'unavailable';
  session: Session | null;
  error: string;
  expired: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const SessionContext = createContext<SessionContextValue | null>(null);
