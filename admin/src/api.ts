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
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('无法连接服务。请确认 Go API 已启动，然后重试。');
  }

  if (response.status === 401 && !path.startsWith('/auth/')) {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new ApiError(
      '服务返回了无法识别的响应，请稍后重试。',
      response.status,
      'invalid_response',
    );
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ApiError('服务返回了无法识别的数据，请重试。', response.status, 'invalid_response');
  }
  const result = raw as { data?: T; error?: { code?: string; message?: string } };

  if (!response.ok) {
    throw new ApiError(
      result.error?.message ||
        (response.status === 403 ? '当前账号没有此操作权限。' : '请求未完成，请重试。'),
      response.status,
      result.error?.code || 'request_failed',
    );
  }
  if (!Object.prototype.hasOwnProperty.call(result, 'data')) {
    throw new ApiError('服务响应缺少数据，请重试。', response.status, 'invalid_response');
  }
  return result.data as T;
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
