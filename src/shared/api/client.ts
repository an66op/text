const API_BASE = '/api/v1';
import { accountChanged, accountEpoch, expectedAccount } from './account-guard';
const unauthorizedListeners = new Set<() => void>();

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function onUnauthorized(listener: () => void) {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

export function isAbort(error: unknown) {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}

export function apiErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求失败，请稍后重试';
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const guarded = !['/auth/me', '/auth/login', '/auth/register'].includes(path.split('?')[0]);
  const requestAccount = expectedAccount();
  const requestEpoch = accountEpoch();
  if (guarded && requestAccount) headers.set('X-Gongming-Account', requestAccount);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiError('无法连接服务，请检查网络或启动 Go 服务', 'NETWORK_ERROR', 0);
  }
  const changedDuringRequest = () =>
    requestEpoch !== accountEpoch() || requestAccount !== expectedAccount();
  if (guarded && changedDuringRequest())
    throw new ApiError('账号状态已更新，请重新确认后再操作', 'ACCOUNT_CHANGED', 409);
  if (response.status === 401 && guarded) {
    unauthorizedListeners.forEach((listener) => listener());
  }
  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch {
    throw new ApiError('服务返回了无法识别的内容', 'INVALID_RESPONSE', response.status);
  }
  if (guarded && response.status !== 401 && changedDuringRequest()) {
    throw new ApiError('账号状态已更新，请重新确认后再操作', 'ACCOUNT_CHANGED', 409);
  }
  if (!response.ok) {
    const serverError = (envelope as { error?: { message?: string; code?: string } })?.error;
    if (response.status === 409 && serverError?.code === 'account_changed') accountChanged();
    throw new ApiError(
      serverError?.message || (response.status === 401 ? '请先登录，再继续操作' : '服务请求失败'),
      serverError?.code || `HTTP_${response.status}`,
      response.status,
    );
  }
  if (!envelope || typeof envelope !== 'object' || !('data' in envelope)) {
    throw new ApiError('服务响应缺少数据', 'INVALID_RESPONSE', response.status);
  }
  return (envelope as { data: T }).data;
}

export function apiQuery(values: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}
