import { accountChanged, accountEpoch, expectedAccount } from '../../src/shared/api/account-guard';
import {
  assertRequestActive,
  RequestTimeoutError,
  withRequestDeadline,
} from '../../src/shared/api/request-deadline';

export const SESSION_EXPIRED_EVENT = 'gongming-admin-session-expired';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 0, code = 'network_error') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const guarded = !['/auth/me', '/auth/context', '/auth/login', '/auth/register'].includes(
    path.split('?')[0],
  );
  const requestAccount = expectedAccount();
  const epoch = accountEpoch();
  const changed = () => requestAccount !== expectedAccount() || epoch !== accountEpoch();
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (guarded && requestAccount) headers.set('X-Gongming-Account', requestAccount);
  try {
    return await withRequestDeadline(options.signal, async (signal) => {
      let response: Response;
      try {
        response = await fetch(`/api/v1${path}`, {
          ...options,
          signal,
          credentials: 'include',
          headers,
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        });
      } catch (error) {
        assertRequestActive(signal);
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        throw new ApiError('无法连接服务。请确认 Go API 已启动，然后重试。');
      }
      assertRequestActive(signal);
      if (guarded && changed())
        throw new ApiError('账号已切换，请重新确认后操作。', 409, 'account_changed');
      if (response.status === 401 && guarded)
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        assertRequestActive(signal);
        throw new ApiError(
          '服务返回了无法识别的响应，请稍后重试。',
          response.status,
          'invalid_response',
        );
      }
      assertRequestActive(signal);
      if (guarded && response.status !== 401 && changed())
        throw new ApiError('账号已切换，请重新确认后操作。', 409, 'account_changed');
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        throw new ApiError(
          '服务返回了无法识别的数据，请重试。',
          response.status,
          'invalid_response',
        );
      const result = raw as { data?: T; error?: { code?: string; message?: string } };
      if (!response.ok) {
        if (response.status === 409 && result.error?.code === 'account_changed') accountChanged();
        throw new ApiError(
          (result.error?.code === 'auth_context_changed'
            ? '浏览器登录状态已变化，正在重新验证账号。请重新确认后再操作。'
            : result.error?.message) ||
            (response.status === 403 ? '当前账号没有此操作权限。' : '请求未完成，请重试。'),
          response.status,
          result.error?.code || 'request_failed',
        );
      }
      if (!Object.prototype.hasOwnProperty.call(result, 'data'))
        throw new ApiError('服务响应缺少数据，请重试。', response.status, 'invalid_response');
      return result.data as T;
    });
  } catch (error) {
    if (error instanceof RequestTimeoutError) {
      const writing = !['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase());
      throw new ApiError(
        writing
          ? '请求超时，操作可能已完成；请先刷新确认，再重试。'
          : '请求超时，请检查网络后重试。',
        0,
        'timeout',
      );
    }
    throw error;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误，请重试。';
}

export function queryString(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}
