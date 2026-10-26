import { accountEpoch } from './account-guard';
import { ApiError, apiRequest, isAbort } from './client';
import { assertRequestActive } from './request-deadline';
export type BrowserAuthContext = { generation: string; expiresAt: string };
export function isUnconfirmedAuthWrite(error: unknown) {
  return (
    isAbort(error) ||
    !(error instanceof ApiError) ||
    error.status === 0 ||
    error.status >= 500 ||
    (error.status >= 200 && error.status < 300)
  );
}
export async function prepareAuthContext(signal?: AbortSignal): Promise<BrowserAuthContext> {
  const value = await apiRequest<BrowserAuthContext>('/auth/context', {
    signal,
    headers: { 'X-Gongming-Browser': '1' },
  });
  if (
    !value ||
    typeof value.generation !== 'string' ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(value.generation) ||
    typeof value.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(value.expiresAt))
  )
    throw new ApiError('无法确认浏览器认证状态，请刷新后重试', 'INVALID_AUTH_CONTEXT', 0);
  return value;
}
export function authContextHeaders(context: BrowserAuthContext): Record<string, string> {
  return { 'X-Gongming-Browser': '1', 'X-Gongming-Auth-Generation': context.generation };
}
export async function withAuthBrowserLock<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal) assertRequestActive(signal);
  if (navigator.locks?.request)
    return navigator.locks.request(
      'gongming-auth-browser',
      { ...(signal ? { signal } : {}) },
      operation,
    );
  return operation();
}
export async function browserAuthRequest<T>(
  operation: (context: BrowserAuthContext) => Promise<T>,
  signal?: AbortSignal,
  expectedGeneration?: string,
) {
  const epoch = accountEpoch();
  return withAuthBrowserLock(async () => {
    const context = await prepareAuthContext(signal);
    if (signal) assertRequestActive(signal);
    if (epoch !== accountEpoch())
      throw new ApiError('账号状态已变化，请重新确认', 'ACCOUNT_CHANGED', 409);
    if (expectedGeneration && context.generation !== expectedGeneration)
      throw new ApiError('浏览器认证状态已更新，请重新确认', 'auth_context_changed', 409);
    return operation(context);
  }, signal);
}
