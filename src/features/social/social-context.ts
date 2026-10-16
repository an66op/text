import { createContext } from 'react';
import type { SocialStore } from './types';

export const SocialContext = createContext<SocialStore | null>(null);
