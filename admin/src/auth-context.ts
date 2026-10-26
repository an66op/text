import { api, ApiError } from './api';

export interface AuthBrowserContext {
  generation: string;
  expiresAt: string;
}

// Fetch a fresh CAS version for every explicit authentication attempt. A failed
// write is never retried with a newer generation on the caller's behalf.
export async function prepareAuthContext(signal?: AbortSignal): Promise<AuthBrowserContext> {
  const context = await api<AuthBrowserContext>('/auth/context', {
    headers: { 'X-Gongming-Browser': '1' },
    signal,
  });
  if (
    !context ||
    typeof context.generation !== 'string' ||
    !/^[\x21-\x7e]{1,256}$/.test(context.generation) ||
    typeof context.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(context.expiresAt)) ||
    Date.parse(context.expiresAt) <= Date.now()
  )
    throw new ApiError('浏览器认证上下文无效，请重新确认后操作。', 0, 'invalid_response');
  return context;
}

export function authContextHeaders(context: AuthBrowserContext): Record<string, string> {
  return {
    'X-Gongming-Browser': '1',
    'X-Gongming-Auth-Generation': context.generation,
  };
}
